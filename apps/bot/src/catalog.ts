/**
 * Read-only catalog access for the bot (PUBLISHED titles only; no personalisation — the bot has no user session).
 * Mirrors the API's rules: trending = ViewEvent last 7 days with rating fallback, new = publishedAt desc,
 * accent-insensitive search via unaccent + pg_trgm.
 */
import { Prisma, type PrismaClient } from "@app/db";
import type { ListRef } from "./lib/callback.js";

export type TitleKind = "MOVIE" | "SERIES";

export interface TitleCard {
  id: string;
  slug: string;
  type: TitleKind;
  name: string;
  year: number | null;
  runtimeMinutes: number | null;
  maturityRating: string | null;
  rating: number | null;
  genres: string[];
  posterKey: string | null;
  backdropKey: string | null;
  logoKey: string | null;
  overview: string | null;
  /** Series only: seasons with ≥1 PUBLISHED episode (undefined/0 for movies or series without episodes yet). */
  seasonCount?: number;
}

/** A PUBLISHED episode (drafts/archived episodes never leave the catalog). */
export interface EpisodeInfo {
  id: string;
  episodeNumber: number;
  name: string | null;
  overview: string | null;
  runtimeMinutes: number | null;
  stillKey: string | null;
  /** main asset transcoded and READY */
  playable: boolean;
}

export interface SeasonInfo {
  seasonNumber: number;
  name: string | null;
  /** PUBLISHED episodes only, by episode number; seasons without any are omitted. */
  episodes: EpisodeInfo[];
}

export interface TitleDetail extends TitleCard {
  originalName: string | null;
  tagline: string | null;
  countries: string[];
  genreList: { slug: string; name: string }[];
  directors: string[];
  cast: string[];
  playable: boolean;
  maxHeight: number | null;
  seasons: SeasonInfo[];
}

export interface GenreInfo { slug: string; name: string; count: number }

export interface Billboard { title: TitleCard }

/** Everything the bot reads. Implemented over Prisma; tests can substitute a fake. */
export interface Catalog {
  /** Ordered title ids for a list (search lists need the resolved query text). */
  listIds(list: ListRef, query?: string): Promise<string[]>;
  cards(ids: string[]): Promise<TitleCard[]>;
  detail(id: string): Promise<TitleDetail | null>;
  genres(): Promise<GenreInfo[]>;
  genre(slug: string): Promise<{ slug: string; name: string } | null>;
  billboard(): Promise<TitleCard | null>;
  search(query: string, limit?: number): Promise<string[]>;
}

const LIST_CAP = 200;
const CACHE_MS = 60_000;

const cardSelect = {
  id: true, slug: true, type: true, name: true, releaseDate: true, runtimeMinutes: true, maturityRating: true,
  tmdbRating: true, overview: true,
  genres: { select: { genre: { select: { name: true } } } },
  images: { where: { kind: { in: ["POSTER", "BACKDROP", "LOGO"] } }, select: { kind: true, key: true, isPrimary: true } },
  _count: { select: { seasons: { where: { episodes: { some: { status: "PUBLISHED" } } } } } },
} satisfies Prisma.TitleSelect;
type CardRow = Prisma.TitleGetPayload<{ select: typeof cardSelect }>;

export function pickImageKey(images: { kind: string; key: string; isPrimary: boolean }[], kind: string): string | null {
  let best: { key: string; isPrimary: boolean } | null = null;
  for (const img of images) {
    if (img.kind !== kind) continue;
    if (!best || (img.isPrimary && !best.isPrimary)) best = img;
  }
  return best?.key ?? null;
}

function toCard(r: CardRow): TitleCard {
  return {
    id: r.id,
    slug: r.slug,
    type: r.type,
    name: r.name,
    year: r.releaseDate ? r.releaseDate.getUTCFullYear() : null,
    runtimeMinutes: r.runtimeMinutes,
    maturityRating: r.maturityRating,
    rating: r.tmdbRating != null && r.tmdbRating > 0 ? r.tmdbRating : null,
    genres: r.genres.map((g) => g.genre.name),
    posterKey: pickImageKey(r.images, "POSTER"),
    backdropKey: pickImageKey(r.images, "BACKDROP"),
    logoKey: pickImageKey(r.images, "LOGO"),
    overview: r.overview,
    ...(r.type === "SERIES" ? { seasonCount: r._count.seasons } : {}),
  };
}

/** Specials (season 0) go last, like on the web; everything else by season number. */
export function seasonOrder(a: { seasonNumber: number }, b: { seasonNumber: number }): number {
  const ka = a.seasonNumber === 0 ? Number.MAX_SAFE_INTEGER : a.seasonNumber;
  const kb = b.seasonNumber === 0 ? Number.MAX_SAFE_INTEGER : b.seasonNumber;
  return ka - kb;
}

const PUBLISHED: Prisma.TitleWhereInput = { status: "PUBLISHED" };
const BY_RATING: Prisma.TitleOrderByWithRelationInput[] = [{ tmdbRating: { sort: "desc", nulls: "last" } }, { publishedAt: "desc" }];

export class PrismaCatalog implements Catalog {
  private readonly memo = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(private readonly prisma: PrismaClient, private readonly cacheMs = CACHE_MS) {}

  /** Tiny in-process TTL memo: list ids change rarely and every page flip would otherwise re-query. */
  private cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.memo.get(key);
    if (hit && Date.now() - hit.at < this.cacheMs) return hit.value as Promise<T>;
    const value = fn();
    this.memo.set(key, { at: Date.now(), value });
    value.catch(() => this.memo.delete(key));
    if (this.memo.size > 500) this.memo.delete(this.memo.keys().next().value!);
    return value;
  }

  private async ids(where: Prisma.TitleWhereInput, orderBy: Prisma.TitleOrderByWithRelationInput[], take = LIST_CAP) {
    const rows = await this.prisma.title.findMany({ where: { AND: [PUBLISHED, where] }, orderBy, take, select: { id: true } });
    return rows.map((r) => r.id);
  }

  async listIds(list: ListRef, query?: string): Promise<string[]> {
    switch (list.kind) {
      case "movies":
        return this.cached("movies", () => this.ids({ type: "MOVIE" }, [{ publishedAt: { sort: "desc", nulls: "last" } }, { name: "asc" }]));
      case "series":
        return this.cached("series", () => this.ids({ type: "SERIES" }, [{ publishedAt: { sort: "desc", nulls: "last" } }, { name: "asc" }]));
      case "new":
        return this.cached("new", () =>
          this.ids({}, [{ publishedAt: { sort: "desc", nulls: "last" } }, { releaseDate: { sort: "desc", nulls: "last" } }], 40));
      case "hot":
        return this.cached("hot", () => this.trending(40));
      case "genre":
        return this.cached(`g:${list.slug}`, () => this.ids({ genres: { some: { genre: { slug: list.slug } } } }, BY_RATING));
      case "search":
        return query ? this.search(query) : [];
    }
  }

  /** Same ranking as the API's TRENDING row: views in the last 7 days, topped up with the best-rated titles. */
  private async trending(min: number): Promise<string[]> {
    const views = await this.prisma.viewEvent.groupBy({
      by: ["titleId"],
      where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      _count: { titleId: true },
      orderBy: { _count: { titleId: "desc" } },
      take: 300,
    });
    const viewed = views.map((v) => v.titleId);
    const visible = new Set(viewed.length ? await this.ids({ id: { in: viewed } }, [], 300) : []);
    const ranked = viewed.filter((id) => visible.has(id)).slice(0, min);
    if (ranked.length >= min) return ranked;
    const fill = await this.ids({ id: { notIn: ranked } }, BY_RATING, min - ranked.length);
    return [...ranked, ...fill];
  }

  async cards(ids: string[]): Promise<TitleCard[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.title.findMany({ where: { AND: [PUBLISHED, { id: { in: ids } }] }, select: cardSelect });
    const byId = new Map(rows.map((r) => [r.id, toCard(r)]));
    return ids.map((id) => byId.get(id)).filter((c): c is TitleCard => !!c);
  }

  async detail(id: string): Promise<TitleDetail | null> {
    const t = await this.prisma.title.findFirst({
      where: { AND: [PUBLISHED, { id }] },
      select: {
        ...cardSelect,
        originalName: true, tagline: true, countries: true,
        genres: { select: { genre: { select: { slug: true, name: true } } } },
        credits: { orderBy: { sortOrder: "asc" }, select: { role: true, person: { select: { name: true } } } },
        mainAsset: { select: { status: true, renditions: { select: { height: true } } } },
        seasons: {
          orderBy: { seasonNumber: "asc" },
          select: {
            seasonNumber: true, name: true,
            episodes: {
              where: { status: "PUBLISHED" },
              orderBy: { episodeNumber: "asc" },
              select: {
                id: true, episodeNumber: true, name: true, overview: true, runtimeMinutes: true,
                images: { where: { kind: "STILL" }, select: { kind: true, key: true, isPrimary: true } },
                mainAsset: { select: { status: true, renditions: { select: { height: true } } } },
              },
            },
          },
        },
      },
    });
    if (!t) return null;
    const seasons = t.seasons.filter((s) => s.episodes.length > 0).sort(seasonOrder);
    const card = toCard({ ...t, genres: t.genres.map((g) => ({ genre: { name: g.genre.name } })), _count: { seasons: seasons.length } });
    const ready = [
      ...(t.mainAsset?.status === "READY" ? [t.mainAsset] : []),
      ...t.seasons.flatMap((s) => s.episodes.map((e) => e.mainAsset).filter((a) => a?.status === "READY")),
    ];
    const heights = ready.flatMap((a) => a!.renditions.map((r) => r.height));
    return {
      ...card,
      originalName: t.originalName,
      tagline: t.tagline,
      countries: t.countries,
      genreList: t.genres.map((g) => g.genre),
      directors: t.credits.filter((c) => c.role === "DIRECTOR" || c.role === "CREATOR").map((c) => c.person.name),
      cast: t.credits.filter((c) => c.role === "CAST").map((c) => c.person.name),
      playable: ready.length > 0,
      maxHeight: heights.length ? Math.max(...heights) : null,
      seasons: seasons.map((s) => ({
        seasonNumber: s.seasonNumber,
        name: s.name,
        episodes: s.episodes.map((e) => ({
          id: e.id,
          episodeNumber: e.episodeNumber,
          name: e.name,
          overview: e.overview,
          runtimeMinutes: e.runtimeMinutes,
          stillKey: pickImageKey(e.images, "STILL"),
          playable: e.mainAsset?.status === "READY",
        })),
      })),
    };
  }

  genres(): Promise<GenreInfo[]> {
    return this.cached("genres", async () => {
      const rows = await this.prisma.genre.findMany({
        select: { slug: true, name: true, _count: { select: { titles: { where: { title: PUBLISHED } } } } },
        orderBy: { name: "asc" },
      });
      return rows
        .map((r) => ({ slug: r.slug, name: r.name, count: r._count.titles }))
        .filter((g) => g.count > 0)
        .sort((a, b) => a.name.localeCompare(b.name, "vi"));
    });
  }

  async genre(slug: string) {
    return this.prisma.genre.findUnique({ where: { slug }, select: { slug: true, name: true } });
  }

  async billboard(): Promise<TitleCard | null> {
    const ids = await this.cached("billboard", async () => {
      const now = new Date();
      const bbs = await this.prisma.billboard.findMany({
        where: {
          isActive: true,
          AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
          title: { ...PUBLISHED, images: { some: { kind: "BACKDROP" } } },
        },
        orderBy: { sortOrder: "asc" },
        select: { titleId: true },
      });
      if (bbs.length) return bbs.map((b) => b.titleId);
      return this.ids({ images: { some: { kind: "BACKDROP" } } }, [{ publishedAt: { sort: "desc", nulls: "last" } }], 1);
    });
    if (!ids.length) return null;
    // Stable within the cache window so the home banner's file_id is reused instead of re-rendered per user.
    const [card] = await this.cards([ids[0]!]);
    return card ?? null;
  }

  /** Accent-insensitive search — the same scoring query as the API's BrowseService.searchIds. */
  search(rawQ: string, limit = 100): Promise<string[]> {
    const q = rawQ.trim().replace(/\s+/g, " ").slice(0, 100);
    if (!q) return Promise.resolve([]);
    return this.cached(`q:${q.toLowerCase()}:${limit}`, async () => {
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
        SELECT cand.id::text AS id, MAX(cand.score)::float8 AS score
        FROM cand JOIN "Title" t ON t.id = cand.id AND t.status = 'PUBLISHED'
        GROUP BY cand.id HAVING MAX(cand.score) >= 0.4
        ORDER BY MAX(cand.score) DESC, cand.id
        LIMIT ${limit}`);
      return rows.map((r) => r.id);
    });
  }
}
