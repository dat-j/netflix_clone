import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@app/db";
import type { AdminEpisode, AdminSeason, ImageDto, MediaAssetDto } from "@app/shared";
import { PrismaService } from "../../infra/prisma.service.js";
import { RedisService } from "../../infra/redis.service.js";
import { ApiException } from "../../common/api-exception.js";
import { ImagePipelineService, pickImage } from "../storage/image-pipeline.service.js";
import { StorageService } from "../storage/storage.service.js";
import { invalidateCatalogCache } from "../catalog/cache.js";
import { AdminTitlesService, saveUploadedImage, toDate } from "./admin-titles.service.js";
import { assetInclude, toAssetDto } from "./mappers.js";
import {
  adminEpisodeInput, adminEpisodePatch, adminSeasonInput, adminSeasonPatch, assertMarkers, bulkEpisodesBody,
  episodeAssetBody, parseBody,
} from "./validation.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Trường TMDB đồng bộ được — admin sửa tay → ghi vào overriddenFields (cùng cơ chế với Title). */
export const SEASON_SYNCABLE = ["name", "overview", "airDate"] as const;
export const EPISODE_SYNCABLE = ["name", "overview", "airDate", "runtimeMinutes"] as const;

export const episodeInclude = {
  season: { select: { seasonNumber: true } },
  images: { where: { kind: "STILL" }, orderBy: { createdAt: "desc" } },
  mainAsset: { include: assetInclude },
  title: { select: { name: true } },
} satisfies Prisma.EpisodeInclude;
type EpisodeRow = Prisma.EpisodeGetPayload<{ include: typeof episodeInclude }>;

export const seasonInclude = {
  episodes: { orderBy: { episodeNumber: "asc" }, include: episodeInclude },
} satisfies Prisma.SeasonInclude;
type SeasonRow = Prisma.SeasonGetPayload<{ include: typeof seasonInclude }>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "P2002";
const epLabel = (e: { episodeNumber: number; season: { seasonNumber: number } }) => `S${e.season.seasonNumber}E${e.episodeNumber}`;

function lockedFields(current: string[], touched: Set<string>, explicit: string[] | undefined, allowed: readonly string[]): string[] {
  if (explicit !== undefined) return [...new Set(explicit.filter((f) => allowed.includes(f)))];
  return [...new Set([...current, ...touched])];
}

/** Quản trị mùa/tập của phim bộ (PHIM BỘ trong contract). */
@Injectable()
export class AdminSeriesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ImagePipelineService) private readonly images: ImagePipelineService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(AdminTitlesService) private readonly titles: AdminTitlesService,
  ) {}

  // ───────── mapper ─────────

  toEpisode(e: EpisodeRow): AdminEpisode {
    const still = pickImage(e.images, "STILL");
    return {
      id: e.id,
      seasonId: e.seasonId,
      seasonNumber: e.season.seasonNumber,
      episodeNumber: e.episodeNumber,
      name: e.name,
      overview: e.overview,
      runtimeMinutes: e.runtimeMinutes,
      airDate: day(e.airDate),
      status: e.status,
      introStartSec: e.introStartSec,
      introEndSec: e.introEndSec,
      creditsStartSec: e.creditsStartSec,
      still: still ? this.images.imageDto(still) : null,
      mainAsset: e.mainAsset ? toAssetDto(e.mainAsset, `${e.title.name} — ${epLabel(e)}`) : null,
    };
  }

  toSeason(s: SeasonRow): AdminSeason {
    return {
      id: s.id, titleId: s.titleId, seasonNumber: s.seasonNumber, name: s.name, overview: s.overview, airDate: day(s.airDate),
      episodes: s.episodes.map((e) => this.toEpisode(e)),
    };
  }

  // ───────── tra cứu ─────────

  private async seriesTitle(titleId: string) {
    const t = await this.titles.getRow(titleId);
    if (t.type !== "SERIES") throw new ApiException(409, "CONFLICT", "Title không phải phim bộ");
    return t;
  }

  private async seasonRow(id: string) {
    if (!UUID_RE.test(id)) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy mùa phim");
    const s = await this.prisma.season.findUnique({ where: { id }, include: { title: { select: { id: true, name: true, status: true, mainAsset: { select: { status: true } } } } } });
    if (!s) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy mùa phim");
    return s;
  }

  private async episodeRow(id: string): Promise<EpisodeRow> {
    if (!UUID_RE.test(id)) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy tập phim");
    const e = await this.prisma.episode.findUnique({ where: { id }, include: episodeInclude });
    if (!e) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy tập phim");
    return e;
  }

  async getSeason(id: string): Promise<AdminSeason> {
    return this.toSeason(await this.prisma.season.findUniqueOrThrow({ where: { id }, include: seasonInclude }));
  }

  async getEpisode(id: string): Promise<AdminEpisode> {
    return this.toEpisode(await this.episodeRow(id));
  }

  async listSeasons(titleId: string): Promise<AdminSeason[]> {
    await this.titles.getRow(titleId);
    const rows = await this.prisma.season.findMany({ where: { titleId }, orderBy: { seasonNumber: "asc" }, include: seasonInclude });
    return rows.map((s) => this.toSeason(s));
  }

  // ───────── mùa ─────────

  async createSeason(titleId: string, body: unknown): Promise<AdminSeason> {
    const input = parseBody(adminSeasonInput, body);
    await this.seriesTitle(titleId);
    const clash = await this.prisma.season.findUnique({ where: { titleId_seasonNumber: { titleId, seasonNumber: input.seasonNumber } }, select: { id: true } });
    if (clash) throw new ApiException(409, "CONFLICT", `Mùa ${input.seasonNumber} đã tồn tại`, { seasonId: clash.id });
    try {
      const s = await this.prisma.season.create({
        data: { titleId, seasonNumber: input.seasonNumber, name: input.name ?? null, overview: input.overview ?? null, airDate: toDate(input.airDate) ?? null },
      });
      await invalidateCatalogCache(this.redis);
      return this.getSeason(s.id);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiException(409, "CONFLICT", `Mùa ${input.seasonNumber} đã tồn tại`);
      throw err;
    }
  }

  async updateSeason(id: string, body: unknown): Promise<AdminSeason> {
    const input = parseBody(adminSeasonPatch, body);
    const current = await this.seasonRow(id);
    const touched = new Set<string>();
    const data: Prisma.SeasonUpdateInput = {};
    if (input.seasonNumber !== undefined && input.seasonNumber !== current.seasonNumber) {
      const clash = await this.prisma.season.findUnique({ where: { titleId_seasonNumber: { titleId: current.titleId, seasonNumber: input.seasonNumber } }, select: { id: true } });
      if (clash) throw new ApiException(409, "CONFLICT", `Mùa ${input.seasonNumber} đã tồn tại`, { seasonId: clash.id });
      data.seasonNumber = input.seasonNumber;
    }
    if (input.name !== undefined) { data.name = input.name; touched.add("name"); }
    if (input.overview !== undefined) { data.overview = input.overview; touched.add("overview"); }
    if (input.airDate !== undefined) { data.airDate = toDate(input.airDate); touched.add("airDate"); }
    data.overriddenFields = lockedFields(current.overriddenFields, touched, input.overriddenFields, SEASON_SYNCABLE);
    try {
      await this.prisma.season.update({ where: { id }, data });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiException(409, "CONFLICT", `Mùa ${input.seasonNumber} đã tồn tại`);
      throw err;
    }
    await invalidateCatalogCache(this.redis);
    return this.getSeason(id);
  }

  async deleteSeason(id: string): Promise<void> {
    await this.seasonRow(id);
    const published = await this.prisma.episode.count({ where: { seasonId: id, status: "PUBLISHED" } });
    if (published) throw new ApiException(409, "CONFLICT", `Mùa còn ${published} tập đã xuất bản — gỡ xuất bản trước khi xóa`, { publishedEpisodes: published });
    const imgs = await this.prisma.image.findMany({ where: { episode: { seasonId: id } }, select: { key: true } });
    await this.prisma.season.delete({ where: { id } });
    await invalidateCatalogCache(this.redis);
    // HLS của tập được giữ lại (giống xóa title); chỉ dọn ảnh still
    await Promise.allSettled(imgs.map((i) => this.storage.deleteMedia(i.key)));
  }

  // ───────── tập ─────────

  async createEpisode(seasonId: string, body: unknown): Promise<AdminEpisode> {
    const input = parseBody(adminEpisodeInput, body);
    const season = await this.seasonRow(seasonId);
    const markers = { introStartSec: input.introStartSec ?? null, introEndSec: input.introEndSec ?? null, creditsStartSec: input.creditsStartSec ?? null };
    assertMarkers(markers);
    await this.assertEpisodeFree(seasonId, season.seasonNumber, input.episodeNumber);
    try {
      const e = await this.prisma.episode.create({
        data: {
          titleId: season.titleId, seasonId, episodeNumber: input.episodeNumber, name: input.name ?? null, overview: input.overview ?? null,
          runtimeMinutes: input.runtimeMinutes ?? null, airDate: toDate(input.airDate) ?? null, ...markers,
        },
      });
      return this.getEpisode(e.id);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiException(409, "CONFLICT", `Tập ${input.episodeNumber} đã tồn tại trong mùa ${season.seasonNumber}`);
      throw err;
    }
  }

  private async assertEpisodeFree(seasonId: string, seasonNumber: number, episodeNumber: number) {
    const clash = await this.prisma.episode.findUnique({ where: { seasonId_episodeNumber: { seasonId, episodeNumber } }, select: { id: true } });
    if (clash) throw new ApiException(409, "CONFLICT", `Tập ${episodeNumber} đã tồn tại trong mùa ${seasonNumber}`, { episodeId: clash.id });
  }

  /** Tạo nhanh N tập trống, đánh số liên tiếp từ `startAt` (mặc định: sau tập lớn nhất hiện có). */
  async bulkCreate(seasonId: string, body: unknown): Promise<AdminEpisode[]> {
    const input = parseBody(bulkEpisodesBody, body);
    const season = await this.seasonRow(seasonId);
    const max = await this.prisma.episode.aggregate({ where: { seasonId }, _max: { episodeNumber: true } });
    const startAt = input.startAt ?? (max._max.episodeNumber ?? 0) + 1;
    const numbers = Array.from({ length: input.count }, (_, i) => startAt + i);
    if (numbers.at(-1)! > 10_000) throw new ApiException(400, "VALIDATION", "Số tập vượt quá 10000");
    const taken = await this.prisma.episode.findMany({ where: { seasonId, episodeNumber: { in: numbers } }, select: { episodeNumber: true } });
    if (taken.length) {
      throw new ApiException(409, "CONFLICT", `Tập đã tồn tại trong mùa ${season.seasonNumber}: ${taken.map((t) => t.episodeNumber).join(", ")}`, {
        episodeNumbers: taken.map((t) => t.episodeNumber),
      });
    }
    try {
      await this.prisma.episode.createMany({ data: numbers.map((episodeNumber) => ({ titleId: season.titleId, seasonId, episodeNumber })) });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiException(409, "CONFLICT", "Tập đã tồn tại (tạo đồng thời)");
      throw err;
    }
    const rows = await this.prisma.episode.findMany({ where: { seasonId, episodeNumber: { in: numbers } }, orderBy: { episodeNumber: "asc" }, include: episodeInclude });
    return rows.map((e) => this.toEpisode(e));
  }

  async updateEpisode(id: string, body: unknown): Promise<AdminEpisode> {
    const input = parseBody(adminEpisodePatch, body);
    const current = await this.episodeRow(id);
    const touched = new Set<string>();
    const data: Prisma.EpisodeUpdateInput = {};
    if (input.episodeNumber !== undefined && input.episodeNumber !== current.episodeNumber) {
      await this.assertEpisodeFree(current.seasonId, current.season.seasonNumber, input.episodeNumber);
      data.episodeNumber = input.episodeNumber;
    }
    if (input.name !== undefined) { data.name = input.name; touched.add("name"); }
    if (input.overview !== undefined) { data.overview = input.overview; touched.add("overview"); }
    if (input.runtimeMinutes !== undefined) { data.runtimeMinutes = input.runtimeMinutes; touched.add("runtimeMinutes"); }
    if (input.airDate !== undefined) { data.airDate = toDate(input.airDate); touched.add("airDate"); }
    const markers = {
      introStartSec: input.introStartSec !== undefined ? input.introStartSec : current.introStartSec,
      introEndSec: input.introEndSec !== undefined ? input.introEndSec : current.introEndSec,
      creditsStartSec: input.creditsStartSec !== undefined ? input.creditsStartSec : current.creditsStartSec,
    };
    assertMarkers(markers);
    Object.assign(data, markers);
    data.overriddenFields = lockedFields(current.overriddenFields, touched, input.overriddenFields, EPISODE_SYNCABLE);
    try {
      await this.prisma.episode.update({ where: { id }, data });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiException(409, "CONFLICT", `Tập ${input.episodeNumber} đã tồn tại`);
      throw err;
    }
    if (current.status === "PUBLISHED") await invalidateCatalogCache(this.redis);
    return this.getEpisode(id);
  }

  async deleteEpisode(id: string): Promise<void> {
    const e = await this.episodeRow(id);
    if (e.status === "PUBLISHED") throw new ApiException(409, "CONFLICT", "Tập đang xuất bản — gỡ xuất bản trước khi xóa");
    await this.prisma.episode.delete({ where: { id } });
    await Promise.allSettled(e.images.map((i) => this.storage.deleteMedia(i.key)));
  }

  /** Gắn file nguồn làm video chính của tập: cùng đường tạo asset + TranscodeJob + enqueue với title. */
  async attachAsset(id: string, body: unknown): Promise<MediaAssetDto> {
    const input = parseBody(episodeAssetBody, body);
    const e = await this.episodeRow(id);
    return this.titles.createAssetAndEnqueue(input.sourceFileId, "MAIN", `${e.title.name} — ${epLabel(e)}`, (tx, assetId) =>
      tx.episode.update({ where: { id }, data: { mainAssetId: assetId } }));
  }

  async publishEpisode(id: string): Promise<AdminEpisode> {
    const e = await this.episodeRow(id);
    if (e.mainAsset?.status !== "READY") throw new ApiException(409, "CONFLICT", "Cần video của tập ở trạng thái READY trước khi xuất bản");
    if (e.status !== "PUBLISHED") {
      await this.prisma.episode.update({ where: { id }, data: { status: "PUBLISHED" } });
      await invalidateCatalogCache(this.redis);
    }
    return this.getEpisode(id);
  }

  async unpublishEpisode(id: string): Promise<AdminEpisode> {
    const e = await this.episodeRow(id);
    if (e.status === "PUBLISHED") {
      const t = await this.prisma.title.findUniqueOrThrow({ where: { id: e.titleId }, select: { status: true, mainAsset: { select: { status: true } } } });
      if (t.status === "PUBLISHED" && t.mainAsset?.status !== "READY") {
        const others = await this.prisma.episode.count({ where: { titleId: e.titleId, status: "PUBLISHED", id: { not: id } } });
        if (!others) throw new ApiException(409, "CONFLICT", "Đây là tập xuất bản cuối cùng của phim bộ đang xuất bản — gỡ xuất bản phim trước");
      }
      await this.prisma.episode.update({ where: { id }, data: { status: "DRAFT" } });
      await invalidateCatalogCache(this.redis);
    }
    return this.getEpisode(id);
  }

  /** Xuất bản mọi tập READY chưa xuất bản trong mùa; trả về các tập vừa xuất bản. */
  async publishReady(seasonId: string): Promise<AdminEpisode[]> {
    await this.seasonRow(seasonId);
    const ready = await this.prisma.episode.findMany({
      where: { seasonId, status: { not: "PUBLISHED" }, mainAsset: { status: "READY" } }, select: { id: true },
    });
    if (!ready.length) return [];
    const ids = ready.map((r) => r.id);
    await this.prisma.episode.updateMany({ where: { id: { in: ids } }, data: { status: "PUBLISHED" } });
    await invalidateCatalogCache(this.redis);
    const rows = await this.prisma.episode.findMany({ where: { id: { in: ids } }, orderBy: { episodeNumber: "asc" }, include: episodeInclude });
    return rows.map((r) => this.toEpisode(r));
  }

  async uploadStill(id: string, file: { buffer: Buffer; mimetype: string } | undefined, kindRaw: unknown): Promise<ImageDto> {
    const e = await this.episodeRow(id);
    const kind = (typeof kindRaw === "string" && kindRaw ? kindRaw : "STILL").toUpperCase();
    if (kind !== "STILL") throw new ApiException(400, "VALIDATION", "Ảnh của tập chỉ hỗ trợ kind=STILL");
    const img = await saveUploadedImage(file, (buf) => this.images.saveEpisodeStill(e.titleId, id, buf));
    if (e.status === "PUBLISHED") await invalidateCatalogCache(this.redis);
    return this.images.imageDto(img);
  }
}
