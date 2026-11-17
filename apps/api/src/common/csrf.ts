import type { NextFunction, Request, Response } from "express";
import { crossSiteCookies } from "../modules/auth/cookies.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function allowedOrigins(): Set<string> {
  const list = [process.env.PUBLIC_WEB_URL, ...(process.env.CSRF_ALLOWED_ORIGINS ?? "").split(",")];
  const out = new Set<string>();
  for (const raw of list) {
    const v = raw?.trim();
    if (!v) continue;
    try {
      out.add(new URL(v).origin);
    } catch {
      /* bỏ qua giá trị sai */
    }
  }
  return out;
}

/**
 * Chỉ bật khi AUTH_COOKIE_SAMESITE=none: cookie đi kèm cả request khác site nên phải tự chặn CSRF.
 * Request ghi dữ liệu (POST/PUT/PATCH/DELETE) mà trình duyệt gửi Origin khác web → 403.
 * Origin "null" (iframe sandbox, file://) cũng bị chặn. Không có Origin (client không phải trình duyệt, curl, server-to-server) → cho qua như trước.
 */
export function csrfOriginCheck(req: Request, res: Response, next: NextFunction) {
  if (!crossSiteCookies() || SAFE.has(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin || allowedOrigins().has(origin)) return next();
  res.status(403).json({ statusCode: 403, code: "FORBIDDEN", message: "Origin không hợp lệ" });
}
