/** Vietnamese caption builders (HTML parse mode). Every caption is guaranteed ≤ 1024 visible characters. */
import type { TitleCard, TitleDetail } from "../catalog.js";
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

/** One-line meta under a grid poster / in list captions: "2025 · Phim bộ · ⭐ 7.8" */
export function cardMeta(c: TitleCard, withStar = true): string {
  return [c.year, typeLabel(c.type), ratingLabel(c.rating) && (withStar ? `★ ${ratingLabel(c.rating)}` : ratingLabel(c.rating))]
    .filter(Boolean)
    .join(" · ");
}

export function listCaption(heading: string, emoji: string, p: PageInfo, cards: TitleCard[], subtitle?: string): string {
  const head = `${emoji} <b>${e(heading)}</b>  ·  trang ${p.page}/${p.totalPages}`;
  const sub = subtitle ? `\n<i>${e(subtitle)}</i>` : "";
  if (!cards.length) return `${head}${sub}\n\nChưa có phim nào ở mục này.`;
  const lines = cards.map((c, i) => {
    const meta = [c.year, typeLabel(c.type), c.maturityRating, ratingLabel(c.rating) && `⭐ ${ratingLabel(c.rating)}`].filter(Boolean).join(" · ");
    const genres = c.genres.slice(0, 2).join(", ");
    return `<b>${p.start + i + 1}.</b> <b>${e(truncate(c.name, 60))}</b>\n      ${e(meta)}${genres ? `\n      <i>${e(genres)}</i>` : ""}`;
  });
  const out = `${head}${sub}\n\n${lines.join("\n\n")}\n\n👇 Chọn số để xem chi tiết · ${p.total} phim`;
  return fitCaption(out);
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
    const rows = d.seasons.slice(0, 4).map((s) => `• ${e(s.name ?? `Mùa ${s.seasonNumber}`)}: ${s.episodes.length} tập`);
    if (d.seasons.length > 4) rows.push(`• … và ${d.seasons.length - 4} mùa khác`);
    seasons = `\n\n📺 <b>Các mùa</b>\n${rows.join("\n")}`;
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
