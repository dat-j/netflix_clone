import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@app/db";
import type { TitleCard, TitleType, WatchProgressDto } from "@app/shared";
import { PrismaService } from "../../infra/prisma.service.js";
import { ImagePipelineService, pickImage } from "../storage/image-pipeline.service.js";

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

export function progressDto(p: { positionSec: number; durationSec: number; completed: boolean; episodeId: string | null; updatedAt: Date }): WatchProgressDto {
  const ratio = p.durationSec > 0 ? Math.min(1, Math.max(0, p.positionSec / p.durationSec)) : 0;
  return { positionSec: p.positionSec, durationSec: p.durationSec, ratio, completed: p.completed, episodeId: p.episodeId, updatedAt: p.updatedAt.toISOString() };
}

/** Dựng TitleCard theo lô: 1 query title + 3 query cờ cá nhân (my list, rating, progress) — không N+1. */
@Injectable()
export class TitleCardsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ImagePipelineService) private readonly images: ImagePipelineService,
  ) {}

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
      this.prisma.watchProgress.findMany({
        where: { profileId: ctx.profileId, titleId: { in: ids } },
        orderBy: { updatedAt: "desc" },
        select: { titleId: true, positionSec: true, durationSec: true, completed: true, episodeId: true, updatedAt: true },
      }),
    ]);
    const inList = new Set(list.map((l) => l.titleId));
    const ratingBy = new Map(ratings.map((r) => [r.titleId, r.value]));
    const progressBy = new Map<string, (typeof progress)[number]>();
    for (const p of progress) if (!progressBy.has(p.titleId)) progressBy.set(p.titleId, p);
    const newSince = Date.now() - NEW_WINDOW_DAYS * 86_400_000;
    return rows.map((r) => {
      const p = progressBy.get(r.id);
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
        progress: p ? progressDto(p) : null,
      } satisfies TitleCard;
    });
  }
}
