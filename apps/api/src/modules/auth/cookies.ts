import type { CookieOptions, Response } from "express";
import { ACCESS_COOKIE, PROFILE_COOKIE, REFRESH_COOKIE } from "../../common/auth.js";

export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_SEC = 30 * 24 * 3600;
const PROFILE_TTL_SEC = 365 * 24 * 3600;

/** Trình duyệt thấy API dưới `/api/v1` (Next rewrite) nên cookie refresh phải dùng prefix đó. */
function publicPrefix(): string {
  return (process.env.COOKIE_PATH_PREFIX ?? "/api/v1").replace(/\/$/, "");
}
export const refreshCookiePath = () => `${publicPrefix()}/auth`;

function base(): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" };
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(ACCESS_COOKIE, accessToken, { ...base(), path: "/", maxAge: ACCESS_TTL_SEC * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...base(), path: refreshCookiePath(), maxAge: REFRESH_TTL_SEC * 1000 });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...base(), path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...base(), path: refreshCookiePath() });
  res.clearCookie(PROFILE_COOKIE, { ...base(), path: "/" });
}

export function setProfileCookie(res: Response, profileId: string) {
  res.cookie(PROFILE_COOKIE, profileId, { ...base(), path: "/", maxAge: PROFILE_TTL_SEC * 1000 });
}

export function clearProfileCookie(res: Response) {
  res.clearCookie(PROFILE_COOKIE, { ...base(), path: "/" });
}
