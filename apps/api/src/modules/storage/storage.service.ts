import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  GetObjectCommand, HeadObjectCommand, NoSuchKey, NotFound, PutObjectCommand, S3Client, DeleteObjectCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { env } from "../../env.js";

export type BucketName = "source" | "media";

function makeClient(prefix: "SOURCE" | "MEDIA"): S3Client {
  return new S3Client({
    endpoint: env(`${prefix}_S3_ENDPOINT`),
    region: env(`${prefix}_S3_REGION`, "us-east-1"),
    forcePathStyle: env(`${prefix}_S3_FORCE_PATH_STYLE`, "false") === "true",
    credentials: {
      accessKeyId: env(`${prefix}_S3_ACCESS_KEY_ID`),
      secretAccessKey: env(`${prefix}_S3_SECRET_ACCESS_KEY`),
    },
  });
}

export function normalizePrefix(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `${trimmed}/` : "";
}

export function isNotFound(err: unknown): boolean {
  if (err instanceof NoSuchKey || err instanceof NotFound) return true;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

/** S3 clients cho bucket nguồn (chỉ đọc) và bucket media (HLS + ảnh). */
@Injectable()
export class StorageService implements OnModuleDestroy {
  readonly source = makeClient("SOURCE");
  readonly media = makeClient("MEDIA");
  readonly sourceBucket = env("SOURCE_S3_BUCKET");
  readonly mediaBucket = env("MEDIA_S3_BUCKET");
  /**
   * Prefix vật lý trong bucket media (để dùng chung bucket với project khác). Cùng quy tắc với worker:
   * DB, playlist và URL CDN chỉ chứa key logic; prefix chỉ được ghép khi gọi S3.
   */
  private readonly mediaPrefix = normalizePrefix(process.env.MEDIA_S3_PREFIX);

  private pk(key: string): string {
    return this.mediaPrefix + key;
  }

  onModuleDestroy() {
    this.source.destroy();
    this.media.destroy();
  }

  /** GetObject trên bucket media; trả null nếu không tồn tại. */
  async getMediaObject(key: string, range?: string): Promise<GetObjectCommandOutput | null> {
    try {
      return await this.media.send(new GetObjectCommand({ Bucket: this.mediaBucket, Key: this.pk(key), Range: range }));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async getMediaText(key: string): Promise<string | null> {
    const obj = await this.getMediaObject(key);
    if (!obj?.Body) return null;
    return obj.Body.transformToString("utf-8");
  }

  async getMediaBuffer(key: string): Promise<Buffer | null> {
    const obj = await this.getMediaObject(key);
    if (!obj?.Body) return null;
    return Buffer.from(await obj.Body.transformToByteArray());
  }

  async putMedia(key: string, body: Buffer | string, contentType: string, cacheControl = "public, max-age=31536000, immutable") {
    await this.media.send(new PutObjectCommand({
      Bucket: this.mediaBucket, Key: this.pk(key), Body: body, ContentType: contentType, CacheControl: cacheControl,
    }));
  }

  async deleteMedia(key: string) {
    await this.media.send(new DeleteObjectCommand({ Bucket: this.mediaBucket, Key: this.pk(key) }));
  }

  async mediaExists(key: string): Promise<boolean> {
    try {
      await this.media.send(new HeadObjectCommand({ Bucket: this.mediaBucket, Key: this.pk(key) }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }
}
