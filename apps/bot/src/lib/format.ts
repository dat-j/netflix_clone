/** Vietnamese caption builders (HTML parse mode). Every caption is guaranteed ≤ 1024 visible characters. */
import type { EpisodeInfo, SeasonInfo, TitleCard, TitleDetail } from "../catalog.js";
import type { PageInfo } from "./pagination.js";
import { CAPTION_LIMIT, escapeHtml as e, truncate, visibleLength } from "./text.js";

export function typeLabel(t: TitleCard["type"]): string {
  return t === "SERIES" ? "Phim bộ" : "Phim lẻ";
}

export function runtimeLabel(min: number | null | undefined): string | null {
  if (!min || min <= 0) return null;
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} phút`;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

/** Short runtime for images ("1g 52p"). */
export function runtimeShort(min: number | null | undefined): string | null {
  if (!min || min <= 0) return null;
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}p`;
  return m ? `${h}g ${m}p` : `${h}g`;
}

export function ratingLabel(r: number | null | undefined): string | null {
  return r != null && r > 0 ? `${(Math.round(r * 10) / 10).toFixed(1)}` : null;
}

export function qualityLabel(maxHeight: number | null | undefined): string | null {
  if (!maxHeight) return null;
  if (maxHeight >= 2160) return "4K";
  if (maxHeight >= 1080) return "Full HD";
  if (maxHeight >= 720) return "HD";
  return "SD";
}

/** "N mùa" / "N mùa · M tập" for series, runtime for movies. */
export function lengthLabel(d: Pick<TitleDetail, "type" | "runtimeMinutes" | "seasons">): string | null {
  if (d.type === "SERIES") {
    if (!d.seasons.length) return null;
    const eps = d.seasons.reduce((n, s) => n + s.episodes.length, 0);
    return `${d.seasons.length} mùa · ${eps} tập`;
  }
  return runtimeLabel(d.runtimeMinutes);
}

/** "3 mùa" for series cards that have published episodes. */
export function seasonsShort(c: Pick<TitleCard, "type" | "seasonCount">): string | null {
  return c.type === "SERIES" && c.seasonCount ? `${c.seasonCount} mùa` : null;
}

/** "Mùa 2" — or "Đặc biệt" for season 0 (TMDB specials). */
export function seasonLabel(seasonNumber: number): string {
  return seasonNumber === 0 ? "Đặc biệt" : `Mùa ${seasonNumber}`;
}

/** " (Hồi kết)" when a season has a real name beyond "Mùa N"/"Season N"/"Specials"; "" otherwise. HTML-escaped. */
export function seasonNameSuffix(s: Pick<SeasonInfo, "seasonNumber" | "name">, italic = false): string {
  const n = s.name?.trim();
  if (!n || n.toLowerCase() === seasonLabel(s.seasonNumber).toLowerCase() || /^(season|mùa)\s*\d+$|^specials?$/i.test(n)) return "";
  const t = e(truncate(n, 50));
  return italic ? ` <i>(${t})</i>` : ` (${t})`;
}

/** "Mùa 1 · Tập 3" */
export function episodeCode(seasonNumber: number, episodeNumber: number): string {
  return `${seasonLabel(seasonNumber)} · Tập ${episodeNumber}`;
}

/** One-line meta under a grid poster / in list captions: "2025 · Phim bộ · 2 mùa · ★ 7.8" */
export function cardMeta(c: TitleCard, withStar = true): string {
  return [c.year, typeLabel(c.type), seasonsShort(c), ratingLabel(c.rating) && (withStar ? `★ ${ratingLabel(c.rating)}` : ratingLabel(c.rating))]
    .filter(Boolean)
    .join(" · ");
}

export function listCaption(heading: string, emoji: string, p: PageInfo, cards: TitleCard[], subtitle?: string): string {
  const head = `${emoji} <b>${e(heading)}</b>  ·  trang ${p.page}/${p.totalPages}`;
  const sub = subtitle ? `\n<i>${e(subtitle)}</i>` : "";
  if (!cards.length) return `${head}${sub}\n\nChưa có phim nào ở mục này.`;
  const lines = cards.map((c, i) => {
    const meta = [c.year, typeLabel(c.type), seasonsShort(c), c.maturityRating, ratingLabel(c.rating) && `⭐ ${ratingLabel(c.rating)}`].filter(Boolean).join(" · ");
    const genres = c.genres.slice(0, 2).join(", ");
    return `<b>${p.start + i + 1}.</b> <b>${e(truncate(c.name, 60))}</b>\n      ${e(meta)}${genres ? `\n      <i>${e(genres)}</i>` : ""}`;
  });
  const out = `${head}${sub}\n\n${lines.join("\n\n")}\n\n👇 Chọn số để xem chi tiết · ${p.total} phim`;
  return fitCaption(out);
}

/** Where a series starts for someone new: first playable published episode, else the first published one. */
export function firstEpisode(d: Pick<TitleDetail, "seasons">): { season: SeasonInfo; episode: EpisodeInfo } | null {
  const regular = d.seasons.filter((s) => s.seasonNumber !== 0);
  for (const pool of [regular, d.seasons]) {
    for (const s of pool) for (const e of s.episodes) if (e.playable) return { season: s, episode: e };
  }
  const s = regular[0] ?? d.seasons[0];
  return s?.episodes[0] ? { season: s, episode: s.episodes[0] } : null;
}

/** Detail caption; the synopsis gets whatever budget is left so the result never exceeds the caption limit. */
export function detailCaption(d: TitleDetail, limit = CAPTION_LIMIT): string {
  const title = `🎬 <b>${e(d.name)}</b>${d.year ? ` (${d.year})` : ""}`;
  const orig = d.originalName && d.originalName !== d.name ? `\n<i>${e(truncate(d.originalName, 80))}</i>` : "";
  const meta = [typeLabel(d.type), lengthLabel(d), d.maturityRating].filter(Boolean).join(" · ");
  const genres = d.genreList.length ? `\n🎭 ${e(d.genreList.map((g) => g.name).join(", "))}` : "";
  const status = [
    ratingLabel(d.rating) ? `⭐ ${ratingLabel(d.rating)}/10` : null,
    d.playable ? "✅ Xem được ngay" : "⏳ Sắp có",
    d.playable ? qualityLabel(d.maxHeight) : null,
  ].filter(Boolean).join(" · ");
  const people = [
    d.directors.length ? `🎥 Đạo diễn: ${e(d.directors.slice(0, 2).join(", "))}` : null,
    d.cast.length ? `👥 Diễn viên: ${e(d.cast.slice(0, 4).join(", "))}` : null,
  ].filter(Boolean).join("\n");
  let seasons = "";
  if (d.type === "SERIES" && d.seasons.length) {
    const rows = d.seasons.slice(0, 4).map((s) => `• ${e(seasonLabel(s.seasonNumber))}${seasonNameSuffix(s)}: ${s.episodes.length} tập`);
    if (d.seasons.length > 4) rows.push(`• … và ${d.seasons.length - 4} mùa khác`);
    seasons = `\n\n📺 <b>Các mùa</b>\n${rows.join("\n")}`;
    const start = firstEpisode(d);
    if (start && d.playable) {
      seasons += `\n\n▶ <i>Xem ngay</i> mở ${e(episodeCode(start.season.seasonNumber, start.episode.episodeNumber))}` +
        " — hoặc tự tiếp tục tập bạn đang xem dở.";
    }
  } else if (d.type === "SERIES") {
    seasons = "\n\n📺 Chưa có tập nào được phát hành — quay lại sau nhé!";
  }
  const head = `${title}${orig}\n${e(meta)}${genres}\n${e(status)}${people ? `\n${people}` : ""}${seasons}`;
  const overview = (d.overview ?? "").trim();
  if (!overview) return fitCaption(head, limit);
  const budget = limit - visibleLength(head) - 2 - 6; // "\n\n" + safety margin
  if (budget < 40) return fitCaption(head, limit);
  return `${head}\n\n${e(truncate(overview, Math.min(budget, 480)))}`;
}

/** Last-resort guard: trims the caption line by line until it fits (keeps HTML tags balanced per line). */
export function fitCaption(html: string, limit = CAPTION_LIMIT): string {
  if (visibleLength(html) <= limit) return html;
  const lines = html.split("\n");
  while (lines.length > 1 && visibleLength(`${lines.join("\n")}\n…`) > limit) lines.pop();
  const out = `${lines.join("\n")}\n…`;
  if (visibleLength(out) <= limit) return out;
  // a single gigantic line: strip tags and hard-truncate
  const plain = lines[0]!.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  return e(truncate(plain, limit));
}

/** "Mùa 1 · Tập 3 — Tên tập" (name omitted when missing or just "Tập 3"/"Episode 3"). */
export function episodeHeading(seasonNumber: number, ep: Pick<EpisodeInfo, "episodeNumber" | "name">): string {
  const code = episodeCode(seasonNumber, ep.episodeNumber);
  const name = ep.name?.trim();
  return name && !/^(tập|episode)\s*\d+$/i.test(name) ? `${code} — ${name}` : code;
}

/** Caption of the episode picker: series, season, page, then the episodes on this page. */
export function episodesCaption(d: TitleDetail, season: SeasonInfo, p: PageInfo): string {
  const label = seasonLabel(season.seasonNumber);
  const custom = seasonNameSuffix(season, true);
  const head =
    `📃 <b>Danh sách tập</b> · <b>${e(truncate(d.name, 60))}</b>\n` +
    `${e(label)}${custom} · ${season.episodes.length} tập` + (p.totalPages > 1 ? ` · trang ${p.page}/${p.totalPages}` : "") +
    (d.seasons.length > 1 ? `\n${e(lengthLabel(d) ?? "")}` : "");
  const lines = season.episodes.slice(p.start, p.end).map((ep) => {
    const name = ep.name?.trim() && !/^(tập|episode)\s*\d+$/i.test(ep.name.trim()) ? ` ${e(truncate(ep.name.trim(), 38))}` : "";
    const meta = [runtimeShort(ep.runtimeMinutes), ep.playable ? null : "⏳ sắp có"].filter(Boolean).join(" · ");
    const tail = meta ? (name ? ` <i>· ${e(meta)}</i>` : ` <i>${e(meta)}</i>`) : "";
    return `<b>${ep.episodeNumber}.</b>${name || ` Tập ${ep.episodeNumber}`}${tail}`;
  });
  return fitCaption(`${head}\n\n${lines.join("\n")}\n\n👇 Chọn tập để xem chi tiết`);
}

/** Caption of one episode: heading, runtime/status, synopsis (budgeted), position in the season. */
export function episodeCaption(d: TitleDetail, season: SeasonInfo, ep: EpisodeInfo, limit = CAPTION_LIMIT): string {
  const idx = season.episodes.indexOf(ep);
  const head =
    `📺 <b>${e(truncate(d.name, 80))}</b>\n` +
    `<b>${e(truncate(episodeHeading(season.seasonNumber, ep), 140))}</b>\n` +
    [runtimeLabel(ep.runtimeMinutes) && `⏱ ${runtimeLabel(ep.runtimeMinutes)}`, ep.playable ? "✅ Xem được ngay" : "⏳ Sắp có", d.maturityRating]
      .filter(Boolean).map((x) => e(String(x))).join(" · ");
  const foot = `\n\n<i>Tập ${idx + 1}/${season.episodes.length} của ${e(seasonLabel(season.seasonNumber))}</i>`;
  const overview = (ep.overview ?? "").trim();
  if (!overview) return fitCaption(`${head}${foot}`, limit);
  const budget = limit - visibleLength(head) - visibleLength(foot) - 2 - 6;
  if (budget < 40) return fitCaption(`${head}${foot}`, limit);
  return `${head}\n\n${e(truncate(overview, Math.min(budget, 600)))}${foot}`;
}
