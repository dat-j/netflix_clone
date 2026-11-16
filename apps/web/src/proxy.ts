import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, AUTH_HINT_COOKIE, PROFILE_COOKIE } from "@/lib/auth-hint";
import { isGuestOnly, isPublic, loginUrl, needsProfile, profilesUrl } from "@/lib/routes";

/**
 * Optimistic route protection (cookie presence only — the API remains the authority).
 * - logged out → landing / login
 * - logged in without a selected profile → /profiles
 * - logged in on landing/login/signup → /browse
 *
 * "Logged in" = access cookie OR the web's auth hint. The hint keeps a user whose 15-minute
 * access token expired inside the app: the page renders and the client refreshes on the first 401.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const authed = request.cookies.has(ACCESS_COOKIE) || request.cookies.get(AUTH_HINT_COOKIE)?.value === "1";
  const hasProfile = request.cookies.has(PROFILE_COOKIE);
  const here = pathname + search;

  if (isGuestOnly(pathname)) {
    if (!authed) return NextResponse.next();
    // Respect ?next= from a bounce that the client could not recover from
    if (pathname === "/login" && request.nextUrl.searchParams.has("expired")) return NextResponse.next();
    return redirect(request, hasProfile ? "/browse" : "/profiles");
  }

  if (isPublic(pathname)) return NextResponse.next();

  if (!authed) return redirect(request, pathname === "/browse" ? "/login" : loginUrl(here));
  if (needsProfile(pathname) && !hasProfile) return redirect(request, profilesUrl(here));
  return NextResponse.next();
}

function redirect(request: NextRequest, to: string) {
  return NextResponse.redirect(new URL(to, request.url));
}

export const config = {
  matcher: [
    // Pages only: skip API rewrites, Next internals and static files
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|avatars|robots.txt|sitemap.xml|opengraph-image|.*\\.(?:svg|png|jpg|jpeg|webp|avif|gif|ico|txt|xml|webmanifest)$).*)",
  ],
};
