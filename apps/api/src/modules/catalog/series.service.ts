import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@app/db";
import type { EpisodeRef, WatchProgressDto } from "@app/shared";
import { PrismaService } from "../../infra/prisma.service.js";
import { ImagePipelineService, pickImage } from "../storage/image-pipeline.service.js";
import { nextAfter, pickResume, sortEpisodes, type EpKey } from "./series.js";

/** Tập "phát được" = đã xuất bản + asset chính READY. */
export const PLAYABLE_EPISODE: Prisma.EpisodeWhereInput = { status: "PUBLISHED", mainAsset: { status: "READY" } };

export const stillSelect = {
  where: { kind: "STILL" }, select: { kind: true, key: true, width: true, height: true, blurData: true, isPrimary: true },
} satisfies Prisma.Episode$imagesArgs;

const playableSelect = {
  id: true, titleId: true, episodeNumber: true, name: true, runtimeMinutes: true, mainAssetId: true,
  introStartSec: true, introEndSec: true, creditsStartSec: true,
  season: { select: { seasonNumber: true } },
  images: stillSelect,
  mainAsset: { select: { durationSec: true } },
} satisfies Prisma.EpisodeSelect;

type PlayableRow = Prisma.EpisodeGetPayload<{ select: typeof playableSelect }>;
export type PlayableEpisode = PlayableRow & EpKey;

const progressSelect = {
  titleId: true, episodeId: true, positionSec: true, durationSec: true, completed: true, updatedAt: true,
  episode: { select: { episodeNumber: true, season: { select: { seasonNumber: true } } } },
} satisfies Prisma.WatchProgressSelect;
export type ProgressRow = Prisma.WatchProgressGetPayload<{ select: typeof progressSelect }>;

export function progressEpKey(p: Pick<ProgressRow, "episode">): EpKey | null {
  return p.episode ? { seasonNumber: p.episode.season.seasonNumber, episodeNumber: p.episode.episodeNumber } : null;
}

export function progressDto(p: { positionSec: number; durationSec: number; completed: boolean; episodeId: string | null; updatedAt: Date }): WatchProgressDto {
  const ratio = p.durationSec > 0 ? Math.min(1, Math.max(0, p.positionSec / p.durationSec)) : 0;
  return { positionSec: p.positionSec, durationSec: p.durationSec, ratio, completed: p.completed, episodeId: p.episodeId, updatedAt: p.updatedAt.toISOString() };
}

/** Truy vấn phim bộ dùng chung cho catalog (thẻ, chi tiết, xem tiếp) và playback. */
@Injectable()
export class SeriesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ImagePipelineService) private readonly images: ImagePipelineService,
  ) {}

  /** Tập phát được theo title, đã sắp theo mùa → tập (mùa 0 cuối). */
  async playableEpisodes(titleIds: string[]): Promise<Map<string, PlayableEpisode[]>> {
    const out = new Map<string, PlayableEpisode[]>();
    if (!titleIds.length) return out;
    const rows = await this.prisma.episode.findMany({ where: { titleId: { in: titleIds }, ...PLAYABLE_EPISODE }, select: playableSelect });
    for (const r of rows) {
      const list = out.get(r.titleId) ?? [];
      list.push({ ...r, seasonNumber: r.season.seasonNumber });
      out.set(r.titleId, list);
    }
    for (const [k, v] of out) out.set(k, sortEpisodes(v));
    return out;
  }

  async progressRows(profileId: string, titleIds: string[]): Promise<ProgressRow[]> {
    if (!titleIds.length) return [];
    return this.prisma.watchProgress.findMany({
      where: { profileId, titleId: { in: titleIds } }, orderBy: { updatedAt: "desc" }, select: progressSelect,
    });
  }

  /**
   * Tiến độ hiển thị trên thẻ phim bộ: tiến độ tập mới nhất; nếu tập đó đã xem xong (hoặc bị gỡ) thì là tập kế
   * (tiến độ sẵn có của tập kế, hoặc vị trí 0) — `episodeId` luôn là tập sẽ phát. Hết phim → tiến độ completed.
   */
  effectiveSeriesProgress(rows: ProgressRow[], playable: PlayableEpisode[]): WatchProgressDto | null {
    const latest = rows[0];
    if (!latest) return null;
    if (!latest.episodeId) return progressDto(latest);
    const r = pickResume(playable, { episodeId: latest.episodeId, completed: latest.completed, episode: progressEpKey(latest) });
    if (!r || r.kind === "first") return progressDto({ ...latest, completed: true });
    if (r.kind === "progress") return progressDto(latest);
    const own = rows.find((p) => p.episodeId === r.episode.id && !p.completed);
    if (own) return progressDto({ ...own, updatedAt: latest.updatedAt });
    const dur = r.episode.mainAsset?.durationSec ?? (r.episode.runtimeMinutes ? r.episode.runtimeMinutes * 60 : 0);
    return progressDto({ positionSec: 0, durationSec: dur, completed: false, episodeId: r.episode.id, updatedAt: latest.updatedAt });
  }

  /** Tập sẽ phát cho profile (null nếu title không có tập phát được). */
  async resume(profileId: string, titleId: string): Promise<{ episode: PlayableEpisode; kind: "progress" | "next" | "first"; all: PlayableEpisode[] } | null> {
    const [eps, rows] = await Promise.all([
      this.playableEpisodes([titleId]).then((m) => m.get(titleId) ?? []),
      this.prisma.watchProgress.findMany({
        where: { profileId, titleId, episodeId: { not: null } }, orderBy: { updatedAt: "desc" }, take: 1, select: progressSelect,
      }),
    ]);
    const latest = rows[0];
    const r = pickResume(eps, latest ? { episodeId: latest.episodeId, completed: latest.completed, episode: progressEpKey(latest) } : null);
    return r ? { ...r, all: eps } : null;
  }

  next(all: PlayableEpisode[], cur: EpKey): PlayableEpisode | null {
    return nextAfter(all, cur);
  }

  episodeRef(e: PlayableEpisode): EpisodeRef {
    return {
      id: e.id, seasonNumber: e.seasonNumber, episodeNumber: e.episodeNumber, name: e.name,
      still: this.images.imageRef(pickImage(e.images, "STILL")), runtimeMinutes: e.runtimeMinutes,
    };
  }
}
