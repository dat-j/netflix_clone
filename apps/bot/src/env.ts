/**
 * Loads the monorepo root `.env` (no-op when absent, e.g. in Docker/Railway where env comes from the runtime) and
 * exposes a typed config. Import this module first in every entrypoint.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const envFile = join(REPO_ROOT, ".env");
if (existsSync(envFile)) loadDotenv({ path: envFile, quiet: true });

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v.trim() !== "") return v.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`Thiếu biến môi trường ${name}`);
}
function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`Biến ${name} phải là số nguyên, nhận "${v}"`);
  return n;
}
function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

/** "" stays ""; otherwise strips slashes and guarantees exactly one trailing slash (same rule as API + worker). */
export function normalizePrefix(raw: string | undefined | null): string {
  const s = (raw ?? "").trim().replace(/^\/+|\/+$/g, "");
  return s ? `${s}/` : "";
}

export interface MediaS3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** Physical prefix prepended to every logical key (MEDIA_S3_PREFIX); DB keys never contain it. */
  prefix: string;
}

function build() {
  return {
    /** Empty → the bot is disabled (main.ts logs and exits 0). */
    token: (process.env.TELEGRAM_BOT_TOKEN ?? "").trim(),
    /** Optional: when set the bot runs in webhook mode on PORT instead of long polling. */
    webhookUrl: (process.env.TELEGRAM_WEBHOOK_URL ?? "").trim(),
    /** Optional secret for X-Telegram-Bot-Api-Secret-Token; derived from the token when empty. */
    webhookSecret: (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim(),
    port: int("PORT", 8080),
    /**
     * Optional public origin of this service (e.g. a Railway domain). Enables the HTTP server (health + JPEG
     * thumbnails for inline results) in polling mode; defaults to the origin of TELEGRAM_WEBHOOK_URL.
     */
    /** Public @username (without "@") used in t.me links and help text; the real bot is @boxphim_bot. */
    botUsername: ((process.env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "") || "boxphim_bot"),
    publicBotUrl: (process.env.BOT_PUBLIC_URL ?? "").trim().replace(/\/+$/, ""),
    get publicWebUrl() {
      return str("PUBLIC_WEB_URL").replace(/\/+$/, "");
    },
    get databaseUrl() {
      return str("DATABASE_URL");
    },
    /** Optional; without Redis the file_id cache and search-query store are in-memory only. */
    redisUrl: (process.env.REDIS_URL ?? "").trim(),
    get media(): MediaS3Config {
      return {
        endpoint: process.env.MEDIA_S3_ENDPOINT || undefined,
        region: str("MEDIA_S3_REGION", "us-east-1"),
        bucket: str("MEDIA_S3_BUCKET"),
        accessKeyId: str("MEDIA_S3_ACCESS_KEY_ID"),
        secretAccessKey: str("MEDIA_S3_SECRET_ACCESS_KEY"),
        forcePathStyle: bool("MEDIA_S3_FORCE_PATH_STYLE", false),
        prefix: normalizePrefix(process.env.MEDIA_S3_PREFIX),
      };
    },
    /** Updates per user per window before the bot starts ignoring them. */
    rateLimit: { max: Math.max(1, int("BOT_RATE_LIMIT_MAX", 20)), windowMs: Math.max(1000, int("BOT_RATE_LIMIT_WINDOW_MS", 10_000)) },
    debug: bool("BOT_DEBUG", false),
  };
}
let cached: ReturnType<typeof build> | undefined;
export function env() {
  cached ??= build();
  return cached;
}
export type BotEnv = ReturnType<typeof env>;
