/**
 * Loads the monorepo root `.env` (no-op when the file is absent, e.g. in Docker where env comes from the runtime)
 * and exposes a typed config. Import this module first in every entrypoint.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { normalizePrefix } from "./lib/scope.js";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const envFile = join(REPO_ROOT, ".env");
if (existsSync(envFile)) loadDotenv({ path: envFile, quiet: true });

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env ${name}`);
}
function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be an integer, got "${v}"`);
  return n;
}
function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

export interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}
function s3(prefix: "SOURCE" | "MEDIA"): S3Config {
  return {
    endpoint: process.env[`${prefix}_S3_ENDPOINT`] || undefined,
    region: str(`${prefix}_S3_REGION`, "us-east-1"),
    bucket: str(`${prefix}_S3_BUCKET`),
    accessKeyId: str(`${prefix}_S3_ACCESS_KEY_ID`),
    secretAccessKey: str(`${prefix}_S3_SECRET_ACCESS_KEY`),
    forcePathStyle: bool(`${prefix}_S3_FORCE_PATH_STYLE`, false),
  };
}

let cached: ReturnType<typeof build> | undefined;
function build() {
  // Getters: required values are validated on first use, so e.g. `audit:bucket --no-db` only needs SOURCE_S3_*.
  return {
    get databaseUrl() {
      return str("DATABASE_URL");
    },
    redisUrl: str("REDIS_URL", "redis://localhost:6379"),
    get mediaKeySecret() {
      return str("MEDIA_KEY_ENCRYPTION_SECRET");
    },
    get source() {
      return s3("SOURCE");
    },
    /** Hard scope boundary inside the source bucket (normalized, e.g. "movies/"; "" = whole bucket). */
    sourcePrefix: normalizePrefix(process.env.SOURCE_S3_PREFIX),
    /** Worker-side equivalent of `--all-bucket` for scan jobs on a non-local endpoint with an empty prefix. */
    allowAllBucket: bool("SOURCE_S3_ALLOW_ALL_BUCKET", false),
    /** Prepended to every media-bucket key on the wire; DB keys stay WITHOUT it. */
    mediaPrefix: normalizePrefix(process.env.MEDIA_S3_PREFIX),
    get media() {
      return s3("MEDIA");
    },
    transcodeConcurrency: Math.max(1, int("TRANSCODE_CONCURRENCY", 1)),
    probeConcurrency: Math.max(1, int("PROBE_CONCURRENCY", 4)),
    workDir: str("TRANSCODE_WORK_DIR", join(tmpdir(), "media-worker")),
    /** libx264 preset; `veryfast` is a sane default for a CPU box, `medium`/`slow` for better compression. */
    x264Preset: str("X264_PRESET", "veryfast"),
    /** 0 = let ffmpeg decide. */
    ffmpegThreads: int("FFMPEG_THREADS", 0),
    uploadConcurrency: Math.max(1, int("UPLOAD_CONCURRENCY", 8)),
    shutdownGraceMs: int("SHUTDOWN_GRACE_MS", 30_000),
  };
}
export function env() {
  cached ??= build();
  return cached;
}
export type WorkerEnv = ReturnType<typeof env>;
