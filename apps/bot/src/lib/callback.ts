/**
 * Compact callback_data codec (Telegram limit: 1–64 BYTES). Grammar (ASCII only):
 *
 *   h                    home
 *   x                    no-op (page indicator)
 *   s                    search prompt
 *   ?                    help
 *   G:<page>             genre menu
 *   L:<list>:<page>      list screen
 *   D:<id22>[:<list>:<page>]  title detail; optional back-reference to the list page it came from
 *   E:<id22>:<sn>:<page>[:<list>:<page>]  episode picker of a series: season number + episode-grid page
 *   P:<id22>:<sn>:<en>[:<list>:<page>]    one episode, addressed by (season number, episode number)
 *
 * Episodes are addressed by the series id plus season/episode NUMBERS (unique per title / per season) instead of
 * their own UUIDs, so every series button fits in ≤ 33 bytes before the optional list back-reference. The back-ref
 * (the list the series was opened from) rides along through the picker so "↩ Quay lại" can unwind the whole chain;
 * like on D it is dropped rather than overflowing 64 bytes. Paging state of the picker is recomputed server-side
 * from the episode's position, so it never needs to be stored.
 *
 *   <list> = m (phim lẻ) | s (phim bộ) | n (mới) | t (hot) | g.<genre-slug> | q.<query-id>
 *   <id22> = title UUID as 16 bytes base64url (22 chars) instead of 36 hex chars.
 */
export const CALLBACK_MAX_BYTES = 64;
export const MAX_PAGE = 9999;

export type ListRef =
  | { kind: "movies" }
  | { kind: "series" }
  | { kind: "new" }
  | { kind: "hot" }
  | { kind: "genre"; slug: string }
  | { kind: "search"; qid: string };

export interface ListPos { list: ListRef; page: number }

export type Action =
  | { a: "home" }
  | { a: "noop" }
  | { a: "search" }
  | { a: "help" }
  | { a: "genres"; page: number }
  | { a: "list"; list: ListRef; page: number }
  | { a: "detail"; id: string; back?: ListPos }
  | { a: "episodes"; id: string; season: number; page: number; back?: ListPos }
  | { a: "episode"; id: string; season: number; episode: number; back?: ListPos };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const QID_RE = /^[A-Za-z0-9_-]{6,16}$/;
const PAGE_RE = /^[1-9]\d{0,3}$/;
const ID22_RE = /^[A-Za-z0-9_-]{22}$/;
/** Season numbers 0…999 (0 = specials), episode numbers 0…9999; canonical decimal only (no leading zeros). */
const SEASON_RE = /^(0|[1-9]\d{0,2})$/;
const EPISODE_RE = /^(0|[1-9]\d{0,3})$/;
export const MAX_SEASON = 999;
export const MAX_EPISODE = 9999;

export function uuidToShort(uuid: string): string {
  if (!UUID_RE.test(uuid)) throw new Error(`not a uuid: ${uuid}`);
  return Buffer.from(uuid.replace(/-/g, ""), "hex").toString("base64url");
}
export function shortToUuid(short: string): string | null {
  if (!ID22_RE.test(short)) return null;
  const buf = Buffer.from(short, "base64url");
  if (buf.length !== 16) return null;
  const h = buf.toString("hex");
  // Reject non-canonical encodings (trailing bits) so every id has exactly one representation.
  if (Buffer.from(h, "hex").toString("base64url") !== short) return null;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function encodeList(l: ListRef): string {
  switch (l.kind) {
    case "movies": return "m";
    case "series": return "s";
    case "new": return "n";
    case "hot": return "t";
    case "genre":
      if (!SLUG_RE.test(l.slug)) throw new Error(`invalid genre slug: ${l.slug}`);
      return `g.${l.slug}`;
    case "search":
      if (!QID_RE.test(l.qid)) throw new Error(`invalid query id: ${l.qid}`);
      return `q.${l.qid}`;
  }
}
export function decodeList(s: string): ListRef | null {
  switch (s) {
    case "m": return { kind: "movies" };
    case "s": return { kind: "series" };
    case "n": return { kind: "new" };
    case "t": return { kind: "hot" };
  }
  if (s.startsWith("g.")) {
    const slug = s.slice(2);
    return SLUG_RE.test(slug) && slug.length <= 48 ? { kind: "genre", slug } : null;
  }
  if (s.startsWith("q.")) {
    const qid = s.slice(2);
    return QID_RE.test(qid) ? { kind: "search", qid } : null;
  }
  return null;
}
export function sameList(a: ListRef, b: ListRef): boolean {
  return encodeList(a) === encodeList(b);
}

function clampPage(p: number): number {
  return Math.min(MAX_PAGE, Math.max(1, Math.floor(p) || 1));
}

function checkNum(n: number, max: number, what: string): number {
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`invalid ${what} number: ${n}`);
  return n;
}

/** Appends `:<list>:<page>` when it still fits in 64 bytes (a back-reference is a nicety, never a reason to fail). */
function withBack(s: string, back: ListPos | undefined): string {
  if (!back) return s;
  const full = `${s}:${encodeList(back.list)}:${clampPage(back.page)}`;
  return Buffer.byteLength(full) <= CALLBACK_MAX_BYTES ? full : s;
}

function decodeBack(parts: string[], at: number): ListPos | undefined | null {
  if (parts.length === at) return undefined;
  if (parts.length !== at + 2) return null;
  const list = decodeList(parts[at]!);
  if (!list || !PAGE_RE.test(parts[at + 1]!)) return null;
  return { list, page: Number(parts[at + 1]) };
}

/** Encodes an action; throws if the result would exceed 64 bytes (use `fitsCallback` to test first). */
export function encode(action: Action): string {
  let s: string;
  switch (action.a) {
    case "home": s = "h"; break;
    case "noop": s = "x"; break;
    case "search": s = "s"; break;
    case "help": s = "?"; break;
    case "genres": s = `G:${clampPage(action.page)}`; break;
    case "list": s = `L:${encodeList(action.list)}:${clampPage(action.page)}`; break;
    case "detail":
      s = withBack(`D:${uuidToShort(action.id)}`, action.back);
      break;
    case "episodes":
      s = withBack(`E:${uuidToShort(action.id)}:${checkNum(action.season, MAX_SEASON, "season")}:${clampPage(action.page)}`, action.back);
      break;
    case "episode":
      s = withBack(
        `P:${uuidToShort(action.id)}:${checkNum(action.season, MAX_SEASON, "season")}:${checkNum(action.episode, MAX_EPISODE, "episode")}`,
        action.back,
      );
      break;
  }
  if (Buffer.byteLength(s) > CALLBACK_MAX_BYTES) throw new Error(`callback data too long (${Buffer.byteLength(s)} bytes)`);
  return s;
}

/** Strict decoder: anything malformed, stale or forged returns null (never throws). */
export function decode(data: string | undefined | null): Action | null {
  if (typeof data !== "string" || data.length === 0 || Buffer.byteLength(data) > CALLBACK_MAX_BYTES) return null;
  switch (data) {
    case "h": return { a: "home" };
    case "x": return { a: "noop" };
    case "s": return { a: "search" };
    case "?": return { a: "help" };
  }
  const parts = data.split(":");
  const head = parts[0];
  if (head === "G" && parts.length === 2 && PAGE_RE.test(parts[1]!)) return { a: "genres", page: Number(parts[1]) };
  if (head === "L" && parts.length === 3 && PAGE_RE.test(parts[2]!)) {
    const list = decodeList(parts[1]!);
    return list ? { a: "list", list, page: Number(parts[2]) } : null;
  }
  if (head === "D" && parts.length >= 2) {
    const id = shortToUuid(parts[1]!);
    const back = decodeBack(parts, 2);
    if (!id || back === null) return null;
    return back ? { a: "detail", id, back } : { a: "detail", id };
  }
  if ((head === "E" || head === "P") && parts.length >= 4) {
    const id = shortToUuid(parts[1]!);
    const back = decodeBack(parts, 4);
    if (!id || back === null || !SEASON_RE.test(parts[2]!)) return null;
    const season = Number(parts[2]);
    if (head === "E") {
      if (!PAGE_RE.test(parts[3]!)) return null;
      const a: Action = { a: "episodes", id, season, page: Number(parts[3]) };
      return back ? { ...a, back } : a;
    }
    if (!EPISODE_RE.test(parts[3]!)) return null;
    const a: Action = { a: "episode", id, season, episode: Number(parts[3]) };
    return back ? { ...a, back } : a;
  }
  return null;
}

/** /start deep-link payloads (1–64 chars of [A-Za-z0-9_-]): `d_<id22>` opens a title, `q_<qid>` a search. */
export function startPayloadForTitle(id: string): string {
  return `d_${uuidToShort(id)}`;
}
export function parseStartPayload(p: string | undefined): Action | null {
  if (!p) return null;
  if (p.startsWith("d_")) {
    const id = shortToUuid(p.slice(2));
    return id ? { a: "detail", id } : null;
  }
  switch (p) {
    case "moi": return { a: "list", list: { kind: "new" }, page: 1 };
    case "hot": return { a: "list", list: { kind: "hot" }, page: 1 };
    case "phimle": return { a: "list", list: { kind: "movies" }, page: 1 };
    case "phimbo": return { a: "list", list: { kind: "series" }, page: 1 };
  }
  return null;
}
