import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@app/db";
import type { TitleCard, TitleType, WatchProgressDto } from "@app/shared";
import { PrismaService } from "../../infra/prisma.service.js";
import { ImagePipelineService, pickImage } from "../storage/image-pipeline.service.js";
import { SeriesService, progressDto, type ProgressRow } from "./series.service.js";

/** Nhãn độ tuổi được phép cho hồ sơ trẻ em. */
export const KIDS_SAFE_RATINGS = ["P", "K", "G", "PG", "TV-Y", "TV-Y7", "TV-G", "U", "0+", "6+"];
export const NEW_WINDOW_DAYS = 14;

export interface ViewerCtx { profileId: string; isKids: boolean }

/** Điều kiện title hiển thị cho người xem (PUBLISHED + lọc trẻ em + loại). */
export function visibleWhere(ctx: Pick<ViewerCtx, "isKids">, type?: TitleType | null): Prisma.TitleWhereInput {
  return {
    status: "PUBLISHED",
    ...(ctx.isKids ? { maturityRating: { in: KIDS_SAFE_RATINGS } } : {}),
    ...(type ? { type } : {}),
  };
}

export const cardSelect = {
  id: true, slug: true, type: true, name: true, releaseDate: true, runtimeMinutes: true, maturityRating: true,
  overview: true, tmdbRating: true, publishedAt: true,
  genres: { select: { genre: { select: { name: true } } } },
  images: { where: { kind: { in: ["POSTER", "BACKDROP", "LOGO"] } }, select: { kind: true, key: true, width: true, height: true, blurData: true, isPrimary: true } },
  previewAsset: { select: { status: true } },
} satisfies Prisma.TitleSelect;

export type CardRow = Prisma.TitleGetPayload<{ select: typeof cardSelect }>;

export function matchScore(tmdbRating: number | null): number | null {
  if (tmdbRating == null || tmdbRating <= 0) return null;
  return Math.max(50, Math.min(99, Math.round(55 + tmdbRating * 5)));
}

export function shortOverview(s: string | null, max = 220): string | null {
  if (!s || s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

export { progressDto };

/** Dựng TitleCard theo lô: 1 query title + 3 query cờ cá nhân (my list, rating, progress) — không N+1. */
@Injectable()
export class TitleCardsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ImagePipelineService) private readonly images: ImagePipelineService,
    @Inject(SeriesService) private readonly series: SeriesService,
  ) {}

  /**
   * Tiến độ hiển thị theo title cho profile. Phim lẻ: bản ghi mới nhất. Phim bộ: tiến độ của tập mới nhất, hoặc
   * tập kế nếu tập đó đã xem xong (xem `SeriesService.effectiveSeriesProgress`) — `episodeId` là tập sẽ phát.
   */
  async effectiveProgress(profileId: string, titles: { id: string; type: TitleType }[]): Promise<Map<string, WatchProgressDto>> {
    const out = new Map<string, WatchProgressDto>();
    const rows = await this.series.progressRows(profileId, titles.map((t) => t.id));
    const byTitle = new Map<string, ProgressRow[]>();
    for (const r of rows) {
      const l = byTitle.get(r.titleId) ?? [];
      l.push(r);
      byTitle.set(r.titleId, l);
    }
    const seriesIds = titles.filter((t) => t.type === "SERIES" && byTitle.get(t.id)?.[0]?.episodeId).map((t) => t.id);
    const playable = await this.series.playableEpisodes(seriesIds);
    for (const t of titles) {
      const list = byTitle.get(t.id);
      if (!list?.length) continue;
      const p = t.type === "SERIES" && list[0]!.episodeId
        ? this.series.effectiveSeriesProgress(list, playable.get(t.id) ?? [])
        : progressDto(list[0]!);
      if (p) out.set(t.id, p);
    }
    return out;
  }

  /** Id title cho "Xem tiếp": mới nhất trước; phim bộ còn ở lại khi xem xong một tập mà còn tập kế. */
  async continueWatchingIds(ctx: ViewerCtx, where: Prisma.TitleWhereInput): Promise<string[]> {
    const rows = await this.prisma.watchProgress.findMany({
      where: { profileId: ctx.profileId, title: where },
      orderBy: { updatedAt: "desc" },
      distinct: ["titleId"],
      take: 100,
      select: { titleId: true, title: { select: { type: true } } },
    });
    const progress = await this.effectiveProgress(ctx.profileId, rows.map((r) => ({ id: r.titleId, type: r.title.type })));
    return rows.filter((r) => progress.get(r.titleId)?.completed === false).map((r) => r.titleId);
  }

  /** Thẻ theo danh sách id, giữ nguyên thứ tự, bỏ id không hiển thị được. */
  async cardsByIds(ids: string[], ctx: ViewerCtx, extraWhere: Prisma.TitleWhereInput = {}): Promise<TitleCard[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.title.findMany({ where: { AND: [{ id: { in: ids } }, visibleWhere(ctx), extraWhere] }, select: cardSelect });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.map((id) => byId.get(id)).filter((r): r is CardRow => !!r);
    return this.toCards(ordered, ctx);
  }

  async toCards(rows: CardRow[], ctx: ViewerCtx): Promise<TitleCard[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [list, ratings, progress] = await Promise.all([
      this.prisma.myListItem.findMany({ where: { profileId: ctx.profileId, titleId: { in: ids } }, select: { titleId: true } }),
      this.prisma.rating.findMany({ where: { profileId: ctx.profileId, titleId: { in: ids } }, select: { titleId: true, value: true } }),
      this.effectiveProgress(ctx.profileId, rows),
    ]);
    const inList = new Set(list.map((l) => l.titleId));
    const ratingBy = new Map(ratings.map((r) => [r.titleId, r.value]));
    const newSince = Date.now() - NEW_WINDOW_DAYS * 86_400_000;
    return rows.map((r) => {
      return {
        id: r.id,
        slug: r.slug,
        type: r.type,
        name: r.name,
        year: r.releaseDate ? r.releaseDate.getUTCFullYear() : null,
        runtimeMinutes: r.runtimeMinutes,
        maturityRating: r.maturityRating,
        overview: shortOverview(r.overview),
        genres: r.genres.map((g) => g.genre.name),
        poster: this.images.imageRef(pickImage(r.images, "POSTER")),
        backdrop: this.images.imageRef(pickImage(r.images, "BACKDROP")),
        logo: this.images.imageRef(pickImage(r.images, "LOGO")),
        matchScore: matchScore(r.tmdbRating),
        hasPreview: r.previewAsset?.status === "READY",
        isNew: !!r.publishedAt && r.publishedAt.getTime() >= newSince,
        inMyList: inList.has(r.id),
        rating: ratingBy.get(r.id) ?? null,
        progress: progress.get(r.id) ?? null,
      } satisfies TitleCard;
    });
  }
}
