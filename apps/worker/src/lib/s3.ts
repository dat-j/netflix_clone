import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { S3Config } from "../env.js";
import { applyKeyPrefix, stripKeyPrefix } from "./scope.js";

export interface Bucket {
  client: S3Client;
  name: string;
  /**
   * Prepended to every key on the wire (MEDIA_S3_PREFIX for the media bucket; "" for the source bucket, whose keys
   * are stored in full). Callers always use LOGICAL keys; listings return logical keys.
   */
  keyPrefix: string;
}

export function createBucket(cfg: S3Config, keyPrefix = ""): Bucket {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // Some S3-compatible gateways reject the newer default CRC32 checksums.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return { client, name: cfg.bucket, keyPrefix };
}

/** Physical (on-the-wire) key for a logical key. */
export function physicalKey(b: Bucket, key: string): string {
  return b.keyPrefix ? applyKeyPrefix(b.keyPrefix, key) : key;
}

/**
 * Async iterator over every object under `prefix` (handles pagination). Keys are logical (bucket keyPrefix removed)
 * and anything not starting with `prefix` is dropped (defence in depth for scoped listings).
 */
export async function* listAllObjects(b: Bucket, prefix = ""): AsyncGenerator<_Object> {
  let token: string | undefined;
  const wirePrefix = physicalKey(b, prefix);
  do {
    const res = await b.client.send(
      new ListObjectsV2Command({ Bucket: b.name, Prefix: wirePrefix || undefined, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of res.Contents ?? []) {
      if (!o.Key) continue;
      const logical = b.keyPrefix ? stripKeyPrefix(b.keyPrefix, o.Key) : o.Key;
      if (logical === null || !logical.startsWith(prefix)) continue;
      yield { ...o, Key: logical };
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
}

export function presignGet(b: Bucket, key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(b.client, new GetObjectCommand({ Bucket: b.name, Key: physicalKey(b, key) }), { expiresIn });
}

export async function headObject(b: Bucket, key: string) {
  return b.client.send(new HeadObjectCommand({ Bucket: b.name, Key: physicalKey(b, key) }));
}

export async function downloadToFile(b: Bucket, key: string, dest: string, signal?: AbortSignal): Promise<number> {
  const res = await b.client.send(new GetObjectCommand({ Bucket: b.name, Key: physicalKey(b, key) }), { abortSignal: signal });
  if (!res.Body) throw new Error(`Empty body for s3://${b.name}/${key}`);
  await pipeline(res.Body as Readable, createWriteStream(dest), { signal });
  return (await stat(dest)).size;
}

const CONTENT_TYPES: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".m4s": "video/iso.segment",
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".vtt": "text/vtt; charset=utf-8",
  ".json": "application/json",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};
export function contentTypeFor(key: string): string {
  return CONTENT_TYPES[extname(key).toLowerCase()] ?? "application/octet-stream";
}

const MULTIPART_THRESHOLD = 32 * 1024 * 1024;

/** Uploads a local file. Small files use a single PutObject; big ones use multipart (lib-storage). */
export async function uploadFile(b: Bucket, localPath: string, key: string, opts: { cacheControl?: string } = {}) {
  const size = (await stat(localPath)).size;
  const common = {
    Bucket: b.name,
    Key: physicalKey(b, key),
    ContentType: contentTypeFor(key),
    CacheControl: opts.cacheControl,
  };
  if (size < MULTIPART_THRESHOLD) {
    await b.client.send(new PutObjectCommand({ ...common, Body: createReadStream(localPath), ContentLength: size }));
    return size;
  }
  await new Upload({
    client: b.client,
    params: { ...common, Body: createReadStream(localPath) },
    partSize: 16 * 1024 * 1024,
    queueSize: 4,
  }).done();
  return size;
}

/** Deletes the given (logical) keys in batches of 1000. */
export async function deleteKeys(b: Bucket, keys: string[]) {
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    const res = await b.client.send(
      new DeleteObjectsCommand({ Bucket: b.name, Delete: { Objects: chunk.map((k) => ({ Key: physicalKey(b, k) })), Quiet: true } }),
    );
    if (res.Errors?.length) throw new Error(`DeleteObjects failed for ${res.Errors.length} keys: ${res.Errors[0]?.Message}`);
  }
}
