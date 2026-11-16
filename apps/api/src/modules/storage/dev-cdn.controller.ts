import { Controller, Get, HttpCode, Inject, Options, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Readable } from "node:stream";
import { verifyCdnToken } from "@app/shared/media";
import { env } from "../../env.js";
import { ApiException } from "../../common/api-exception.js";
import { StorageService } from "./storage.service.js";

const CONTENT_TYPES: Record<string, string> = {
  ts: "video/mp2t",
  m3u8: "application/vnd.apple.mpegurl",
  vtt: "text/vtt; charset=utf-8",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  mp4: "video/mp4",
  m4s: "video/iso.segment",
  aac: "audio/aac",
};

export function contentTypeFor(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function keyParam(raw: unknown): string {
  // Express 5 wildcard `*key` → mảng đoạn path
  return Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
}

/**
 * CDN giả lập cho dev (chỉ đăng ký khi CDN_PROVIDER=local). Production thay bằng Bunny/Cloudflare.
 *   /dev-cdn/s/:token/:exp/*key  → object HLS có token (Range, CORS *)
 *   /dev-cdn/p/*key              → ảnh công khai dưới `images/`
 */
@Controller("dev-cdn")
export class DevCdnController {
  private readonly secret = env("CDN_SIGNING_SECRET");
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  /** Preflight CORS (hls.js/fetch có header Range). */
  @Options(["s/:token/:exp/*key", "p/*key"])
  @HttpCode(204)
  preflight(@Res({ passthrough: true }) res: Response) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    res.setHeader("Access-Control-Max-Age", "86400");
  }

  @Get("s/:token/:exp/*key")
  async signed(@Param("token") token: string, @Param("exp") exp: string, @Param("key") rawKey: unknown, @Req() req: Request, @Res() res: Response) {
    const key = keyParam(rawKey);
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (!key.startsWith("hls/") || !verifyCdnToken(key, token, Number(exp), this.secret)) {
      throw new ApiException(403, "FORBIDDEN", "Token CDN không hợp lệ hoặc đã hết hạn");
    }
    await this.stream(key, req, res, "public, max-age=86400, immutable");
  }

  @Get("p/*key")
  async publicImage(@Param("key") rawKey: unknown, @Req() req: Request, @Res() res: Response) {
    const key = keyParam(rawKey);
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (!key.startsWith("images/") || key.includes("..")) throw new ApiException(403, "FORBIDDEN", "Không được phép");
    await this.stream(key, req, res, "public, max-age=31536000, immutable");
  }

  private async stream(key: string, req: Request, res: Response, cacheControl: string) {
    const range = typeof req.headers.range === "string" ? req.headers.range : undefined;
    let obj;
    try {
      obj = await this.storage.getMediaObject(key, range);
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 416) {
        res.status(416).end();
        return;
      }
      throw err;
    }
    if (!obj?.Body) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy");
    res.status(range && obj.ContentRange ? 206 : 200);
    res.setHeader("Content-Type", contentTypeFor(key));
    res.setHeader("Cache-Control", cacheControl);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    if (obj.ContentLength !== undefined) res.setHeader("Content-Length", String(obj.ContentLength));
    if (obj.ContentRange) res.setHeader("Content-Range", obj.ContentRange);
    if (obj.ETag) res.setHeader("ETag", obj.ETag);
    if (obj.LastModified) res.setHeader("Last-Modified", obj.LastModified.toUTCString());
    const body = obj.Body as Readable;
    body.on("error", () => res.destroy());
    body.pipe(res);
  }
}
