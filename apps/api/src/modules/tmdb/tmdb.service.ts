import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@app/db";
import type { AdminTitle, TitleType, TmdbSearchResult } from "@app/shared";
import { PrismaService } from "../../infra/prisma.service.js";
import { RedisService } from "../../infra/redis.service.js";
import { ApiException } from "../../common/api-exception.js";
import { ImagePipelineService } from "../storage/image-pipeline.service.js";
import { AdminTitlesService } from "../admin-content/admin-titles.service.js";
import { slugify, pickUniqueSlug } from "../admin-content/slug.js";
import { invalidateCatalogCache } from "../catalog/cache.js";
import { TMDB_IMG, TmdbClient } from "./tmdb.client.js";
import { IMPORT_STILL_BUDGET, TmdbSeasonsService } from "./tmdb-seasons.service.js";

// ───────── kiểu dữ liệu TMDB (rút gọn) ─────────
interface TmdbSearchItem {
  id: number; media_type?: string; title?: string; name?: string; original_title?: string; original_name?: string;
  release_date?: string; first_air_date?: string; overview?: string; poster_path?: string | null;
}
interface TmdbGenre { id: number; name: string }
interface TmdbCast { id: number; name: string; character?: string; order?: number; profile_path?: string | null; roles?: { character: string }[] }
interface TmdbCrew { id: number; name: string; job?: string; department?: string; profile_path?: string | null; jobs?: { job: string }[] }
interface TmdbImage { file_path: string; iso_639_1: string | null; vote_average?: number; width?: number }
interface TmdbDetail {
  id: number; title?: string; name?: string; original_title?: string; original_name?: string; tagline?: string; overview?: string;
  release_date?: string; first_air_date?: string; runtime?: number | null; episode_run_time?: number[];
  genres?: TmdbGenre[]; production_countries?: { iso_3166_1: string }[]; origin_country?: string[]; original_language?: string;
  vote_average?: number; imdb_id?: string | null; poster_path?: string | null; backdrop_path?: string | null;
  credits?: { cast?: TmdbCast[]; crew?: TmdbCrew[] };
  aggregate_credits?: { cast?: TmdbCast[]; crew?: TmdbCrew[] };
  created_by?: { id: number; name: string; profile_path?: string | null }[];
  release_dates?: { results: { iso_3166_1: string; release_dates: { certification: string; type?: number }[] }[] };
  content_ratings?: { results: { iso_3166_1: string; rating: string }[] };
  images?: { logos?: TmdbImage[]; posters?: TmdbImage[]; backdrops?: TmdbImage[] };
  external_ids?: { imdb_id?: string | null };
}

/** Quy đổi chứng nhận TMDB (ưu tiên VN, sau đó US) sang nhãn độ tuổi hiển thị P/K/T13/T16/T18. */
const CERT_MAP: Record<string, string> = {
  // US movie
  G: "P", PG: "K", "PG-13": "T13", R: "T16", "NC-17": "T18", NR: "",
  // US TV
  "TV-Y": "P", "TV-Y7": "P", "TV-G": "P", "TV-PG": "K", "TV-14": "T13", "TV-MA": "T18",
};
const VN_LABELS = new Set(["P", "K", "T13", "T16", "T18", "C"]);

export function mapCertification(byCountry: Record<string, string>): string | null {
  const vn = byCountry.VN?.trim().toUpperCase();
  if (vn && VN_LABELS.has(vn)) return vn;
  if (vn && /^\d+$/.test(vn)) return Number(vn) >= 18 ? "T18" : Number(vn) >= 16 ? "T16" : Number(vn) >= 13 ? "T13" : "K";
  const us = byCountry.US?.trim().toUpperCase();
  if (us && CERT_MAP[us]) return CERT_MAP[us]!;
  return null;
}

const yearOf = (d?: string) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);

@Injectable()
export class TmdbService {
  private readonly logger = new Logger("TmdbService");

  constructor(
    @Inject(TmdbClient) private readonly tmdb: TmdbClient,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ImagePipelineService) private readonly images: ImagePipelineService,
    @Inject(AdminTitlesService) private readonly titles: AdminTitlesService,
    @Inject(TmdbSeasonsService) private readonly seasons: TmdbSeasonsService,
  ) {}

  private kindPath(type: TitleType) {
    return type === "MOVIE" ? "movie" : "tv";
  }

  async search(q: string | undefined, typeRaw?: string): Promise<TmdbSearchResult[]> {
    this.tmdb.assertEnabled();
    const query = (q ?? "").trim();
    if (!query) return [];
    const type = typeRaw === "MOVIE" || typeRaw === "SERIES" ? typeRaw : undefined;
    const path = type ? `/search/${this.kindPath(type)}` : "/search/multi";
    const [vi, en] = await Promise.all([
      this.tmdb.get<{ results: TmdbSearchItem[] }>(path, { query, language: "vi-VN", include_adult: "false" }),
      this.tmdb.get<{ results: TmdbSearchItem[] }>(path, { query, language: "en-US", include_adult: "false" }).catch(() => ({ results: [] })),
    ]);
    const enById = new Map(en.results.map((r) => [r.id, r]));
    const items = vi.results
      .filter((r) => type || r.media_type === "movie" || r.media_type === "tv")
      .slice(0, 20)
      .map((r) => {
        const t: TitleType = type ?? (r.media_type === "tv" ? "SERIES" : "MOVIE");
        const e = enById.get(r.id);
        return {
          tmdbId: r.id, type: t,
          name: r.title || r.name || e?.title || e?.name || "",
          originalName: r.original_title || r.original_name || null,
          year: yearOf(r.release_date || r.first_air_date),
          overview: r.overview || e?.overview || null,
          posterUrl: r.poster_path ? `${TMDB_IMG}/w342${r.poster_path}` : e?.poster_path ? `${TMDB_IMG}/w342${e.poster_path}` : null,
          alreadyImported: false as boolean,
        } satisfies TmdbSearchResult;
      });
    if (items.length) {
      const existing = await this.prisma.title.findMany({
        where: { OR: (["MOVIE", "SERIES"] as const).map((t) => ({ type: t, tmdbId: { in: items.filter((i) => i.type === t).map((i) => i.tmdbId) } })) },
        select: { type: true, tmdbId: true },
      });
      const set = new Set(existing.map((e) => `${e.type}:${e.tmdbId}`));
      for (const i of items) i.alreadyImported = set.has(`${i.type}:${i.tmdbId}`);
    }
    return items;
  }

  private async fetchDetail(tmdbId: number, type: TitleType): Promise<{ vi: TmdbDetail; en: TmdbDetail }> {
    const append = type === "MOVIE" ? "credits,release_dates,images,external_ids" : "credits,aggregate_credits,content_ratings,images,external_ids";
    const p = `/${this.kindPath(type)}/${tmdbId}`;
    const [vi, en] = await Promise.all([
      this.tmdb.get<TmdbDetail>(p, { language: "vi-VN", append_to_response: append, include_image_language: "vi,en,null" }),
      this.tmdb.get<TmdbDetail>(p, { language: "en-US" }),
    ]);
    return { vi, en };
  }

  private certification(d: TmdbDetail): string | null {
    const by: Record<string, string> = {};
    for (const r of d.release_dates?.results ?? []) {
      const c = r.release_dates.map((x) => x.certification).find((x) => x?.trim());
      if (c) by[r.iso_3166_1] = c;
    }
    for (const r of d.content_ratings?.results ?? []) if (r.rating?.trim()) by[r.iso_3166_1] = r.rating;
    return mapCertification(by);
  }

  /** Genre theo tmdbId; tạo mới (tên tiếng Việt, nameEn) nếu chưa có. */
  private async ensureGenres(vi: TmdbGenre[], en: TmdbGenre[]): Promise<string[]> {
    const enName = new Map(en.map((g) => [g.id, g.name]));
    const ids: string[] = [];
    for (const g of vi) {
      const existing = await this.prisma.genre.findUnique({ where: { tmdbId: g.id }, select: { id: true } });
      if (existing) { ids.push(existing.id); continue; }
      const name = g.name || enName.get(g.id) || `Genre ${g.id}`;
      const base = slugify(name);
      const taken = await this.prisma.genre.findMany({ where: { slug: { startsWith: base } }, select: { slug: true, tmdbId: true, id: true } });
      // Genre seed có cùng slug nhưng chưa có tmdbId → gắn tmdbId vào genre đó
      const sameSlug = taken.find((t) => t.slug === base && t.tmdbId === null);
      if (sameSlug) {
        await this.prisma.genre.update({ where: { id: sameSlug.id }, data: { tmdbId: g.id, nameEn: enName.get(g.id) ?? null } });
        ids.push(sameSlug.id);
        continue;
      }
      const created = await this.prisma.genre.create({
        data: { tmdbId: g.id, name, nameEn: enName.get(g.id) ?? null, slug: pickUniqueSlug(base, taken.map((t) => t.slug)) },
      });
      ids.push(created.id);
    }
    return ids;
  }

  private metadata(type: TitleType, vi: TmdbDetail, en: TmdbDetail) {
    const runtime = type === "MOVIE" ? (vi.runtime ?? en.runtime ?? null) : (vi.episode_run_time?.[0] ?? en.episode_run_time?.[0] ?? null);
    const countries = vi.production_countries?.map((c) => c.iso_3166_1) ?? vi.origin_country ?? [];
    return {
      name: vi.title || vi.name || en.title || en.name || `TMDB ${vi.id}`,
      originalName: vi.original_title || vi.original_name || null,
      tagline: vi.tagline || en.tagline || null,
      overview: vi.overview || en.overview || null,
      releaseDate: (vi.release_date || vi.first_air_date || null) as string | null,
      runtimeMinutes: runtime || null,
      maturityRating: this.certification(vi),
      countries: [...new Set(countries)].slice(0, 10),
    };
  }

  private async syncCredits(titleId: string, type: TitleType, d: TmdbDetail) {
    const cast = (type === "SERIES" ? d.aggregate_credits?.cast : undefined) ?? d.credits?.cast ?? [];
    const crew = d.credits?.crew ?? [];
    const entries: { p: { id: number; name: string; profile_path?: string | null }; role: "CAST" | "DIRECTOR" | "WRITER" | "CREATOR"; character: string | null; order: number }[] = [];
    cast.slice(0, 12).forEach((c, i) => entries.push({ p: c, role: "CAST", character: c.character ?? c.roles?.[0]?.character ?? null, order: i }));
    crew.filter((c) => c.job === "Director").slice(0, 3).forEach((c, i) => entries.push({ p: c, role: "DIRECTOR", character: null, order: i }));
    crew.filter((c) => c.job === "Screenplay" || c.job === "Writer" || c.job === "Novel").slice(0, 3)
      .forEach((c, i) => entries.push({ p: c, role: "WRITER", character: null, order: i }));
    (d.created_by ?? []).slice(0, 3).forEach((c, i) => entries.push({ p: c, role: "CREATOR", character: null, order: i }));

    const seen = new Set<string>();
    const rows: Prisma.CreditCreateManyInput[] = [];
    for (const e of entries) {
      const person = await this.prisma.person.upsert({
        where: { tmdbId: e.p.id }, create: { tmdbId: e.p.id, name: e.p.name }, update: { name: e.p.name },
      });
      if (!person.profileKey && e.p.profile_path && e.role === "CAST" && e.order < 10) {
        const buf = await this.tmdb.download(e.p.profile_path, "w185");
        if (buf) {
          const key = await this.images.savePersonImage(person.id, buf).catch(() => null);
          if (key) await this.prisma.person.update({ where: { id: person.id }, data: { profileKey: key } });
        }
      }
      const k = `${person.id}:${e.role}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({ titleId, personId: person.id, role: e.role, character: e.character, sortOrder: e.order });
    }
    await this.prisma.$transaction([
      this.prisma.credit.deleteMany({ where: { titleId } }),
      this.prisma.credit.createMany({ data: rows }),
    ]);
  }

  private pickLogo(d: TmdbDetail): string | null {
    const logos = d.images?.logos ?? [];
    const by = (lang: string | null) => logos.filter((l) => l.iso_639_1 === lang && !l.file_path.endsWith(".svg"))
      .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))[0];
    return (by("vi") ?? by("en") ?? by(null))?.file_path ?? null;
  }

  /** Ảnh: chỉ tải loại còn thiếu (không ghi đè ảnh admin đã upload), trừ khi `replace`. */
  private async syncImages(titleId: string, vi: TmdbDetail, en: TmdbDetail, replace: boolean) {
    const have = new Set((await this.prisma.image.findMany({ where: { titleId }, select: { kind: true } })).map((i) => i.kind));
    const jobs: [kind: "POSTER" | "BACKDROP" | "LOGO", path: string | null | undefined, size: string][] = [
      ["POSTER", vi.poster_path ?? en.poster_path, "w780"],
      ["BACKDROP", en.backdrop_path ?? vi.backdrop_path, "w1280"],
      ["LOGO", this.pickLogo(vi), "w500"],
    ];
    await Promise.all(jobs.map(async ([kind, path, size]) => {
      if (!path || (have.has(kind) && !replace)) return;
      const buf = await this.tmdb.download(path, size);
      if (!buf) return;
      try {
        await this.images.saveTitleImage(titleId, kind, buf);
      } catch (err) {
        this.logger.warn(`Lưu ảnh ${kind} cho ${titleId} lỗi: ${(err as Error).message}`);
      }
    }));
  }

  async import(body: { tmdbId?: unknown; type?: unknown }): Promise<AdminTitle> {
    this.tmdb.assertEnabled();
    const tmdbId = Number(body?.tmdbId);
    const type = body?.type;
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || (type !== "MOVIE" && type !== "SERIES")) {
      throw new ApiException(400, "VALIDATION", "Cần tmdbId (số) và type MOVIE|SERIES");
    }
    const existing = await this.prisma.title.findUnique({ where: { type_tmdbId: { type, tmdbId } }, select: { id: true } });
    if (existing) throw new ApiException(409, "CONFLICT", "Phim này đã được import", { titleId: existing.id });
    const { vi, en } = await this.fetchDetail(tmdbId, type);
    const meta = this.metadata(type, vi, en);
    const genreIds = await this.ensureGenres(vi.genres ?? [], en.genres ?? []);
    const created = await this.titles.create(
      { type, ...meta, genreIds },
      {
        tmdbId, tmdbRating: vi.vote_average ?? null, originalLang: vi.original_language ?? null,
        imdbId: vi.imdb_id ?? vi.external_ids?.imdb_id ?? null, tmdbSyncedAt: new Date(),
      },
    );
    await this.syncCredits(created.id, type, vi);
    await this.syncImages(created.id, vi, en, false);
    if (type === "SERIES") {
      // Mùa/tập + một phần ảnh still (giới hạn); phần còn lại tải qua POST /admin/titles/:id/sync-tmdb-seasons.
      await this.seasons.sync(created.id, { stillBudget: IMPORT_STILL_BUDGET })
        .catch((err) => this.logger.warn(`Import mùa/tập TMDB cho ${created.id} lỗi: ${(err as Error).message}`));
    }
    await invalidateCatalogCache(this.redis);
    return this.titles.get(created.id);
  }

  /** Đồng bộ lại từ TMDB, bỏ qua các trường trong overriddenFields. */
  async sync(titleId: string): Promise<AdminTitle> {
    this.tmdb.assertEnabled();
    const current = await this.titles.get(titleId);
    if (!current.tmdbId) throw new ApiException(409, "CONFLICT", "Title chưa liên kết TMDB");
    const { vi, en } = await this.fetchDetail(current.tmdbId, current.type);
    const meta = this.metadata(current.type, vi, en);
    const locked = new Set(current.overriddenFields);
    const data: Prisma.TitleUpdateInput = {
      tmdbRating: vi.vote_average ?? null, originalLang: vi.original_language ?? null,
      imdbId: vi.imdb_id ?? vi.external_ids?.imdb_id ?? null, tmdbSyncedAt: new Date(),
    };
    if (!locked.has("name")) data.name = meta.name;
    if (!locked.has("originalName")) data.originalName = meta.originalName;
    if (!locked.has("tagline")) data.tagline = meta.tagline;
    if (!locked.has("overview")) data.overview = meta.overview;
    if (!locked.has("releaseDate")) data.releaseDate = meta.releaseDate ? new Date(`${meta.releaseDate}T00:00:00Z`) : null;
    if (!locked.has("runtimeMinutes")) data.runtimeMinutes = meta.runtimeMinutes;
    if (!locked.has("maturityRating") && meta.maturityRating) data.maturityRating = meta.maturityRating;
    if (!locked.has("countries")) data.countries = meta.countries;
    await this.prisma.title.update({ where: { id: titleId }, data });
    if (!locked.has("genres")) {
      const genreIds = await this.ensureGenres(vi.genres ?? [], en.genres ?? []);
      await this.prisma.$transaction([
        this.prisma.titleGenre.deleteMany({ where: { titleId } }),
        this.prisma.titleGenre.createMany({ data: genreIds.map((genreId) => ({ titleId, genreId })) }),
      ]);
    }
    await this.syncCredits(titleId, current.type, vi);
    await this.syncImages(titleId, vi, en, false);
    await invalidateCatalogCache(this.redis);
    return this.titles.get(titleId);
  }
}
