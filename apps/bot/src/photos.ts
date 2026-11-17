/**
 * Photo pipeline: artwork comes from the private media bucket (WebP), is composed/converted with sharp to JPEG,
 * uploaded to Telegram once, and the returned file_id is cached (memory + Redis) so repeat views are instant.
 */
import { createHash } from "node:crypto";
import { InputFile } from "grammy";
import type { KV } from "./lib/kv.js";
import { errMessage, logger } from "./lib/log.js";
import type { MediaStore } from "./lib/media.js";

const log = logger("photos");
const FILE_ID_TTL = 60 * 86_400; // Telegram file_ids are long-lived; re-upload is cheap if one goes stale
const RENDER_VERSION = "v1"; // bump when the card design changes so old file_ids are not reused

/** A photo that may already be on Telegram's servers. `key` must change whenever the rendered bytes would. */
export interface PhotoRef {
  key: string;
  render: () => Promise<Buffer>;
}

export function hashKey(parts: (string | number | null | undefined)[]): string {
  return createHash("sha256").update(parts.map((p) => String(p ?? "")).join("\u0001")).digest("base64url").slice(0, 22);
}

export class PhotoService {
  private botId = "0";
  private readonly inflight = new Map<string, Promise<Buffer>>();
  private readonly art = new Map<string, Promise<Buffer | null>>();

  constructor(private readonly kv: KV, private readonly media: MediaStore) {}

  /** file_ids are per bot, so cache keys are namespaced by bot id. */
  setBotId(id: number | string) {
    this.botId = String(id);
  }

  private cacheKey(ref: PhotoRef) {
    return `bot:fid:${this.botId}:${RENDER_VERSION}:${ref.key}`;
  }

  async cachedFileId(ref: PhotoRef): Promise<string | null> {
    return this.kv.get(this.cacheKey(ref));
  }

  async remember(ref: PhotoRef, fileId: string) {
    await this.kv.set(this.cacheKey(ref), fileId, FILE_ID_TTL);
  }

  async forget(ref: PhotoRef) {
    await this.kv.del(this.cacheKey(ref));
  }

  /** Renders (deduplicating concurrent renders of the same key). */
  async render(ref: PhotoRef): Promise<Buffer> {
    let p = this.inflight.get(ref.key);
    if (!p) {
      p = ref.render().finally(() => this.inflight.delete(ref.key));
      this.inflight.set(ref.key, p);
    }
    return p;
  }

  /** Either a cached file_id or a fresh upload. */
  async resolve(ref: PhotoRef): Promise<{ media: string | InputFile; uploaded: boolean }> {
    const fid = await this.cachedFileId(ref);
    if (fid) return { media: fid, uploaded: false };
    const buf = await this.render(ref);
    return { media: new InputFile(buf, `boxphim-${ref.key.slice(0, 12)}.jpg`), uploaded: true };
  }

  /** Raw artwork from the media bucket with a small in-process LRU; null when missing or unreadable. */
  loadArt(key: string | null | undefined): Promise<Buffer | null> {
    if (!key) return Promise.resolve(null);
    let p = this.art.get(key);
    if (!p) {
      p = this.media.get(key).catch((err) => {
        log.warn("artwork fetch failed", { key, err: errMessage(err) });
        this.art.delete(key);
        return null;
      });
      this.art.set(key, p);
      while (this.art.size > 120) this.art.delete(this.art.keys().next().value!);
    }
    return p;
  }
}

/** Largest PhotoSize file_id from a sent/edited message. */
export function largestPhotoId(msg: unknown): string | null {
  const photos = (msg as { photo?: { file_id: string; width: number; height: number }[] } | undefined)?.photo;
  if (!Array.isArray(photos) || !photos.length) return null;
  return photos.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a)).file_id;
}
