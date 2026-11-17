import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@app/db";
import type { AdminSeason } from "@app/shared";
import { PrismaService } from "../../infra/prisma.service.js";
import { RedisService } from "../../infra/redis.service.js";
import { ApiException } from "../../common/api-exception.js";
import { ImagePipelineService } from "../storage/image-pipeline.service.js";
import { AdminTitlesService } from "../admin-content/admin-titles.service.js";
import { AdminSeriesService } from "../admin-content/admin-series.service.js";
import { parseBody, syncSeasonsBody } from "../admin-content/validation.js";
import { invalidateCatalogCache } from "../catalog/cache.js";
import { TmdbClient } from "./tmdb.client.js";

interface TmdbSeasonSummary { season_number: number; name?: string; overview?: string; air_date?: string | null; episode_count?: number }
interface TmdbEpisode { episode_number: number; name?: string; overview?: string; air_date?: string | null; runtime?: number | null; still_path?: string | null }
interface TmdbSeason { season_number: number; name?: string; overview?: string; air_date?: string | null; episodes?: TmdbEpisode[] }

/** Ảnh still tải đồng bộ khi import phim bộ (phần còn lại do `sync-tmdb-seasons` tải tiếp — chỉ tải ảnh còn thiếu). */
export const IMPORT_STILL_BUDGET = 24;
/** Ảnh still tối đa mỗi lần gọi `sync-tmdb-seasons` (gọi lại để tải tiếp). */
export const SYNC_STILL_BUDGET = 120;
const STILL_CONCURRENCY = 4;
const SEASON_CONCURRENCY = 3;

const dateOf = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(`${s.slice(0, 10)}T00:00:00Z`) : null);
/** TMDB đặt tên mặc định "Episode 3"/"Tập 3" khi chưa có tên thật → coi như trống để dùng fallback. */
const realName = (s: string | undefined, n: number) => {
  const t = s?.trim();
  if (!t || new RegExp(`^(Episode|Tập)\\s*${n}$`, "i").test(t)) return null;
  return t;
};

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  }));
}

export interface SeasonSyncResult { seasons: number; failedSeasons: number[]; episodesCreated: number; episodesUpdated: number; stillsSaved: number; stillsPending: number }

/**
 * Đồng bộ mùa/tập từ TMDB cho title SERIES (tiếng Việt, fallback tiếng Anh). Không bao giờ ghi đè trường admin đã
 * sửa tay: Season/Episode có `overriddenFields` (cùng cơ chế với Title — PATCH ghi tên trường vào đó). Ảnh still chỉ
 * tải cho tập chưa có still (không đè ảnh admin upload), giới hạn `stillBudget` mỗi lần.
 */
@Injectable()
export class TmdbSeasonsService {
  private readonly logger = new Logger("TmdbSeasonsService");

  constructor(
    @Inject(TmdbClient) private readonly tmdb: TmdbClient,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ImagePipelineService) private readonly images: ImagePipelineService,
    @Inject(AdminTitlesService) private readonly titles: AdminTitlesService,
    @Inject(AdminSeriesService) private readonly series: AdminSeriesService,
  ) {}

  /** POST /admin/titles/:id/sync-tmdb-seasons */
  async syncEndpoint(titleId: string, body: unknown): Promise<AdminSeason[]> {
    const input = parseBody(syncSeasonsBody, body);
    await this.sync(titleId, { seasonNumbers: input.seasonNumbers, stillBudget: SYNC_STILL_BUDGET });
    return this.series.listSeasons(titleId);
  }

  async sync(titleId: string, opts: { seasonNumbers?: number[]; stillBudget: number }): Promise<SeasonSyncResult> {
    this.tmdb.assertEnabled();
    const t = await this.titles.getRow(titleId);
    if (t.type !== "SERIES") throw new ApiException(409, "CONFLICT", "Title không phải phim bộ");
    if (!t.tmdbId) throw new ApiException(409, "CONFLICT", "Title chưa liên kết TMDB");
    const tv = await this.tmdb.get<{ seasons?: TmdbSeasonSummary[] }>(`/tv/${t.tmdbId}`, { language: "vi-VN" });
    const known = new Set((tv.seasons ?? []).map((s) => s.season_number));
    // Mặc định bỏ mùa 0 (Specials); chỉ đồng bộ khi được yêu cầu rõ.
    const wanted = opts.seasonNumbers?.length ? [...new Set(opts.seasonNumbers)].filter((n) => known.has(n)) : [...known].filter((n) => n > 0);
    wanted.sort((a, b) => a - b);

    const result: SeasonSyncResult = { seasons: 0, failedSeasons: [], episodesCreated: 0, episodesUpdated: 0, stillsSaved: 0, stillsPending: 0 };
    const stillJobs: { episodeId: string; path: string; seasonNumber: number; episodeNumber: number }[] = [];
    await pool(wanted, SEASON_CONCURRENCY, async (n) => {
      let vi: TmdbSeason;
      let en: TmdbSeason | null;
      try {
        [vi, en] = await Promise.all([
          this.tmdb.get<TmdbSeason>(`/tv/${t.tmdbId}/season/${n}`, { language: "vi-VN" }),
          this.tmdb.get<TmdbSeason>(`/tv/${t.tmdbId}/season/${n}`, { language: "en-US" }).catch(() => null),
        ]);
      } catch (err) {
        // một mùa lỗi/không tồn tại không làm hỏng cả lần đồng bộ
        this.logger.warn(`TMDB season ${t.tmdbId}/${n} lỗi: ${(err as Error).message}`);
        result.failedSeasons.push(n);
        return;
      }
      const r = await this.upsertSeason(titleId, n, vi, en);
      result.seasons++;
      result.episodesCreated += r.created;
      result.episodesUpdated += r.updated;
      stillJobs.push(...r.stills);
    });

    stillJobs.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
    const now = stillJobs.slice(0, Math.max(0, opts.stillBudget));
    result.stillsPending = stillJobs.length - now.length;
    await pool(now, STILL_CONCURRENCY, async (j) => {
      const buf = await this.tmdb.download(j.path, "w780");
      if (!buf) return;
      try {
        await this.images.saveEpisodeStill(titleId, j.episodeId, buf);
        result.stillsSaved++;
      } catch (err) {
        this.logger.warn(`Lưu still tập ${j.episodeId} lỗi: ${(err as Error).message}`);
      }
    });
    await invalidateCatalogCache(this.redis);
    this.logger.log(`TMDB seasons ${titleId}: ${JSON.stringify(result)}`);
    return result;
  }

  private async upsertSeason(titleId: string, seasonNumber: number, vi: TmdbSeason, en: TmdbSeason | null) {
    const meta = {
      name: vi.name?.trim() || en?.name?.trim() || null,
      overview: vi.overview?.trim() || en?.overview?.trim() || null,
      airDate: dateOf(vi.air_date ?? en?.air_date),
    };
    let season = await this.prisma.season.findUnique({ where: { titleId_seasonNumber: { titleId, seasonNumber } } });
    if (!season) {
      season = await this.prisma.season.create({ data: { titleId, seasonNumber, ...meta } });
    } else {
      const locked = new Set(season.overriddenFields);
      const data: Prisma.SeasonUpdateInput = {};
      for (const k of ["name", "overview", "airDate"] as const) if (!locked.has(k)) (data as Record<string, unknown>)[k] = meta[k];
      if (Object.keys(data).length) await this.prisma.season.update({ where: { id: season.id }, data });
    }
    const seasonId = season.id;

    const enBy = new Map((en?.episodes ?? []).map((e) => [e.episode_number, e]));
    const existing = await this.prisma.episode.findMany({
      where: { seasonId }, select: { id: true, episodeNumber: true, overriddenFields: true, images: { where: { kind: "STILL" }, select: { id: true } } },
    });
    const byNum = new Map(existing.map((e) => [e.episodeNumber, e]));
    const create: Prisma.EpisodeCreateManyInput[] = [];
    let updated = 0;
    const stillPaths = new Map<number, string>();
    for (const ep of vi.episodes ?? []) {
      const e2 = enBy.get(ep.episode_number);
      const m = {
        name: realName(ep.name, ep.episode_number) ?? realName(e2?.name, ep.episode_number) ?? ep.name?.trim() ?? null,
        overview: ep.overview?.trim() || e2?.overview?.trim() || null,
        airDate: dateOf(ep.air_date ?? e2?.air_date),
        runtimeMinutes: ep.runtime ?? e2?.runtime ?? null,
      };
      const still = ep.still_path ?? e2?.still_path;
      if (still) stillPaths.set(ep.episode_number, still);
      const cur = byNum.get(ep.episode_number);
      if (!cur) {
        create.push({ titleId, seasonId, episodeNumber: ep.episode_number, ...m });
        continue;
      }
      const locked = new Set(cur.overriddenFields);
      const data: Prisma.EpisodeUpdateInput = {};
      for (const k of ["name", "overview", "airDate", "runtimeMinutes"] as const) if (!locked.has(k)) (data as Record<string, unknown>)[k] = m[k];
      if (Object.keys(data).length) {
        await this.prisma.episode.update({ where: { id: cur.id }, data });
        updated++;
      }
    }
    if (create.length) await this.prisma.episode.createMany({ data: create, skipDuplicates: true });
    const after = create.length
      ? await this.prisma.episode.findMany({ where: { seasonId }, select: { id: true, episodeNumber: true, images: { where: { kind: "STILL" }, select: { id: true } } } })
      : existing;
    const stills = after
      .filter((e) => !e.images.length && stillPaths.has(e.episodeNumber))
      .map((e) => ({ episodeId: e.id, path: stillPaths.get(e.episodeNumber)!, seasonNumber, episodeNumber: e.episodeNumber }));
    return { created: create.length, updated, stills };
  }
}
