import { Injectable, Logger } from "@nestjs/common";
import { ApiException } from "../../common/api-exception.js";

const API = "https://api.themoviedb.org/3";
export const TMDB_IMG = "https://image.tmdb.org/t/p";

/** Client HTTP tối giản cho TMDB v3. Hỗ trợ cả API key v3 (query) lẫn read access token v4 (Bearer). */
@Injectable()
export class TmdbClient {
  private readonly logger = new Logger("TmdbClient");

  get apiKey(): string {
    return (process.env.TMDB_API_KEY ?? "").trim();
  }

  get enabled(): boolean {
    return this.apiKey.length > 0;
  }

  assertEnabled() {
    if (!this.enabled) {
      throw new ApiException(503, "INTERNAL", "TMDB chưa được cấu hình (TMDB_API_KEY trống) — vẫn có thể tạo title thủ công");
    }
  }

  async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    this.assertEnabled();
    const key = this.apiKey;
    const isBearer = key.includes(".") && key.length > 60;
    const url = new URL(`${API}${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    if (!isBearer) url.searchParams.set("api_key", key);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: "application/json", ...(isBearer ? { authorization: `Bearer ${key}` } : {}) },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      this.logger.warn(`TMDB ${path} lỗi mạng: ${(err as Error).message}`);
      throw new ApiException(502, "INTERNAL", "Không kết nối được TMDB");
    }
    if (res.status === 404) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy trên TMDB");
    if (res.status === 401) throw new ApiException(503, "INTERNAL", "TMDB_API_KEY không hợp lệ");
    if (!res.ok) throw new ApiException(502, "INTERNAL", `TMDB trả lỗi ${res.status}`);
    return (await res.json()) as T;
  }

  async download(path: string, size = "original"): Promise<Buffer | null> {
    try {
      const res = await fetch(`${TMDB_IMG}/${size}${path}`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      this.logger.warn(`Tải ảnh TMDB ${path} lỗi: ${(err as Error).message}`);
      return null;
    }
  }
}
