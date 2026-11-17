import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type HomeRow as HomeRowModel } from "@app/db";
import type {
  CreditDto, EpisodeDto, GenreDto, HomeResponse, HomeRow, Paginated, SeasonDto, TitleCard, TitleDetail, TitleType,
} from "@app/shared";
import { PrismaService } from "../../infra/prisma.service.js";
import { RedisService } from "../../infra/redis.service.js";
import { ApiException } from "../../common/api-exception.js";
import { ImagePipelineService, pickImage } from "../storage/image-pipeline.service.js";
import { CdnSigner } from "../storage/cdn-signer.js";
import { cached } from "./cache.js";
import { TitleCardsService, cardSelect, visibleWhere, type ViewerCtx } from "./title-cards.service.js";
import { SeriesService, progressDto, stillSelect } from "./series.service.js";
import { compareEp } from "./series.js";

export const HOME_ROW_SIZE = 18;
const LIST_CAP = 500;
const CACHE_TTL = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pageParams(page?: string, pageSize?: string, defSize = 24) {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const s = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || defSize)));
  return { page: p, pageSize: s, skip: (p - 1) * s };
}

export function parseType(type?: string): TitleType | undefined {
  if (type === undefined || type === "") return undefined;
  if (type === "MOVIE" || type === "SERIES") return type;
  throw new ApiException(400, "VALIDATION", "type phải là MOVIE hoặc SERIES");
}

const kidsKey = (ctx: ViewerCtx) => (ctx.isKids ? "k" : "a");

export type GenreSort = "popular" | "new" | "year" | "az" | "za";
const GENRE_ORDER: Record<GenreSort, Prisma.TitleOrderByWithRelationInput[]> = {
  popular: [{ tmdbRating: { sort: "desc", nulls: "last" } }, { publishedAt: "desc" }],
  new: [{ publishedAt: { sort: "desc", nulls: "last" } }, { name: "asc" }],
  year: [{ releaseDate: { sort: "desc", nulls: "last" } }, { name: "asc" }],
  az: [{ name: "asc" }],
  za: [{ name: "desc" }],
};

@Injectable()
export class BrowseService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TitleCardsService) private readonly cards: TitleCardsService,
    @Inject(ImagePipelineService) private readonly images: ImagePipelineService,
    @Inject(CdnSigner) private readonly cdn: CdnSigner,
    @Inject(SeriesService) private readonly series: SeriesService,
  ) {}

  // ───────── danh sách id theo loại hàng ─────────

  private async visibleIds(where: Prisma.TitleWhereInput, orderBy: Prisma.TitleOrderByWithRelationInput[], take = LIST_CAP): Promise<string[]> {
    const rows = await this.prisma.title.findMany({ where, orderBy, take, select: { id: true } });
    return rows.map((r) => r.id);
  }

  /** Lọc danh sách id đã xếp hạng theo điều kiện hiển thị, giữ thứ tự. */
  private async filterVisible(ids: string[], where: Prisma.TitleWhereInput): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.title.findMany({ where: { AND: [{ id: { in: ids } }, where] }, select: { id: true } });
    const ok = new Set(rows.map((r) => r.id));
    return ids.filter((id) => ok.has(id));
  }

  /** Trending/Top10: lượt xem 7 ngày; bù bằng phim điểm cao để hàng không trống trên catalog mới. */
  private async rankedByViews(where: Prisma.TitleWhereInput, min: number): Promise<string[]> {
    const views = await this.prisma.viewEvent.groupBy({
      by: ["titleId"],
      where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      _count: { titleId: true },
      orderBy: { _count: { titleId: "desc" } },
      take: 300,
    });
    const ranked = await this.filterVisible(views.map((v) => v.titleId), where);
    if (ranked.length >= min) return ranked;
    const fill = await this.visibleIds(
      { AND: [where, { id: { notIn: ranked } }] },
      [{ tmdbRating: { sort: "desc", nulls: "last" } }, { publishedAt: "desc" }],
      min - ranked.length,
    );
    return [...ranked, ...fill];
  }

  private async myListIds(ctx: ViewerCtx, where: Prisma.TitleWhereInput): Promise<string[]> {
    const rows = await this.prisma.myListItem.findMany({
      where: { profileId: ctx.profileId, title: where }, orderBy: { createdAt: "desc" }, take: LIST_CAP, select: { titleId: true },
    });
    return rows.map((r) => r.titleId);
  }

  /** Toàn bộ id (đã xếp thứ tự) của một hàng, hoặc null nếu hàng không áp dụng cho bộ lọc type. */
  async rowIds(row: HomeRowModel, ctx: ViewerCtx, type?: TitleType): Promise<string[] | null> {
    if (type && row.titleType && row.titleType !== type) return null;
    const effType = type ?? row.titleType ?? undefined;
    const where = visibleWhere(ctx, effType);
    switch (row.kind) {
      case "CONTINUE_WATCHING":
        return this.cards.continueWatchingIds(ctx, where);
      case "MY_LIST":
        return this.myListIds(ctx, where);
    }
    const key = `cat:row:${row.id}:${effType ?? "all"}:${kidsKey(ctx)}`;
    return cached(this.redis, key, CACHE_TTL, async () => {
      switch (row.kind) {
        case "COLLECTION": {
          if (!row.collectionId) return [];
          const items = await this.prisma.collectionItem.findMany({
            where: { collectionId: row.collectionId, title: where }, orderBy: { sortOrder: "asc" }, select: { titleId: true },
          });
          return items.map((i) => i.titleId);
        }
        case "GENRE":
          if (!row.genreId) return [];
          return this.visibleIds({ AND: [where, { genres: { some: { genreId: row.genreId } } }] }, GENRE_ORDER.popular);
        case "TRENDING":
          return (await this.rankedByViews(where, 30)).slice(0, 60);
        case "TOP10":
          return (await this.rankedByViews(where, 10)).slice(0, 10);
        case "NEW_RELEASES":
          return this.visibleIds(where, [{ publishedAt: { sort: "desc", nulls: "last" } }, { releaseDate: { sort: "desc", nulls: "last" } }], 60);
        default:
          return [];
      }
    });
  }

  private rowHref(row: HomeRowModel & { genre?: { slug: string } | null }): string | null {
    if (row.kind === "GENRE" && row.genre) return `/genre/${row.genre.slug}`;
    if (row.kind === "MY_LIST") return "/my-list";
    return null;
  }

  private withRank(row: HomeRowModel, cards: TitleCard[], offset = 0): TitleCard[] {
    if (row.kind !== "TOP10") return cards;
    return cards.map((c, i) => ({ ...c, rank: offset + i + 1 }));
  }

  // ───────── trang chủ ─────────

  async home(ctx: ViewerCtx, type?: TitleType): Promise<HomeResponse> {
    const rows = await this.prisma.homeRow.findMany({
      where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { genre: { select: { slug: true } } },
    });
    const resolved = await Promise.all(rows.map(async (row): Promise<HomeRow | null> => {
      const ids = await this.rowIds(row, ctx, type);
      if (!ids?.length) return null;
      const items = this.withRank(row, await this.cards.cardsByIds(ids.slice(0, HOME_ROW_SIZE), ctx));
      if (!items.length) return null;
      return { id: row.id, kind: row.kind, title: row.title, href: this.rowHref(row), items, hasMore: ids.length > HOME_ROW_SIZE };
    }));
    const billboard = await this.billboard(ctx, type);
    return { billboard, rows: resolved.filter((r): r is HomeRow => !!r) };
  }

  async row(rowId: string, ctx: ViewerCtx, page?: string, pageSize?: string, type?: TitleType): Promise<Paginated<TitleCard>> {
    if (!UUID_RE.test(rowId)) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy hàng");
    const row = await this.prisma.homeRow.findUnique({ where: { id: rowId } });
    if (!row || !row.isActive) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy hàng");
    const p = pageParams(page, pageSize);
    const ids = (await this.rowIds(row, ctx, type)) ?? [];
    const items = this.withRank(row, await this.cards.cardsByIds(ids.slice(p.skip, p.skip + p.pageSize), ctx), p.skip);
    return { items, page: p.page, pageSize: p.pageSize, total: ids.length, hasMore: p.skip + p.pageSize < ids.length };
  }

  async billboard(ctx: ViewerCtx, type?: TitleType): Promise<TitleDetail | null> {
    const where = visibleWhere(ctx, type);
    const candidates = await cached(this.redis, `cat:billboard:${type ?? "all"}:${kidsKey(ctx)}`, CACHE_TTL, async () => {
      const now = new Date();
      const bbs = await this.prisma.billboard.findMany({
        where: {
          isActive: true,
          AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
          title: where,
        },
        orderBy: { sortOrder: "asc" },
        select: { titleId: true },
      });
      if (bbs.length) return bbs.map((b) => b.titleId);
      return this.visibleIds({ AND: [where, { images: { some: { kind: "BACKDROP" } } }] }, [{ publishedAt: { sort: "desc", nulls: "last" } }], 1);
    });
    if (!candidates.length) return null;
    const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
    return this.detail(pick, ctx).catch(() => null);
  }

  // ───────── thể loại ─────────

  async genres(ctx: ViewerCtx): Promise<GenreDto[]> {
    return cached(this.redis, `cat:genres:${kidsKey(ctx)}`, 300, async () => {
      const rows = await this.prisma.genre.findMany({
        where: { titles: { some: { title: visibleWhere(ctx) } } }, orderBy: { name: "asc" }, select: { id: true, slug: true, name: true },
      });
      return rows;
    });
  }

  async genrePage(slug: string, ctx: ViewerCtx, q: { page?: string; pageSize?: string; sort?: string; type?: TitleType }) {
    const genre = await this.prisma.genre.findUnique({ where: { slug }, select: { id: true, slug: true, name: true } });
    if (!genre) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy thể loại");
    const sort = (q.sort && q.sort in GENRE_ORDER ? q.sort : "popular") as GenreSort;
    const p = pageParams(q.page, q.pageSize);
    const where: Prisma.TitleWhereInput = { AND: [visibleWhere(ctx, q.type), { genres: { some: { genreId: genre.id } } }] };
    const [total, rows] = await Promise.all([
      this.prisma.title.count({ where }),
      this.prisma.title.findMany({ where, orderBy: GENRE_ORDER[sort], skip: p.skip, take: p.pageSize, select: cardSelect }),
    ]);
    const items = await this.cards.toCards(rows, ctx);
    return { genre, items, page: p.page, pageSize: p.pageSize, total, hasMore: p.skip + rows.length < total };
  }

  // ───────── tìm kiếm ─────────

  /** Tìm không dấu (unaccent + pg_trgm) theo tên/tên gốc, diễn viên/đạo diễn, thể loại. */
  async searchIds(rawQ: string): Promise<string[]> {
    const q = rawQ.trim().replace(/\s+/g, " ").slice(0, 100);
    if (!q) return [];
    return cached(this.redis, `cat:search:${q.toLowerCase()}`, CACHE_TTL, async () => {
      const like = q.replace(/[\\%_]/g, (m) => `\\${m}`);
      const rows = await this.prisma.$queryRaw<{ id: string; score: number }[]>(Prisma.sql`
        WITH q AS (SELECT lower(public.unaccent(${q}::text)) AS v, lower(public.unaccent(${like}::text)) AS l),
        cand AS (
          SELECT t.id,
            GREATEST(
              CASE WHEN lower(public.unaccent(t.name)) LIKE q.l || '%' THEN 1.0
                   WHEN lower(public.unaccent(t.name)) LIKE '%' || q.l || '%' THEN 0.9 ELSE 0 END,
              CASE WHEN lower(public.unaccent(coalesce(t."originalName", ''))) LIKE '%' || q.l || '%' THEN 0.85 ELSE 0 END,
              public.word_similarity(q.v, lower(public.unaccent(t.name))) * 0.8,
              public.word_similarity(q.v, lower(public.unaccent(coalesce(t."originalName", '')))) * 0.75
            ) AS score
          FROM "Title" t, q
          WHERE t.status = 'PUBLISHED'
          UNION ALL
          SELECT c."titleId",
            CASE WHEN lower(public.unaccent(p.name)) LIKE '%' || q.l || '%' THEN 0.7
                 ELSE public.word_similarity(q.v, lower(public.unaccent(p.name))) * 0.6 END
          FROM "Credit" c JOIN "Person" p ON p.id = c."personId", q
          WHERE c.role IN ('CAST', 'DIRECTOR', 'CREATOR')
          UNION ALL
          SELECT tg."titleId",
            CASE WHEN lower(public.unaccent(g.name)) LIKE '%' || q.l || '%' THEN 0.6
                 WHEN lower(public.unaccent(coalesce(g."nameEn", ''))) LIKE '%' || q.l || '%' THEN 0.55
                 ELSE public.word_similarity(q.v, lower(public.unaccent(g.name))) * 0.5 END
          FROM "TitleGenre" tg JOIN "Genre" g ON g.id = tg."genreId", q
        )
        SELECT id::text AS id, MAX(score)::float8 AS score FROM cand
        GROUP BY id HAVING MAX(score) >= 0.4
        ORDER BY MAX(score) DESC, id
        LIMIT 300`);
      return rows.map((r) => r.id);
    });
  }

  async search(rawQ: string | undefined, ctx: ViewerCtx, page?: string, pageSize?: string, type?: TitleType): Promise<Paginated<TitleCard>> {
    const p = pageParams(page, pageSize);
    const ranked = await this.searchIds(rawQ ?? "");
    const ids = await this.filterVisible(ranked, visibleWhere(ctx, type));
    const items = await this.cards.cardsByIds(ids.slice(p.skip, p.skip + p.pageSize), ctx);
    return { items, page: p.page, pageSize: p.pageSize, total: ids.length, hasMore: p.skip + p.pageSize < ids.length };
  }

  // ───────── chi tiết ─────────

  private titleWhere(idOrSlug: string): Prisma.TitleWhereInput {
    return UUID_RE.test(idOrSlug) ? { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } : { slug: idOrSlug };
  }

  async detail(idOrSlug: string, ctx: ViewerCtx): Promise<TitleDetail> {
    const t = await this.prisma.title.findFirst({
      where: { AND: [this.titleWhere(idOrSlug), visibleWhere(ctx)] },
      select: {
        ...cardSelect,
        originalName: true, tagline: true, countries: true,
        genres: { select: { genre: { select: { id: true, slug: true, name: true } } } },
        credits: { orderBy: { sortOrder: "asc" }, select: { role: true, character: true, person: { select: { id: true, name: true, profileKey: true } } } },
        mainAsset: { select: { status: true, renditions: { select: { height: true } } } },
      },
    });
    if (!t) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy phim");
    const [card] = await this.cards.toCards([{ ...t, genres: t.genres.map((g) => ({ genre: { name: g.genre.name } })) }], ctx);

    const credit = (c: (typeof t.credits)[number]): CreditDto => ({
      id: c.person.id, name: c.person.name, character: c.character,
      profileUrl: c.person.profileKey ? this.cdn.publicUrl(c.person.profileKey) : null,
    });
    const series = t.type === "SERIES" ? await this.seriesPart(t.id, ctx, card!.progress?.episodeId ?? null) : null;
    const movieReady = t.mainAsset?.status === "READY";
    const heights = [
      ...(movieReady ? t.mainAsset!.renditions.map((r) => r.height) : []),
      ...(series?.maxHeight ? [series.maxHeight] : []),
    ];
    return {
      ...card!,
      originalName: t.originalName,
      tagline: t.tagline,
      fullOverview: t.overview,
      releaseDate: t.releaseDate ? t.releaseDate.toISOString().slice(0, 10) : null,
      countries: t.countries,
      genreList: t.genres.map((g) => g.genre),
      cast: t.credits.filter((c) => c.role === "CAST").map(credit),
      directors: t.credits.filter((c) => c.role === "DIRECTOR" || c.role === "CREATOR").map(credit),
      writers: t.credits.filter((c) => c.role === "WRITER").map(credit),
      playable: movieReady || !!series?.resumeEpisode,
      maxAvailableHeight: heights.length ? Math.max(...heights) : null,
      seasons: series?.seasons ?? [],
      resumeEpisode: series?.resumeEpisode ?? null,
      seasonCount: series?.seasons.length ?? 0,
      episodeCount: series?.episodeCount ?? 0,
    };
  }

  /** Mùa có ≥1 tập đã xuất bản (theo thứ tự), số tập đã xuất bản theo mùa. */
  private async visibleSeasons(titleId: string) {
    const seasons = await this.prisma.season.findMany({
      where: { titleId, episodes: { some: { status: "PUBLISHED" } } },
      orderBy: { seasonNumber: "asc" },
      select: { id: true, seasonNumber: true, name: true, overview: true, _count: { select: { episodes: { where: { status: "PUBLISHED" } } } } },
    });
    return seasons.sort((a, b) => compareEp({ seasonNumber: a.seasonNumber, episodeNumber: 0 }, { seasonNumber: b.seasonNumber, episodeNumber: 0 }));
  }

  /** Tập đã xuất bản của một mùa, kèm tiến độ từng tập của profile. */
  private async seasonEpisodes(seasonId: string, seasonNumber: number, ctx: ViewerCtx): Promise<EpisodeDto[]> {
    const eps = await this.prisma.episode.findMany({
      where: { seasonId, status: "PUBLISHED" },
      orderBy: { episodeNumber: "asc" },
      select: {
        id: true, episodeNumber: true, name: true, overview: true, runtimeMinutes: true, airDate: true,
        images: stillSelect, mainAsset: { select: { status: true } },
      },
    });
    const prog = eps.length
      ? await this.prisma.watchProgress.findMany({
        where: { profileId: ctx.profileId, episodeId: { in: eps.map((e) => e.id) } }, orderBy: { updatedAt: "desc" },
        select: { episodeId: true, positionSec: true, durationSec: true, completed: true, updatedAt: true },
      })
      : [];
    const byEp = new Map<string, (typeof prog)[number]>();
    for (const p of prog) if (p.episodeId && !byEp.has(p.episodeId)) byEp.set(p.episodeId, p);
    return eps.map((e) => {
      const p = byEp.get(e.id);
      return {
        id: e.id, episodeNumber: e.episodeNumber, name: e.name, overview: e.overview, runtimeMinutes: e.runtimeMinutes,
        still: this.images.imageRef(pickImage(e.images, "STILL")),
        progress: p ? progressDto(p) : null,
        playable: e.mainAsset?.status === "READY",
        seasonNumber,
        airDate: e.airDate ? e.airDate.toISOString().slice(0, 10) : null,
      };
    });
  }

  private async seriesPart(titleId: string, ctx: ViewerCtx, progressEpisodeId: string | null) {
    const [seasons, resume, maxH] = await Promise.all([
      this.visibleSeasons(titleId),
      this.series.resume(ctx.profileId, titleId),
      this.prisma.rendition.aggregate({
        _max: { height: true },
        where: { asset: { status: "READY", episodeAsMain: { titleId, status: "PUBLISHED" } } },
      }),
    ]);
    // Mùa có tập sẽ phát (hoặc mùa có tập trong tiến độ thẻ) được trả đầy đủ tập; các mùa khác để rỗng.
    const focusEp = resume?.episode ?? (progressEpisodeId ? resume?.all.find((e) => e.id === progressEpisodeId) : undefined);
    const focusSeason = focusEp ? focusEp.seasonNumber : seasons[0]?.seasonNumber;
    const out: SeasonDto[] = [];
    for (const s of seasons) {
      out.push({
        id: s.id, seasonNumber: s.seasonNumber, name: s.name, overview: s.overview, episodeCount: s._count.episodes,
        episodes: s.seasonNumber === focusSeason ? await this.seasonEpisodes(s.id, s.seasonNumber, ctx) : [],
      });
    }
    return {
      seasons: out,
      resumeEpisode: resume ? this.series.episodeRef(resume.episode) : null,
      episodeCount: seasons.reduce((n, s) => n + s._count.episodes, 0),
      maxHeight: maxH._max.height,
    };
  }

  /** GET /titles/:id/episodes?season=N — một mùa (mặc định: mùa của tập "xem tiếp"). */
  async episodes(idOrSlug: string, seasonRaw: string | undefined, ctx: ViewerCtx): Promise<SeasonDto> {
    const t = await this.prisma.title.findFirst({ where: { AND: [this.titleWhere(idOrSlug), visibleWhere(ctx)] }, select: { id: true, type: true } });
    if (!t) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy phim");
    let seasonNumber: number | undefined;
    if (seasonRaw !== undefined && seasonRaw !== "") {
      seasonNumber = Number(seasonRaw);
      if (!Number.isInteger(seasonNumber) || seasonNumber < 0 || seasonNumber > 10_000) throw new ApiException(400, "VALIDATION", "season phải là số nguyên ≥ 0");
    }
    const seasons = await this.visibleSeasons(t.id);
    if (seasonNumber === undefined) {
      const resume = await this.series.resume(ctx.profileId, t.id);
      seasonNumber = resume?.episode.seasonNumber ?? seasons[0]?.seasonNumber;
    }
    const s = seasons.find((x) => x.seasonNumber === seasonNumber);
    if (!s) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy mùa phim");
    return {
      id: s.id, seasonNumber: s.seasonNumber, name: s.name, overview: s.overview, episodeCount: s._count.episodes,
      episodes: await this.seasonEpisodes(s.id, s.seasonNumber, ctx),
    };
  }

  async similar(id: string, ctx: ViewerCtx): Promise<TitleCard[]> {
    if (!UUID_RE.test(id)) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy phim");
    const exists = await this.prisma.title.findFirst({ where: { AND: [{ id }, visibleWhere(ctx)] }, select: { id: true } });
    if (!exists) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy phim");
    const ranked = await cached(this.redis, `cat:similar:${id}`, 300, async () => {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT x.id::text AS id FROM (
          SELECT tg2."titleId" AS id, 1 AS w
          FROM "TitleGenre" tg1 JOIN "TitleGenre" tg2 ON tg2."genreId" = tg1."genreId"
          WHERE tg1."titleId" = ${id}::uuid AND tg2."titleId" <> ${id}::uuid
          UNION ALL
          SELECT c2."titleId", 2
          FROM "Credit" c1 JOIN "Credit" c2 ON c2."personId" = c1."personId"
          WHERE c1."titleId" = ${id}::uuid AND c2."titleId" <> ${id}::uuid
        ) x JOIN "Title" t ON t.id = x.id
        WHERE t.status = 'PUBLISHED'
        GROUP BY x.id, t."tmdbRating"
        ORDER BY SUM(x.w) DESC, t."tmdbRating" DESC NULLS LAST
        LIMIT 60`);
      return rows.map((r) => r.id);
    });
    const ids = await this.filterVisible(ranked, visibleWhere(ctx));
    return this.cards.cardsByIds(ids.slice(0, 12), ctx);
  }
}
