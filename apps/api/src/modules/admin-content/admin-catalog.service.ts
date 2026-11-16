import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, ProbeStatus } from "@app/db";
import type {
  AdminStats, BillboardDto, CollectionDto, GenreDto, HomeRowDto, Paginated, SourceFileDto,
} from "@app/shared";
import { PrismaService } from "../../infra/prisma.service.js";
import { RedisService } from "../../infra/redis.service.js";
import { ApiException } from "../../common/api-exception.js";
import { CdnSigner } from "../storage/cdn-signer.js";
import { pickImage } from "../storage/image-pipeline.service.js";
import { invalidateCatalogCache } from "../catalog/cache.js";
import { pageParams } from "../catalog/browse.service.js";
import { MediaQueuesService } from "./queues.service.js";
import { toSourceFileDto } from "./mappers.js";
import { pickUniqueSlug, slugify } from "./slug.js";
import {
  billboardInput, collectionInput, collectionPatch, homeRowInput, homeRowPatch, parseBody, reorderBody, scanBody,
} from "./validation.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = (what: string) => new ApiException(404, "NOT_FOUND", `Không tìm thấy ${what}`);

type HomeRowRow = Prisma.HomeRowGetPayload<object>;
const toHomeRowDto = (r: HomeRowRow): HomeRowDto => ({
  id: r.id, kind: r.kind, title: r.title, collectionId: r.collectionId, genreId: r.genreId, titleType: r.titleType,
  isActive: r.isActive, sortOrder: r.sortOrder,
});

const posterImages = { where: { kind: { in: ["POSTER", "BACKDROP"] } }, select: { kind: true, key: true, isPrimary: true } } satisfies Prisma.Title$imagesArgs;

@Injectable()
export class AdminCatalogService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(CdnSigner) private readonly cdn: CdnSigner,
    @Inject(MediaQueuesService) private readonly queues: MediaQueuesService,
  ) {}

  private invalidate() {
    return invalidateCatalogCache(this.redis);
  }

  // ───────── thống kê ─────────

  async stats(): Promise<AdminStats> {
    const now = new Date();
    const [users, activeSubscriptions, titlesPublished, titlesDraft, src, jobs, viewsLast7d] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.subscription.count({ where: { status: "ACTIVE", currentPeriodEnd: { gt: now } } }),
      this.prisma.title.count({ where: { status: "PUBLISHED" } }),
      this.prisma.title.count({ where: { status: "DRAFT" } }),
      this.prisma.sourceFile.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
      this.prisma.transcodeJob.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.viewEvent.count({ where: { createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } } }),
    ]);
    const jobCount = (s: string) => jobs.find((j) => j.status === s)?._count._all ?? 0;
    return {
      users, activeSubscriptions, titlesPublished, titlesDraft,
      sourceFiles: src._count._all,
      sourceBytes: (src._sum.sizeBytes ?? 0n).toString(),
      jobsQueued: jobCount("QUEUED"), jobsRunning: jobCount("RUNNING"), jobsFailed: jobCount("FAILED"),
      viewsLast7d,
    };
  }

  // ───────── file nguồn ─────────

  async sourceFiles(q: { q?: string; prefix?: string; status?: string; unlinked?: string; page?: string; pageSize?: string }): Promise<Paginated<SourceFileDto>> {
    const p = pageParams(q.page, q.pageSize, 50);
    const where: Prisma.SourceFileWhereInput = {};
    const and: Prisma.SourceFileWhereInput[] = [];
    if (q.q?.trim()) and.push({ key: { contains: q.q.trim(), mode: "insensitive" } });
    if (q.prefix) and.push({ key: { startsWith: q.prefix } });
    if (q.status) {
      if (!["PENDING", "OK", "FAILED", "SKIPPED"].includes(q.status)) throw new ApiException(400, "VALIDATION", "status không hợp lệ");
      and.push({ probeStatus: q.status as ProbeStatus });
    }
    if (q.unlinked === "true" || q.unlinked === "1") and.push({ assets: { none: {} } });
    if (and.length) where.AND = and;
    const [total, rows] = await Promise.all([
      this.prisma.sourceFile.count({ where }),
      this.prisma.sourceFile.findMany({ where, orderBy: { key: "asc" }, skip: p.skip, take: p.pageSize, include: { assets: { select: { id: true } } } }),
    ]);
    return { items: rows.map(toSourceFileDto), page: p.page, pageSize: p.pageSize, total, hasMore: p.skip + rows.length < total };
  }

  async scan(body: unknown): Promise<{ queued: true }> {
    const input = parseBody(scanBody, body);
    await this.queues.enqueueScan(input.prefix);
    return { queued: true };
  }

  // ───────── thể loại ─────────

  async genres(): Promise<GenreDto[]> {
    return this.prisma.genre.findMany({ orderBy: { name: "asc" }, select: { id: true, slug: true, name: true } });
  }

  // ───────── hàng trang chủ ─────────

  async homeRows(): Promise<HomeRowDto[]> {
    const rows = await this.prisma.homeRow.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    return rows.map(toHomeRowDto);
  }

  private async checkRowRefs(kind: string, collectionId: string | null | undefined, genreId: string | null | undefined) {
    if (kind === "COLLECTION") {
      if (!collectionId) throw new ApiException(400, "VALIDATION", "Hàng COLLECTION cần collectionId");
      if (!(await this.prisma.collection.findUnique({ where: { id: collectionId }, select: { id: true } }))) throw notFound("collection");
    }
    if (kind === "GENRE") {
      if (!genreId) throw new ApiException(400, "VALIDATION", "Hàng GENRE cần genreId");
      if (!(await this.prisma.genre.findUnique({ where: { id: genreId }, select: { id: true } }))) throw notFound("thể loại");
    }
  }

  async createHomeRow(body: unknown): Promise<HomeRowDto> {
    const input = parseBody(homeRowInput, body);
    await this.checkRowRefs(input.kind, input.collectionId, input.genreId);
    const max = await this.prisma.homeRow.aggregate({ _max: { sortOrder: true } });
    const row = await this.prisma.homeRow.create({
      data: {
        kind: input.kind, title: input.title,
        collectionId: input.kind === "COLLECTION" ? input.collectionId! : null,
        genreId: input.kind === "GENRE" ? input.genreId! : null,
        titleType: input.titleType ?? null, isActive: input.isActive ?? true,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    });
    await this.invalidate();
    return toHomeRowDto(row);
  }

  async updateHomeRow(id: string, body: unknown): Promise<HomeRowDto> {
    const input = parseBody(homeRowPatch, body);
    const cur = UUID_RE.test(id) ? await this.prisma.homeRow.findUnique({ where: { id } }) : null;
    if (!cur) throw notFound("hàng");
    const kind = input.kind ?? cur.kind;
    const collectionId = input.collectionId !== undefined ? input.collectionId : cur.collectionId;
    const genreId = input.genreId !== undefined ? input.genreId : cur.genreId;
    await this.checkRowRefs(kind, collectionId, genreId);
    const row = await this.prisma.homeRow.update({
      where: { id },
      data: {
        kind, title: input.title ?? cur.title,
        collectionId: kind === "COLLECTION" ? collectionId : null,
        genreId: kind === "GENRE" ? genreId : null,
        titleType: input.titleType !== undefined ? input.titleType : cur.titleType,
        isActive: input.isActive ?? cur.isActive,
      },
    });
    await this.invalidate();
    return toHomeRowDto(row);
  }

  async deleteHomeRow(id: string): Promise<void> {
    if (!UUID_RE.test(id)) throw notFound("hàng");
    const r = await this.prisma.homeRow.deleteMany({ where: { id } });
    if (!r.count) throw notFound("hàng");
    await this.invalidate();
  }

  async reorderHomeRows(body: unknown): Promise<HomeRowDto[]> {
    const { ids } = parseBody(reorderBody, body);
    const existing = await this.prisma.homeRow.findMany({ select: { id: true }, orderBy: { sortOrder: "asc" } });
    const known = new Set(existing.map((r) => r.id));
    const unknown = ids.filter((i) => !known.has(i));
    if (unknown.length) throw new ApiException(400, "VALIDATION", `id không tồn tại: ${unknown.join(", ")}`);
    // Hàng không có trong danh sách giữ thứ tự cũ, đặt sau.
    const order = [...new Set(ids), ...existing.map((r) => r.id).filter((i) => !ids.includes(i))];
    await this.prisma.$transaction(order.map((id, i) => this.prisma.homeRow.update({ where: { id }, data: { sortOrder: i } })));
    await this.invalidate();
    return this.homeRows();
  }

  // ───────── bộ sưu tập ─────────

  private async collectionDto(id: string): Promise<CollectionDto> {
    const c = await this.prisma.collection.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: "asc" }, include: { title: { select: { id: true, name: true, images: posterImages } } } } },
    });
    if (!c) throw notFound("collection");
    return {
      id: c.id, slug: c.slug, name: c.name,
      titles: c.items.map((i) => {
        const poster = pickImage(i.title.images, "POSTER");
        return { id: i.title.id, name: i.title.name, posterUrl: poster ? this.cdn.publicUrl(poster.key) : null };
      }),
    };
  }

  async collections(): Promise<CollectionDto[]> {
    const rows = await this.prisma.collection.findMany({ orderBy: { createdAt: "asc" }, select: { id: true } });
    return Promise.all(rows.map((r) => this.collectionDto(r.id)));
  }

  async collection(id: string): Promise<CollectionDto> {
    if (!UUID_RE.test(id)) throw notFound("collection");
    return this.collectionDto(id);
  }

  private async assertTitles(ids: string[]) {
    if (!ids.length) return;
    const n = await this.prisma.title.count({ where: { id: { in: ids } } });
    if (n !== new Set(ids).size) throw new ApiException(400, "VALIDATION", "titleIds có id không tồn tại");
  }

  private async uniqueCollectionSlug(source: string, excludeId?: string) {
    const base = slugify(source);
    const rows = await this.prisma.collection.findMany({
      where: { slug: { startsWith: base }, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { slug: true },
    });
    return pickUniqueSlug(base, rows.map((r) => r.slug));
  }

  async createCollection(body: unknown): Promise<CollectionDto> {
    const input = parseBody(collectionInput, body);
    await this.assertTitles(input.titleIds);
    const ids = [...new Set(input.titleIds)];
    const c = await this.prisma.collection.create({
      data: {
        name: input.name, slug: await this.uniqueCollectionSlug(input.slug || input.name),
        items: { create: ids.map((titleId, sortOrder) => ({ titleId, sortOrder })) },
      },
    });
    await this.invalidate();
    return this.collectionDto(c.id);
  }

  async updateCollection(id: string, body: unknown): Promise<CollectionDto> {
    const input = parseBody(collectionPatch, body);
    const cur = UUID_RE.test(id) ? await this.prisma.collection.findUnique({ where: { id } }) : null;
    if (!cur) throw notFound("collection");
    if (input.titleIds) await this.assertTitles(input.titleIds);
    let slug: string | undefined;
    if (input.slug !== undefined && input.slug !== cur.slug) slug = await this.uniqueCollectionSlug(input.slug || input.name || cur.name, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.collection.update({ where: { id }, data: { name: input.name ?? undefined, slug } });
      if (input.titleIds) {
        await tx.collectionItem.deleteMany({ where: { collectionId: id } });
        await tx.collectionItem.createMany({ data: [...new Set(input.titleIds)].map((titleId, sortOrder) => ({ collectionId: id, titleId, sortOrder })) });
      }
    });
    await this.invalidate();
    return this.collectionDto(id);
  }

  async deleteCollection(id: string): Promise<void> {
    if (!UUID_RE.test(id)) throw notFound("collection");
    const r = await this.prisma.collection.deleteMany({ where: { id } });
    if (!r.count) throw notFound("collection");
    await this.invalidate();
  }

  // ───────── billboard ─────────

  async billboards(): Promise<BillboardDto[]> {
    const rows = await this.prisma.billboard.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { title: { select: { name: true, images: posterImages } } },
    });
    return rows.map((b) => {
      const bd = pickImage(b.title.images, "BACKDROP");
      return { id: b.id, titleId: b.titleId, titleName: b.title.name, backdropUrl: bd ? this.cdn.publicUrl(bd.key) : null, isActive: b.isActive, sortOrder: b.sortOrder };
    });
  }

  async createBillboard(body: unknown): Promise<BillboardDto> {
    const { titleId } = parseBody(billboardInput, body);
    if (!(await this.prisma.title.findUnique({ where: { id: titleId }, select: { id: true } }))) throw notFound("title");
    const max = await this.prisma.billboard.aggregate({ _max: { sortOrder: true } });
    const b = await this.prisma.billboard.create({ data: { titleId, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
    await this.invalidate();
    return (await this.billboards()).find((x) => x.id === b.id)!;
  }

  async deleteBillboard(id: string): Promise<void> {
    if (!UUID_RE.test(id)) throw notFound("billboard");
    const r = await this.prisma.billboard.deleteMany({ where: { id } });
    if (!r.count) throw notFound("billboard");
    await this.invalidate();
  }
}
