/** Read-only access to artwork in the media bucket. Keys are LOGICAL (as stored in DB); MEDIA_S3_PREFIX is added on the wire. */
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { MediaS3Config } from "../env.js";

export interface MediaStore {
  get(key: string): Promise<Buffer | null>;
  close(): void;
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

export class S3MediaStore implements MediaStore {
  private readonly client: S3Client;
  constructor(private readonly cfg: MediaS3Config) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  physicalKey(key: string): string {
    return this.cfg.prefix + key.replace(/^\/+/, "");
  }
  async get(key: string): Promise<Buffer | null> {
    if (!key || key.includes("..")) return null;
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.physicalKey(key) }));
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
  close() {
    this.client.destroy();
  }
}
