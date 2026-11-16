import { signCdnPrefix } from "@app/shared/media";
import { env } from "../../env.js";

/**
 * Lớp trừu tượng ký URL CDN. Token ký theo thư mục `hls/<assetId>/` để mọi segment/playlist/sprite
 * trong asset dùng chung một token (cache CDN tốt, playlist ngắn).
 */
export abstract class CdnSigner {
  abstract readonly provider: string;
  /** URL đã ký cho một object nằm dưới `hls/<assetId>/`. */
  abstract signedUrl(objectKey: string): string;
  /** URL công khai cho ảnh (`images/...`). */
  abstract publicUrl(key: string): string;
}

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/** Hết hạn làm tròn lên theo giờ để URL ổn định trong một khoảng → cache CDN/trình duyệt tốt hơn. */
export function roundedExpiry(ttlSec: number, nowSec = Math.floor(Date.now() / 1000)): number {
  const bucket = 3600;
  return Math.ceil((nowSec + ttlSec) / bucket) * bucket;
}

/** Prefix ký: 2 đoạn đầu của key, ví dụ `hls/<assetId>/`. */
export function signedPrefixOf(objectKey: string): string {
  const parts = objectKey.split("/");
  if (parts.length < 3) throw new Error(`Object key không hợp lệ để ký: ${objectKey}`);
  return `${parts[0]}/${parts[1]}/`;
}

/** Provider `local`: API tự phục vụ qua /v1/dev-cdn (DevCdnController). */
export class LocalCdnSigner extends CdnSigner {
  readonly provider = "local";
  constructor(
    private readonly baseUrl = trimSlash(env("CDN_BASE_URL")),
    private readonly secret = env("CDN_SIGNING_SECRET"),
    private readonly ttlSec = Number(env("CDN_TOKEN_TTL_SECONDS", "21600")),
  ) {
    super();
  }
  signedUrl(objectKey: string): string {
    const exp = roundedExpiry(this.ttlSec);
    const token = signCdnPrefix(signedPrefixOf(objectKey), exp, this.secret);
    return `${this.baseUrl}/s/${token}/${exp}/${objectKey}`;
  }
  publicUrl(key: string): string {
    return `${this.baseUrl}/p/${key}`;
  }
}

/**
 * Provider `bunny` — STUB.
 * TODO(bunny): dùng Bunny CDN Token Authentication (advanced, theo directory):
 *   token = base64url(sha256(securityKey + signedPath + expires [+ token_path]))
 *   URL  = `${pullZoneUrl}/bcdn_token=${token}&expires=${exp}&token_path=${encodeURIComponent(prefix)}/${objectKey}`
 *   Ảnh công khai: pull zone riêng không bật token (hoặc cùng zone với rule loại trừ `images/`).
 */
export class BunnyCdnSigner extends CdnSigner {
  readonly provider = "bunny";
  constructor(private readonly baseUrl = trimSlash(env("CDN_BASE_URL"))) {
    super();
  }
  signedUrl(_objectKey: string): string {
    throw new Error("TODO: BunnyCdnSigner chưa được triển khai (CDN_PROVIDER=bunny)");
  }
  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }
}

/**
 * Provider `cloudflare` — STUB.
 * TODO(cloudflare): R2 + Cloudflare Worker trước bucket; Worker kiểm tra HMAC giống `verifyCdnToken`
 *   (có thể tái dùng nguyên định dạng `/s/<token>/<exp>/<key>` của provider local) và trả object từ R2 binding.
 */
export class CloudflareCdnSigner extends CdnSigner {
  readonly provider = "cloudflare";
  constructor(private readonly baseUrl = trimSlash(env("CDN_BASE_URL"))) {
    super();
  }
  signedUrl(_objectKey: string): string {
    throw new Error("TODO: CloudflareCdnSigner chưa được triển khai (CDN_PROVIDER=cloudflare)");
  }
  publicUrl(key: string): string {
    return `${this.baseUrl}/p/${key}`;
  }
}

export function cdnProvider(): string {
  return env("CDN_PROVIDER", "local");
}

export function createCdnSigner(provider = cdnProvider()): CdnSigner {
  switch (provider) {
    case "local":
      return new LocalCdnSigner();
    case "bunny":
      return new BunnyCdnSigner();
    case "cloudflare":
      return new CloudflareCdnSigner();
    default:
      throw new Error(`CDN_PROVIDER không hỗ trợ: ${provider}`);
  }
}
