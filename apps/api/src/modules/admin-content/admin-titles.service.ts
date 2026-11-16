import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@app/db";
import type {
  AdminTitle, AssetKind, ImageDto, ImageKind, MediaAssetDto, Paginated, PublishStatus, TitleType, TranscodeJobDto,
} from "@app/shared";
import { mediaLayout } from "@app/shared/media";
import { PrismaService } from "../../infra/prisma.service.js";
import { RedisService } from "../../infra/redis.service.js";
import { ApiException } from "../../common/api-exception.js";
import { ImagePipelineService } from "../storage/image-pipeline.service.js";
import { StorageService } from "../storage/storage.service.js";
import { invalidateCatalogCache } from "../catalog/cache.js";
import { pageParams } from "../catalog/browse.service.js";
import { MediaQueuesService } from "./queues.service.js";
import { assetInclude, jobInclude, toAssetDto, toJobDto } from "./mappers.js";
import { pickUniqueSlug, slugify } from "./slug.js";
import {
  adminTitleInput, adminTitlePatch, attachAssetBody, parseBody, type AdminTitleInputParsed, type AdminTitlePatchParsed,
} from "./validation.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const adminTitleInclude = {
  genres: { select: { genre: { select: { id: true, slug: true, name: true } } } },
  images: { orderBy: [{ kind: "asc" }, { createdAt: "desc" }] },
  mainAsset: { include: assetInclude },
  previewAsset: { include: assetInclude },
} satisfies Prisma.TitleInclude;
type AdminTitleRow = Prisma.TitleGetPayload<{ include: typeof adminTitleInclude }>;

/** Trường metadata mà đồng bộ TMDB có thể ghi; admin sửa tay → ghi vào overriddenFields. */
export const SYNCABLE_FIELDS = ["name", "originalName", "tagline", "overview", "releaseDate", "runtimeMinutes", "maturityRating", "countries", "genres"] as const;

const toDate = (s: string | null | undefined) => (s ? new Date(`${s.slice(0, 10)}T00:00:00Z`) : s === null ? null : undefined);

@Injectable()
export class AdminTitlesService {
  private readonly logger = new Logger("AdminTitlesService");

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ImagePipelineService) private readonly images: ImagePipelineService,
    @Inject(MediaQueuesService) private readonly queues: MediaQueuesService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  toAdminTitle(t: AdminTitleRow): AdminTitle {
    return {
      id: t.id,
      slug: t.slug,
      type: t.type,
      tmdbId: t.tmdbId,
      name: t.name,
      originalName: t.originalName,
      tagline: t.tagline,
      overview: t.overview,
      releaseDate: t.releaseDate ? t.releaseDate.toISOString().slice(0, 10) : null,
      runtimeMinutes: t.runtimeMinutes,
      maturityRating: t.maturityRating,
      countries: t.countries,
      status: t.status,
      publishedAt: t.publishedAt?.toISOString() ?? null,
      overriddenFields: t.overriddenFields,
      genres: t.genres.map((g) => g.genre),
      images: t.images.map((i) => this.images.imageDto(i)),
      mainAsset: t.mainAsset ? toAssetDto(t.mainAsset, t.name) : null,
      previewAsset: t.previewAsset ? toAssetDto(t.previewAsset, t.name) : null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  async get(id: string): Promise<AdminTitle> {
    return this.toAdminTitle(await this.getRow(id));
  }

  private async getRow(id: string): Promise<AdminTitleRow> {
    if (!UUID_RE.test(id)) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy title");
    const t = await this.prisma.title.findUnique({ where: { id }, include: adminTitleInclude });
    if (!t) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy title");
    return t;
  }

  async list(q: { q?: string; status?: string; type?: string; page?: string; pageSize?: string }): Promise<Paginated<AdminTitle>> {
    const p = pageParams(q.page, q.pageSize, 24);
    const where: Prisma.TitleWhereInput = {};
    if (q.status) {
      if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(q.status)) throw new ApiException(400, "VALIDATION", "status không hợp lệ");
      where.status = q.status as PublishStatus;
    }
    if (q.type) {
      if (!["MOVIE", "SERIES"].includes(q.type)) throw new ApiException(400, "VALIDATION", "type không hợp lệ");
      where.type = q.type as TitleType;
    }
    if (q.q?.trim()) {
      const s = q.q.trim();
      where.OR = [
        { name: { contains: s, mode: "insensitive" } },
        { originalName: { contains: s, mode: "insensitive" } },
        { slug: { contains: slugify(s) } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.title.count({ where }),
      this.prisma.title.findMany({ where, orderBy: { updatedAt: "desc" }, skip: p.skip, take: p.pageSize, include: adminTitleInclude }),
    ]);
    return { items: rows.map((r) => this.toAdminTitle(r)), page: p.page, pageSize: p.pageSize, total, hasMore: p.skip + rows.length < total };
  }

  /** Slug duy nhất từ tên (tiếng Việt → ASCII). */
  async uniqueSlug(source: string, excludeId?: string): Promise<string> {
    const base = slugify(source);
    const rows = await this.prisma.title.findMany({
      where: { slug: { startsWith: base }, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { slug: true },
    });
    return pickUniqueSlug(base, rows.map((r) => r.slug));
  }

  private async assertGenres(ids: string[] | undefined) {
    if (!ids?.length) return;
    const n = await this.prisma.genre.count({ where: { id: { in: ids } } });
    if (n !== new Set(ids).size) throw new ApiException(400, "VALIDATION", "genreIds có id không tồn tại");
  }

  async create(body: unknown, extra: Partial<Prisma.TitleUncheckedCreateInput> = {}): Promise<AdminTitle> {
    const input: AdminTitleInputParsed = parseBody(adminTitleInput, body);
    await this.assertGenres(input.genreIds);
    const slug = await this.uniqueSlug(input.slug || input.name);
    const t = await this.prisma.title.create({
      data: {
        type: input.type,
        name: input.name,
        slug,
        originalName: input.originalName ?? null,
        tagline: input.tagline ?? null,
        overview: input.overview ?? null,
        releaseDate: toDate(input.releaseDate) ?? null,
        runtimeMinutes: input.runtimeMinutes ?? null,
        maturityRating: input.maturityRating ?? null,
        countries: input.countries ?? [],
        ...extra,
        genres: input.genreIds?.length ? { create: [...new Set(input.genreIds)].map((genreId) => ({ genreId })) } : undefined,
      },
    });
    return this.get(t.id);
  }

  /** PATCH: mọi trường metadata có mặt trong body được ghi vào overriddenFields. */
  async update(id: string, body: unknown): Promise<AdminTitle> {
    const input: AdminTitlePatchParsed = parseBody(adminTitlePatch, body);
    const current = await this.getRow(id);
    await this.assertGenres(input.genreIds);
    const touched = new Set<string>();
    const data: Prisma.TitleUpdateInput = {};
    if (input.type !== undefined) data.type = input.type;
    if (input.name !== undefined) { data.name = input.name; touched.add("name"); }
    if (input.originalName !== undefined) { data.originalName = input.originalName; touched.add("originalName"); }
    if (input.tagline !== undefined) { data.tagline = input.tagline; touched.add("tagline"); }
    if (input.overview !== undefined) { data.overview = input.overview; touched.add("overview"); }
    if (input.releaseDate !== undefined) { data.releaseDate = toDate(input.releaseDate); touched.add("releaseDate"); }
    if (input.runtimeMinutes !== undefined) { data.runtimeMinutes = input.runtimeMinutes; touched.add("runtimeMinutes"); }
    if (input.maturityRating !== undefined) { data.maturityRating = input.maturityRating; touched.add("maturityRating"); }
    if (input.countries !== undefined) { data.countries = input.countries; touched.add("countries"); }
    if (input.genreIds !== undefined) touched.add("genres");
    if (input.slug !== undefined && input.slug !== current.slug) {
      if (!input.slug) data.slug = await this.uniqueSlug(input.name ?? current.name, id);
      else {
        const clash = await this.prisma.title.findFirst({ where: { slug: input.slug, id: { not: id } }, select: { id: true } });
        if (clash) throw new ApiException(409, "CONFLICT", "Slug đã được dùng");
        data.slug = input.slug;
      }
    }
    data.overriddenFields = input.overriddenFields !== undefined
      ? [...new Set(input.overriddenFields.filter((f) => (SYNCABLE_FIELDS as readonly string[]).includes(f)))]
      : [...new Set([...current.overriddenFields, ...touched])];
    await this.prisma.$transaction(async (tx) => {
      await tx.title.update({ where: { id }, data });
      if (input.genreIds !== undefined) {
        await tx.titleGenre.deleteMany({ where: { titleId: id } });
        if (input.genreIds.length) await tx.titleGenre.createMany({ data: [...new Set(input.genreIds)].map((genreId) => ({ titleId: id, genreId })) });
      }
    });
    await invalidateCatalogCache(this.redis);
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    await this.getRow(id);
    const imgs = await this.prisma.image.findMany({ where: { titleId: id }, select: { key: true } });
    await this.prisma.title.delete({ where: { id } });
    await invalidateCatalogCache(this.redis);
    // Ảnh chỉ thuộc title này → dọn khỏi bucket (HLS giữ lại để tái sử dụng/audit)
    await Promise.allSettled(imgs.map((i) => this.storage.deleteMedia(i.key)));
  }

  /** Xuất bản. `force` (chỉ dùng cho seed) bỏ qua yêu cầu có asset READY. */
  async publish(id: string, opts: { force?: boolean; publishedAt?: Date } = {}): Promise<AdminTitle> {
    const t = await this.getRow(id);
    if (!opts.force) {
      let ready = t.mainAsset?.status === "READY";
      if (!ready && t.type === "SERIES") {
        ready = (await this.prisma.episode.count({ where: { titleId: id, status: "PUBLISHED", mainAsset: { status: "READY" } } })) > 0;
      }
      if (!ready) throw new ApiException(409, "CONFLICT", "Cần asset chính ở trạng thái READY trước khi xuất bản");
    }
    await this.prisma.title.update({
      where: { id },
      data: { status: "PUBLISHED", publishedAt: opts.publishedAt ?? (t.status === "PUBLISHED" && t.publishedAt ? t.publishedAt : new Date()) },
    });
    await invalidateCatalogCache(this.redis);
    return this.get(id);
  }

  async unpublish(id: string): Promise<AdminTitle> {
    await this.getRow(id);
    await this.prisma.title.update({ where: { id }, data: { status: "DRAFT" } });
    await invalidateCatalogCache(this.redis);
    return this.get(id);
  }

  /** Tạo MediaAsset + TranscodeJob, đẩy job lên hàng đợi transcode, gắn vào title (main/preview). */
  async attachAsset(titleId: string, body: unknown): Promise<MediaAssetDto> {
    const input = parseBody(attachAssetBody, body);
    const title = await this.getRow(titleId);
    const sf = await this.prisma.sourceFile.findUnique({ where: { id: input.sourceFileId } });
    if (!sf) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy file nguồn");
    if (sf.probeStatus === "FAILED" || sf.probeStatus === "SKIPPED") {
      throw new ApiException(409, "CONFLICT", `File nguồn không dùng được (probe ${sf.probeStatus}${sf.probeError ? `: ${sf.probeError}` : ""})`);
    }
    const kind: AssetKind = input.kind;
    const { asset, job } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.mediaAsset.create({ data: { sourceFileId: sf.id, kind, status: "QUEUED", durationSec: sf.durationSec } });
      const asset = await tx.mediaAsset.update({ where: { id: created.id }, data: { outputPrefix: mediaLayout.assetPrefix(created.id) } });
      const job = await tx.transcodeJob.create({ data: { assetId: asset.id, status: "QUEUED" } });
      await tx.title.update({ where: { id: titleId }, data: kind === "MAIN" ? { mainAssetId: asset.id } : { previewAssetId: asset.id } });
      return { asset, job };
    });
    await this.enqueue(job.id, asset.id);
    await invalidateCatalogCache(this.redis);
    const row = await this.prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id }, include: assetInclude });
    return toAssetDto(row, title.name);
  }

  private async enqueue(jobId: string, assetId: string, attempt = 0) {
    try {
      const queueJobId = await this.queues.enqueueTranscode({ assetId, transcodeJobId: jobId }, attempt ? `${jobId}-r${attempt}` : jobId);
      await this.prisma.transcodeJob.update({ where: { id: jobId }, data: { queueJobId } });
    } catch (err) {
      this.logger.error(`Không đẩy được job transcode ${jobId}: ${(err as Error).message}`);
      await this.prisma.transcodeJob.update({ where: { id: jobId }, data: { status: "FAILED", error: `Enqueue lỗi: ${(err as Error).message}` } });
      await this.prisma.mediaAsset.update({ where: { id: assetId }, data: { status: "FAILED", errorMessage: "Không đẩy được job transcode" } });
      throw new ApiException(500, "INTERNAL", "Không đẩy được job transcode");
    }
  }

  async uploadImage(titleId: string, file: { buffer: Buffer; mimetype: string } | undefined, kindRaw: unknown): Promise<ImageDto> {
    await this.getRow(titleId);
    const kind = String(kindRaw ?? "").toUpperCase() as ImageKind;
    if (!["POSTER", "BACKDROP", "LOGO", "STILL"].includes(kind)) throw new ApiException(400, "VALIDATION", "kind phải là POSTER, BACKDROP hoặc LOGO");
    if (!file?.buffer?.length) throw new ApiException(400, "VALIDATION", "Thiếu file ảnh");
    if (!file.mimetype.startsWith("image/")) throw new ApiException(400, "VALIDATION", "File không phải ảnh");
    let img;
    try {
      img = await this.images.saveTitleImage(titleId, kind, file.buffer);
    } catch (err) {
      if (err instanceof ApiException) throw err;
      throw new ApiException(400, "VALIDATION", `Không đọc được ảnh: ${(err as Error).message}`);
    }
    await invalidateCatalogCache(this.redis);
    return this.images.imageDto(img);
  }

  // ───────── job transcode ─────────

  async jobs(q: { status?: string; page?: string; pageSize?: string }): Promise<Paginated<TranscodeJobDto>> {
    const p = pageParams(q.page, q.pageSize, 30);
    const where: Prisma.TranscodeJobWhereInput = {};
    if (q.status) {
      if (!["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"].includes(q.status)) throw new ApiException(400, "VALIDATION", "status không hợp lệ");
      where.status = q.status as TranscodeJobDto["status"];
    }
    const [total, rows] = await Promise.all([
      this.prisma.transcodeJob.count({ where }),
      this.prisma.transcodeJob.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.pageSize, include: jobInclude }),
    ]);
    return { items: rows.map((r) => toJobDto(r)), page: p.page, pageSize: p.pageSize, total, hasMore: p.skip + rows.length < total };
  }

  async retryJob(id: string): Promise<TranscodeJobDto> {
    if (!UUID_RE.test(id)) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy job");
    const job = await this.prisma.transcodeJob.findUnique({ where: { id } });
    if (!job) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy job");
    if (job.status !== "FAILED" && job.status !== "CANCELED") throw new ApiException(409, "CONFLICT", "Chỉ thử lại job FAILED/CANCELED");
    await this.prisma.$transaction([
      this.prisma.transcodeJob.update({
        where: { id }, data: { status: "QUEUED", progress: 0, stage: null, error: null, startedAt: null, finishedAt: null },
      }),
      this.prisma.mediaAsset.update({ where: { id: job.assetId }, data: { status: "QUEUED", errorMessage: null } }),
    ]);
    await this.enqueue(id, job.assetId, Date.now());
    const row = await this.prisma.transcodeJob.findUniqueOrThrow({ where: { id }, include: jobInclude });
    return toJobDto(row);
  }
}
