/**
 * Screen builders: each screen is ONE photo + HTML caption + inline keyboard, so navigation edits the same message.
 * Pure w.r.t. Telegram (no API calls) — the presenter in bot.ts sends or edits them.
 */
import { InlineKeyboard } from "grammy";
import type { Catalog, EpisodeInfo, SeasonInfo, TitleCard, TitleDetail } from "./catalog.js";
import { encode, type ListPos, type ListRef } from "./lib/callback.js";
import {
  cardMeta, detailCaption, episodeCaption, episodeCode, episodesCaption, firstEpisode, lengthLabel, listCaption, qualityLabel,
  runtimeLabel, runtimeShort, seasonLabel, typeLabel,
} from "./lib/format.js";
import { miniAppUrl, paths, type AppPath } from "./lib/links.js";
import { pageOf, paginate, PAGE_SIZE, windowAround } from "./lib/pagination.js";
import type { SearchStore } from "./lib/search-store.js";
import { escapeHtml as e, truncate } from "./lib/text.js";
import { hashKey, type PhotoRef, type PhotoService } from "./photos.js";
import { renderBanner, renderDetail, renderEpisode, renderEpisodeGrid, renderGrid } from "./render/render.js";

export interface Screen {
  photo: PhotoRef;
  caption: string;
  keyboard: InlineKeyboard;
}

export interface ScreenDeps {
  catalog: Catalog;
  photos: PhotoService;
  searches: SearchStore;
  publicWebUrl: string;
  /** Bot @username without "@" (TELEGRAM_BOT_USERNAME, default boxphim_bot). */
  botUsername: string;
}

export const GENRES_PER_PAGE = 16;
/** Episode picker: 3 buttons per row × 4 rows (matches the 3-column still grid in the photo). */
export const EPISODES_PER_PAGE = 12;
export const EPISODES_PER_ROW = 3;
/** Season selector: up to this many seasons fit in one row; more are shown 3 at a time with « » arrows. */
export const SEASONS_INLINE = 5;
export const SEASON_WINDOW = 3;

/** A screen plus an optional toast (e.g. when a stale button had to fall back to a nearby screen). */
export interface ScreenResult { screen: Screen; toast?: string }

interface ListMeta { heading: string; emoji: string; subtitle?: string; webPath: AppPath; query?: string }

export class Screens {
  constructor(private readonly d: ScreenDeps) {}

  private app(path?: AppPath) {
    return miniAppUrl(this.d.publicWebUrl, path);
  }

  private banner(key: string, title: string, subtitle: string): PhotoRef {
    return { key: hashKey(["banner", key, title, subtitle]), render: () => renderBanner({ title, subtitle }) };
  }

  private homeRow(kb: InlineKeyboard) {
    return kb.text("🏠 Trang chủ", encode({ a: "home" }));
  }

  // ───────── home ─────────

  async home(firstName?: string): Promise<Screen> {
    const featured = await this.d.catalog.billboard().catch(() => null);
    const photo: PhotoRef = {
      key: hashKey(["home", featured?.backdropKey, featured?.logoKey]),
      render: async () =>
        renderBanner({
          title: "Phim hay mỗi ngày",
          subtitle: "Phim lẻ, phim bộ, phim mới cập nhật — xem ngay trên Telegram.",
          backdrop: await this.d.photos.loadArt(featured?.backdropKey),
          featuredLogo: await this.d.photos.loadArt(featured?.logoKey),
          featuredLabel: featured ? "NỔI BẬT" : undefined,
        }),
    };
    const hello = firstName ? `Chào <b>${e(truncate(firstName, 40))}</b>! 👋` : "Chào bạn! 👋";
    const caption =
      `${hello}\nChào mừng đến với <b>BoxPhim</b> — kho phim lẻ, phim bộ chất lượng cao.\n\n` +
      (featured ? `🔥 Nổi bật: <b>${e(featured.name)}</b>${featured.year ? ` (${featured.year})` : ""}\n\n` : "") +
      "Chọn mục bên dưới để khám phá, hoặc gõ tên phim bất kỳ để tìm nhanh 🔍";
    const kb = new InlineKeyboard()
      .text("🎬 Phim lẻ", encode({ a: "list", list: { kind: "movies" }, page: 1 }))
      .text("📺 Phim bộ", encode({ a: "list", list: { kind: "series" }, page: 1 })).row()
      .text("🆕 Phim mới", encode({ a: "list", list: { kind: "new" }, page: 1 }))
      .text("🔥 Phim hot", encode({ a: "list", list: { kind: "hot" }, page: 1 })).row()
      .text("🎭 Thể loại", encode({ a: "genres", page: 1 }))
      .text("🔍 Tìm phim", encode({ a: "search" })).row()
      .webApp("❤️ Yêu thích", this.app(paths.myList()))
      .text("⚙️ Hỗ trợ", encode({ a: "help" })).row();
    if (featured) kb.text(`⭐ Xem phim nổi bật`, encode({ a: "detail", id: featured.id })).row();
    kb.webApp({ text: "▶️ Mở BoxPhim", style: "primary" }, this.app(paths.browse()));
    return { photo, caption, keyboard: kb };
  }

  // ───────── lists ─────────

  /** Resolves heading/web path for a list; null when the list no longer exists (unknown genre, expired search). */
  async listMeta(list: ListRef): Promise<ListMeta | null> {
    switch (list.kind) {
      case "movies": return { heading: "Phim lẻ", emoji: "🎬", webPath: paths.movies() };
      case "series": return { heading: "Phim bộ", emoji: "📺", webPath: paths.series() };
      case "new": return { heading: "Phim mới", emoji: "🆕", subtitle: "Mới cập nhật trên BoxPhim", webPath: paths.browse() };
      case "hot": return { heading: "Phim hot", emoji: "🔥", subtitle: "Xem nhiều nhất 7 ngày qua", webPath: paths.browse() };
      case "genre": {
        const g = await this.d.catalog.genre(list.slug);
        return g ? { heading: g.name, emoji: "🎭", subtitle: "Thể loại", webPath: paths.genre(g.slug) } : null;
      }
      case "search": {
        const q = await this.d.searches.get(list.qid);
        return q ? { heading: `“${truncate(q, 40)}”`, emoji: "🔍", subtitle: "Kết quả tìm kiếm", webPath: paths.search(q), query: q } : null;
      }
    }
  }

  async list(list: ListRef, page: number): Promise<Screen | null> {
    const meta = await this.listMeta(list);
    if (!meta) return null;
    const ids = await this.d.catalog.listIds(list, meta.query);
    const p = paginate(ids.length, page, PAGE_SIZE);
    if (!ids.length) return this.emptyList(list, meta);
    const cards = await this.d.catalog.cards(ids.slice(p.start, p.end));
    const pageLabel = `${p.page}/${p.totalPages}`;
    const items = cards.map((c, i) => ({ c, n: p.start + i + 1 }));
    const photo: PhotoRef = {
      key: hashKey(["grid", meta.heading, pageLabel, ...items.flatMap(({ c, n }) => [n, c.id, c.posterKey, c.name, cardMeta(c), c.maturityRating])]),
      render: async () =>
        renderGrid({
          heading: meta.heading,
          pageLabel: `Trang ${pageLabel}`,
          items: await Promise.all(items.map(async ({ c, n }) => ({
            number: n, name: c.name, meta: cardMeta(c), badge: c.maturityRating, poster: await this.d.photos.loadArt(c.posterKey),
          }))),
        }),
    };
    const kb = new InlineKeyboard();
    items.forEach(({ c, n }, i) => {
      kb.text(`${n}. ${truncate(c.name, 24)}`, encode({ a: "detail", id: c.id, back: { list, page: p.page } }));
      if (i % 2 === 1) kb.row();
    });
    if (items.length % 2 === 1) kb.row();
    if (p.totalPages > 1) {
      kb.text("◀ Trước", encode({ a: "list", list, page: p.prev }))
        .text(`${p.page}/${p.totalPages}`, encode({ a: "noop" }))
        .text("Tiếp ▶", encode({ a: "list", list, page: p.next })).row();
    }
    this.homeRow(kb).webApp("▶️ Mở BoxPhim", this.app(meta.webPath));
    return { photo, caption: listCaption(meta.heading, meta.emoji, p, cards, meta.subtitle), keyboard: kb };
  }

  private emptyList(list: ListRef, meta: ListMeta): Screen {
    const isSearch = list.kind === "search";
    const caption = isSearch
      ? `🔍 Không tìm thấy phim nào cho <b>${e(meta.query ?? "")}</b>.\n\nThử gõ ngắn hơn, không cần dấu (ví dụ: <i>nguoi gac den</i>), hoặc tìm theo tên diễn viên, thể loại.`
      : `${meta.emoji} <b>${e(meta.heading)}</b>\n\nChưa có phim nào ở mục này. Quay lại sau nhé!`;
    const kb = new InlineKeyboard();
    if (isSearch) kb.text("🔍 Tìm lại", encode({ a: "search" })).row();
    this.homeRow(kb).webApp("▶️ Mở BoxPhim", this.app(meta.webPath));
    return {
      photo: this.banner("empty", isSearch ? "Không tìm thấy phim" : "Chưa có phim", isSearch ? "Thử từ khóa khác hoặc duyệt theo thể loại." : "Danh mục đang được cập nhật."),
      caption,
      keyboard: kb,
    };
  }

  // ───────── detail ─────────

  async detail(id: string, back?: { list: ListRef; page: number }): Promise<Screen | null> {
    const t = await this.d.catalog.detail(id);
    if (!t) return null;
    return this.detailFor(t, back);
  }

  detailArtKey(t: TitleDetail) {
    return hashKey(["detail", t.id, t.backdropKey, t.posterKey, t.logoKey, t.name, t.tagline, ...detailChips(t), ...detailFlags(t).map((f) => f.label)]);
  }

  detailFor(t: TitleDetail, back?: { list: ListRef; page: number }): Screen {
    const photo: PhotoRef = {
      key: this.detailArtKey(t),
      render: async () => {
        const [backdrop, poster, logo] = await Promise.all([
          this.d.photos.loadArt(t.backdropKey), this.d.photos.loadArt(t.posterKey), this.d.photos.loadArt(t.logoKey),
        ]);
        return renderDetail({ name: t.name, backdrop, poster, logo, tagline: t.tagline, chips: detailChips(t), flags: detailFlags(t) });
      },
    };
    const titlePath = paths.title(t.slug);
    const kb = new InlineKeyboard();
    if (t.type === "SERIES") {
      // The bot has no viewer session: /watch/<titleId> without an episode lets the API pick the profile's resume
      // episode (or the first one), so the label names the generic starting point.
      const start = firstEpisode(t);
      const label = t.playable && start ? `▶ Xem ngay (${episodeCode(start.season.seasonNumber, start.episode.episodeNumber)})` : "▶ Xem ngay";
      kb.webApp({ text: label, style: "primary" }, this.app(t.playable ? paths.watch(t.id) : titlePath)).row();
      if (start) kb.text("📃 Danh sách tập", encode({ a: "episodes", id: t.id, season: start.season.seasonNumber, page: 1, back })).row();
      kb.webApp("ℹ️ Chi tiết", this.app(titlePath)).webApp("❤️ Yêu thích", this.app(titlePath)).row();
    } else {
      kb.webApp({ text: "▶ Xem ngay", style: "primary" }, this.app(t.playable ? paths.watch(t.id) : titlePath)).row()
        .webApp("ℹ️ Chi tiết", this.app(titlePath))
        .webApp("❤️ Thêm vào yêu thích", this.app(titlePath)).row();
    }
    if (back) kb.text("↩ Quay lại", encode({ a: "list", list: back.list, page: back.page }));
    this.homeRow(kb);
    return { photo, caption: detailCaption(t), keyboard: kb };
  }

  // ───────── series: episode picker / episode card ─────────

  /**
   * Episode picker for one season. Stale input degrades gracefully: unknown season → first season (with a toast),
   * a series without published episodes (or a movie) → its detail screen. null only when the title itself is gone.
   */
  async episodes(id: string, seasonNumber: number, page: number, back?: ListPos): Promise<ScreenResult | null> {
    const t = await this.d.catalog.detail(id);
    if (!t) return null;
    if (t.type !== "SERIES" || !t.seasons.length) {
      return { screen: this.detailFor(t, back), toast: t.type === "SERIES" ? "Phim này chưa có tập nào được phát hành." : undefined };
    }
    let season = t.seasons.find((s) => s.seasonNumber === seasonNumber);
    let toast: string | undefined;
    if (!season) {
      season = t.seasons[0]!;
      toast = `Mùa này hiện không có, đã chuyển sang ${seasonLabel(season.seasonNumber)}.`;
    }
    return { screen: this.episodesFor(t, season, page, back), toast };
  }

  episodesFor(t: TitleDetail, season: SeasonInfo, page: number, back?: ListPos): Screen {
    const p = paginate(season.episodes.length, page, EPISODES_PER_PAGE);
    const eps = season.episodes.slice(p.start, p.end);
    const sLabel = seasonLabel(season.seasonNumber);
    const pageLabel = p.totalPages > 1 ? `Trang ${p.page}/${p.totalPages}` : null;
    const tiles = eps.map((ep) => ({ ep, meta: [runtimeShort(ep.runtimeMinutes), ep.playable ? null : "Sắp có"].filter(Boolean).join(" · ") || null }));
    const photo: PhotoRef = {
      key: hashKey(["episodes", t.id, t.name, t.backdropKey, sLabel, pageLabel,
        ...tiles.flatMap(({ ep, meta }) => [ep.episodeNumber, ep.name, ep.stillKey, ep.playable ? 1 : 0, meta])]),
      render: async () =>
        renderEpisodeGrid({
          seriesName: t.name,
          seasonLabel: sLabel,
          pageLabel,
          backdrop: await this.d.photos.loadArt(t.backdropKey ?? t.posterKey),
          tiles: await Promise.all(tiles.map(async ({ ep, meta }) => ({
            number: ep.episodeNumber, name: ep.name, meta, playable: ep.playable, still: await this.d.photos.loadArt(ep.stillKey),
          }))),
        }),
    };

    const kb = new InlineKeyboard();
    // season selector
    if (t.seasons.length > 1) {
      const idx = t.seasons.indexOf(season);
      const w = t.seasons.length <= SEASONS_INLINE ? windowAround(t.seasons.length, idx, SEASONS_INLINE) : windowAround(t.seasons.length, idx, SEASON_WINDOW);
      const to = (s: SeasonInfo) => encode({ a: "episodes", id: t.id, season: s.seasonNumber, page: 1, back });
      if (w.prevStart !== null) kb.text("«", to(t.seasons[w.prevStart]!));
      for (const s of t.seasons.slice(w.start, w.end)) {
        kb.text(s === season ? `• ${seasonLabel(s.seasonNumber)} •` : seasonLabel(s.seasonNumber), s === season ? encode({ a: "noop" }) : to(s));
      }
      if (w.nextStart !== null) kb.text("»", to(t.seasons[w.nextStart]!));
      kb.row();
    }
    // episode grid
    eps.forEach((ep, i) => {
      kb.text(`Tập ${ep.episodeNumber}${ep.playable ? "" : " ⏳"}`,
        encode({ a: "episode", id: t.id, season: season.seasonNumber, episode: ep.episodeNumber, back }));
      if (i % EPISODES_PER_ROW === EPISODES_PER_ROW - 1) kb.row();
    });
    if (eps.length % EPISODES_PER_ROW) kb.row();
    if (p.totalPages > 1) {
      const at = (n: number) => encode({ a: "episodes", id: t.id, season: season.seasonNumber, page: n, back });
      kb.text("◀ Trước", at(p.prev)).text(`${p.page}/${p.totalPages}`, encode({ a: "noop" })).text("Tiếp ▶", at(p.next)).row();
    }
    kb.text("↩ Quay lại", encode({ a: "detail", id: t.id, back }));
    this.homeRow(kb);
    return { photo, caption: episodesCaption(t, season, p), keyboard: kb };
  }

  /** One episode. Unknown/unpublished episode → the season's picker (or detail) with a toast; null if the title is gone. */
  async episode(id: string, seasonNumber: number, episodeNumber: number, back?: ListPos): Promise<ScreenResult | null> {
    const t = await this.d.catalog.detail(id);
    if (!t) return null;
    const season = t.seasons.find((s) => s.seasonNumber === seasonNumber);
    const ep = season?.episodes.find((x) => x.episodeNumber === episodeNumber);
    if (!season || !ep) {
      const fallback = await this.episodes(id, seasonNumber, 1, back);
      return fallback && { screen: fallback.screen, toast: "Tập này hiện không có trên BoxPhim." };
    }
    return { screen: this.episodeFor(t, season, ep, back) };
  }

  /** The episode after `ep` in watch order (crosses into the next season); null after the last one. */
  static nextEpisode(t: TitleDetail, season: SeasonInfo, ep: EpisodeInfo): { season: SeasonInfo; episode: EpisodeInfo } | null {
    const i = season.episodes.indexOf(ep);
    if (i >= 0 && i + 1 < season.episodes.length) return { season, episode: season.episodes[i + 1]! };
    const nextSeason = t.seasons[t.seasons.indexOf(season) + 1];
    return nextSeason?.episodes[0] ? { season: nextSeason, episode: nextSeason.episodes[0] } : null;
  }

  episodeFor(t: TitleDetail, season: SeasonInfo, ep: EpisodeInfo, back?: ListPos): Screen {
    const chips = [runtimeLabel(ep.runtimeMinutes), t.maturityRating, ep.playable ? qualityLabel(t.maxHeight) : null].filter((x): x is string => !!x);
    const code = episodeCode(season.seasonNumber, ep.episodeNumber);
    const named = ep.name?.trim() && !/^(tập|episode)\s*\d+$/i.test(ep.name.trim()) ? ep.name.trim() : null;
    const photo: PhotoRef = {
      key: hashKey(["episode", t.id, ep.id, t.name, code, named, ep.stillKey, t.backdropKey, ep.playable ? 1 : 0, ep.overview, ...chips]),
      render: async () => {
        const [still, backdrop] = await Promise.all([this.d.photos.loadArt(ep.stillKey), this.d.photos.loadArt(t.backdropKey ?? t.posterKey)]);
        return renderEpisode({ seriesName: t.name, code, name: named, still, backdrop, chips, playable: ep.playable, overview: ep.overview });
      },
    };
    const titlePath = paths.title(t.slug);
    const kb = new InlineKeyboard();
    if (ep.playable) kb.webApp({ text: "▶ Xem tập này", style: "primary" }, this.app(paths.episode(t.id, ep.id, t.slug))).row();
    else kb.webApp("⏳ Tập này sắp có", this.app(titlePath)).row();
    const next = Screens.nextEpisode(t, season, ep);
    if (next) {
      const label = next.season === season ? "⏭ Tập tiếp theo" : `⏭ Tập tiếp theo (${seasonLabel(next.season.seasonNumber)})`;
      kb.text(label, encode({ a: "episode", id: t.id, season: next.season.seasonNumber, episode: next.episode.episodeNumber, back })).row();
    }
    kb.text("📃 Danh sách tập", encode({
      a: "episodes", id: t.id, season: season.seasonNumber, page: pageOf(season.episodes.indexOf(ep), EPISODES_PER_PAGE), back,
    }))
      .text("↩ Quay lại", encode({ a: "detail", id: t.id, back })).row();
    this.homeRow(kb);
    return { photo, caption: episodeCaption(t, season, ep), keyboard: kb };
  }

  // ───────── genres / help / search prompt ─────────

  async genres(page: number): Promise<Screen> {
    const all = await this.d.catalog.genres();
    const p = paginate(all.length, page, GENRES_PER_PAGE);
    const kb = new InlineKeyboard();
    all.slice(p.start, p.end).forEach((g, i) => {
      kb.text(`${g.name} (${g.count})`, encode({ a: "list", list: { kind: "genre", slug: g.slug }, page: 1 }));
      if (i % 2 === 1) kb.row();
    });
    if ((p.end - p.start) % 2 === 1) kb.row();
    if (p.totalPages > 1) {
      kb.text("◀ Trước", encode({ a: "genres", page: p.prev }))
        .text(`${p.page}/${p.totalPages}`, encode({ a: "noop" }))
        .text("Tiếp ▶", encode({ a: "genres", page: p.next })).row();
    }
    this.homeRow(kb);
    return {
      photo: this.banner("genres", "Thể loại", "Hành động, tình cảm, kinh dị, hoạt hình… chọn gu của bạn."),
      caption: `🎭 <b>Thể loại</b>\n\nChọn một thể loại để xem danh sách phim (${all.length} thể loại).`,
      keyboard: kb,
    };
  }

  help(): Screen {
    const caption =
      "⚙️ <b>Hỗ trợ BoxPhim</b>\n\n" +
      "• Duyệt <b>Phim lẻ</b>, <b>Phim bộ</b>, <b>Phim mới</b>, <b>Phim hot</b> ngay trong chat.\n" +
      "• Gõ tên phim bất kỳ (có dấu hay không đều được) để tìm, ví dụ: <i>nguoi gac den</i>.\n" +
      "• Bấm <b>▶ Xem ngay</b> để mở BoxPhim ngay trong Telegram. Lần đầu bạn sẽ được hướng dẫn đăng nhập/liên kết tài khoản.\n" +
      "• Xem phim cần tài khoản có gói cước còn hạn.\n" +
      `• Trong chat bất kỳ, gõ <code>@${e(this.d.botUsername)} tên phim</code> để chia sẻ phim với bạn bè.\n\n` +
      "Lệnh: /start · /search · /moi · /hot · /help";
    const kb = new InlineKeyboard()
      .webApp("👤 Tài khoản", this.app(paths.account()))
      .webApp("💳 Gói cước", this.app(paths.plans())).row()
      .text("🔍 Tìm phim", encode({ a: "search" }));
    this.homeRow(kb);
    return { photo: this.banner("help", "Hỗ trợ", "Cách dùng bot, tài khoản và gói cước."), caption, keyboard: kb };
  }
}

export function detailChips(t: TitleDetail): string[] {
  return [
    t.year ? String(t.year) : null,
    typeLabel(t.type),
    t.type === "SERIES" ? lengthLabel(t)?.split(" · ")[0] ?? null : runtimeShort(t.runtimeMinutes),
    t.maturityRating,
    t.rating ? `★ ${t.rating.toFixed(1)}` : null,
  ].filter((x): x is string => !!x);
}

export function detailFlags(t: TitleDetail): { label: string; style: "brand" | "ok" | "outline" }[] {
  const flags: { label: string; style: "brand" | "ok" | "outline" }[] = [];
  if (t.playable) {
    flags.push({ label: "▶ Xem được ngay", style: "ok" });
    const q = qualityLabel(t.maxHeight);
    if (q) flags.push({ label: q === "Full HD" ? `HD 1080p` : q, style: "brand" });
  } else {
    flags.push({ label: "Sắp ra mắt", style: "outline" });
  }
  for (const g of t.genreList.slice(0, 2)) flags.push({ label: g.name, style: "outline" });
  return flags;
}

export type { TitleCard };
