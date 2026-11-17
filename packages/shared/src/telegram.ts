/**
 * Đường dẫn trong app mà Mini App được phép mở qua `/tg?to=<path>` (bot và web dùng chung).
 * Mọi giá trị khác (URL tuyệt đối, `//host`, `\`, path lạ, ký tự điều khiển) → `/browse` để chặn open redirect.
 */
export const MINI_APP_DEFAULT_PATH = "/browse";

const SLUG = "[A-Za-z0-9][A-Za-z0-9_-]{0,199}";
const ALLOWED: RegExp[] = [
  /^\/browse$/,
  /^\/browse\/movies$/,
  /^\/browse\/series$/,
  new RegExp(`^/browse/genre/${SLUG}$`),
  new RegExp(`^/title/${SLUG}$`),
  /^\/watch\/[0-9a-fA-F-]{36}$/,
  /^\/my-list$/,
  /^\/search$/,
  /^\/account$/,
  /^\/plans$/,
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeMiniAppPath(to: string | null | undefined): string {
  if (typeof to !== "string" || to.length === 0 || to.length > 500) return MINI_APP_DEFAULT_PATH;
  // Chỉ path tương đối gốc; chặn "//evil", "/\\evil", ký tự điều khiển/khoảng trắng
  if (!to.startsWith("/") || to.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(to)) {
    return MINI_APP_DEFAULT_PATH;
  }
  let url: URL;
  try {
    url = new URL(to, "http://mini.app.invalid");
  } catch {
    return MINI_APP_DEFAULT_PATH;
  }
  if (url.origin !== "http://mini.app.invalid" || url.hash) return MINI_APP_DEFAULT_PATH;
  const { pathname } = url;
  if (!ALLOWED.some((re) => re.test(pathname))) return MINI_APP_DEFAULT_PATH;
  if (pathname === "/search") {
    const q = url.searchParams.get("q")?.trim().slice(0, 100) ?? "";
    return q ? `/search?q=${encodeURIComponent(q)}` : "/search";
  }
  // /watch/<titleId> được mang thêm ?episode=<uuid> (mở thẳng một tập phim bộ); giá trị khác bị bỏ
  if (pathname.startsWith("/watch/")) {
    const episode = url.searchParams.get("episode");
    if (episode && UUID_RE.test(episode)) return `${pathname}?episode=${episode}`;
    return pathname;
  }
  // Các path khác không mang query
  return pathname;
}
