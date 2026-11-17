/** Text helpers: HTML escaping, Telegram-length accounting, Vietnamese-aware search normalisation. */
export const CAPTION_LIMIT = 1024;
export const MESSAGE_LIMIT = 4096;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Length Telegram counts for an HTML-formatted caption: tags removed, entities decoded, UTF-16 code units. */
export function visibleLength(html: string): number {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(lt|gt|amp|quot|#\d+|#x[0-9a-f]+);/gi, "_").length;
}

/** Cut plain text to at most `max` UTF-16 units on a word boundary when possible, adding "…". */
export function truncate(s: string, max: number): string {
  const text = s.trim().replace(/\s+/g, " ");
  if (text.length <= max) return text;
  if (max <= 1) return "…".slice(0, Math.max(0, max));
  let cut = text.slice(0, max - 1);
  // never split a surrogate pair
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const sp = cut.lastIndexOf(" ");
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return `${cut.replace(/[\s,.;:–-]+$/, "")}…`;
}

/** Strip Vietnamese (and other) diacritics; đ/Đ are separate letters, not combining marks. */
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

/**
 * Normalises a user search: trims, collapses whitespace, drops a leading "/search" or bot mention, caps at 100 chars
 * (same cap as the API). Accents are kept — the SQL side applies unaccent() to both sides.
 */
export function normalizeQuery(raw: string | undefined | null): string {
  let q = (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ");
  q = q.replace(/^\s*\/\w+(@\w+)?\s*/, "");
  q = q.trim().replace(/\s+/g, " ");
  return q.slice(0, 100).trim();
}

/** Stable key for caching/storing a search (accent- and case-insensitive). */
export function queryKey(q: string): string {
  return stripAccents(normalizeQuery(q)).toLowerCase();
}
