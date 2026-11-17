/** Route classification shared by the proxy (server) and the client-side session guard. */

/** Only for logged-out visitors — logged-in users are sent into the app */
export const GUEST_ONLY = ["/", "/login", "/signup"];

/** Reachable by anyone (token links + marketing) */
/** `/tg` = Telegram Mini App entry (does its own initData sign-in). */
export const PUBLIC = ["/forgot-password", "/reset-password", "/verify-email", "/plans", "/tg"];

/** Need a session AND a selected profile */
export const PROFILE_REQUIRED = ["/browse", "/title", "/search", "/my-list", "/watch"];

function matches(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)));
}

export const isGuestOnly = (p: string) => matches(p, GUEST_ONLY);
export const isPublic = (p: string) => matches(p, PUBLIC) || isGuestOnly(p);
export const needsProfile = (p: string) => matches(p, PROFILE_REQUIRED);

/** API row links are app-agnostic (`/genre/<slug>`, `/my-list`); map them onto this web app's routes. */
export function mapApiHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const genre = /^\/genre\/([^/?#]+)/.exec(href);
  if (genre) return `/browse/genre/${genre[1]}`;
  if (href.startsWith("/")) return href;
  return null;
}

export function loginUrl(next?: string) {
  return next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login";
}
export function profilesUrl(next?: string) {
  return next && next !== "/browse" ? `/profiles?next=${encodeURIComponent(next)}` : "/profiles";
}
