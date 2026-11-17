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

/**
 * AUTH_COOKIE_SAMESITE=lax (mặc định) | none.
 * `none` chỉ cần khi web chạy trong iframe khác site (Telegram Web nhúng Mini App): cookie Lax không được gửi/lưu ở đó.
 * `none` bắt buộc Secure (HTTPS) và nên đi kèm AUTH_COOKIE_PARTITIONED=true (CHIPS) để trình duyệt chặn cookie bên thứ ba
 * vẫn lưu được (theo partition của top-level site). Khi bật `none`, `csrfOriginCheck` (common/csrf.ts) chặn request
 * ghi dữ liệu có Origin lạ để bù cho việc mất bảo vệ CSRF của SameSite.
 */
export function crossSiteCookies(): boolean {
  return (process.env.AUTH_COOKIE_SAMESITE ?? "lax").trim().toLowerCase() === "none";
}

function base(): CookieOptions {
  if (crossSiteCookies()) {
    return { httpOnly: true, sameSite: "none", secure: true, partitioned: process.env.AUTH_COOKIE_PARTITIONED === "true" };
  }
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
