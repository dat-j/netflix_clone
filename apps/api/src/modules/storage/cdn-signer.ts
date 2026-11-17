import { createHmac } from "node:crypto";
import { signCdnPrefix } from "@app/shared/media";
import { normalizePrefix } from "./storage.service.js";
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
 * Thuật toán Bunny CDN Token Authentication (advanced, SHA256), port từ mã mẫu chính thức
 * BunnyWay/BunnyCDN.TokenAuthentication (nodejs/token.js):
 *   hash  = HMAC-SHA256(securityKey, signaturePath + expires + signingData)   (không ký IP)
 *   token = "HS256-" + base64url(hash) (bỏ "=")
 *   signingData = các tham số token_* sắp xếp theo tên, nối "k=v&k=v" (giá trị thô)
 *   URL thư mục = `${base}/bcdn_token=${token}&token_path=${encodeURIComponent(path)}&expires=${exp}${pathname}`
 * Dạng token-trong-path giúp URL tương đối (sprite trong thumbs.vtt) tự mang theo token.
 */
export function bunnySignDirectory(opts: {
  baseUrl: string;
  securityKey: string;
  /** Đường dẫn object trên CDN, bắt đầu bằng "/" */
  pathname: string;
  /** Thư mục được phép, bắt đầu và kết thúc bằng "/" */
  directory: string;
  expires: number;
}): string {
  const params: Record<string, string> = { token_path: opts.directory };
  const keys = Object.keys(params).sort((a, b) => a.localeCompare(b));
  const signingData = keys.map((k) => `${k}=${params[k]}`).join("&");
  const urlData = keys.map((k) => `${k}=${encodeURIComponent(params[k]!)}`).join("&");
  const digest = createHmac("sha256", opts.securityKey)
    .update(opts.directory)
    .update(String(opts.expires))
    .update(signingData)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${opts.baseUrl}/bcdn_token=HS256-${digest}&${urlData}&expires=${opts.expires}${opts.pathname}`;
}

/** Hết hạn dài cho ảnh, làm tròn theo ngày để URL ảnh ổn định (cache trình duyệt/Next image tốt). */
export function roundedDailyExpiry(ttlSec: number, nowSec = Math.floor(Date.now() / 1000)): number {
  const bucket = 86400;
  return Math.ceil((nowSec + ttlSec) / bucket) * bucket;
}

/**
 * Provider `bunny`: Pull Zone kéo từ bucket media (S3 Authentication), bật Token Authentication cho
 * TOÀN BỘ zone. Vì bucket dùng chung với app khác, mọi URL (kể cả ảnh) đều phải ký và chỉ ký trong
 * prefix của app (MEDIA_S3_PREFIX) — không có đường nào đọc được object ngoài prefix.
 * Đường dẫn trên CDN = key vật lý trong bucket (MEDIA_S3_PREFIX + key logic).
 */
export class BunnyCdnSigner extends CdnSigner {
  readonly provider = "bunny";
  private readonly prefix = normalizePrefix(process.env.MEDIA_S3_PREFIX);
  constructor(
    private readonly baseUrl = trimSlash(env("CDN_BASE_URL")),
    private readonly securityKey = env("CDN_SIGNING_SECRET"),
    private readonly ttlSec = Number(env("CDN_TOKEN_TTL_SECONDS", "21600")),
    private readonly imageTtlSec = Number(env("CDN_IMAGE_TOKEN_TTL_SECONDS", "604800")),
  ) {
    super();
  }
  signedUrl(objectKey: string): string {
    return bunnySignDirectory({
      baseUrl: this.baseUrl,
      securityKey: this.securityKey,
      pathname: `/${this.prefix}${objectKey}`,
      directory: `/${this.prefix}${signedPrefixOf(objectKey)}`,
      expires: roundedExpiry(this.ttlSec),
    });
  }
  publicUrl(key: string): string {
    if (!key.startsWith("images/")) throw new Error(`Chỉ ký ảnh dưới images/: ${key}`);
    return bunnySignDirectory({
      baseUrl: this.baseUrl,
      securityKey: this.securityKey,
      pathname: `/${this.prefix}${key}`,
      directory: `/${this.prefix}images/`,
      expires: roundedDailyExpiry(this.imageTtlSec),
    });
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
