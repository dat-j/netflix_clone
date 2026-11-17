/**
 * Xác thực `initData` của Telegram Mini App theo tài liệu chính thức
 * (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 *
 *   data_check_string = mọi trường nhận được TRỪ `hash`, sắp xếp theo key, dạng `key=<value>` nối bằng "\n"
 *   secret_key        = HMAC_SHA256(key = "WebAppData", data = bot_token)
 *   hash hợp lệ       ⇔ hex(HMAC_SHA256(key = secret_key, data = data_check_string)) == hash
 *
 * Trường `signature` (Ed25519, dành cho bên thứ ba) vẫn nằm trong data_check_string vì chỉ `hash` bị loại.
 * Ngoài chữ ký còn kiểm tra `auth_date` để initData bị lộ không dùng lại được mãi.
 *
 * Không bao giờ log initData/bot token.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const INIT_DATA_MAX_AGE_SEC = 24 * 3600;
/** Cho phép đồng hồ client/Telegram lệch nhẹ về tương lai */
const FUTURE_SKEW_SEC = 60;

export interface TelegramWebAppUser {
  id: bigint;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  photoUrl: string | null;
  isBot: boolean;
}

export interface VerifiedInitData {
  user: TelegramWebAppUser;
  authDate: Date;
  startParam: string | null;
}

export type InitDataFailure = "MALFORMED" | "MISSING_HASH" | "BAD_HASH" | "EXPIRED" | "NO_USER";

export class InitDataError extends Error {
  constructor(readonly reason: InitDataFailure) {
    super(`initData không hợp lệ (${reason})`);
  }
}

export function secretKeyFor(botToken: string): Buffer {
  return createHmac("sha256", "WebAppData").update(botToken).digest();
}

export function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/** Ký một bộ trường thành initData hợp lệ — dùng cho test (và công cụ dev). */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  params.delete("hash");
  const hash = createHmac("sha256", secretKeyFor(botToken)).update(dataCheckString(params)).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

function str(v: unknown, max = 256): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
}

export function verifyInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeSec?: number; now?: Date } = {},
): VerifiedInitData {
  if (!botToken) throw new Error("Thiếu bot token");
  if (typeof initData !== "string" || initData.length === 0 || initData.length > 8192) throw new InitDataError("MALFORMED");

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    throw new InitDataError("MALFORMED");
  }
  // Mỗi key chỉ được xuất hiện một lần (tránh mơ hồ khi parse)
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw new InitDataError("MALFORMED");

  const hash = params.get("hash");
  if (!hash) throw new InitDataError("MISSING_HASH");
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new InitDataError("BAD_HASH");

  const expected = createHmac("sha256", secretKeyFor(botToken)).update(dataCheckString(params)).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new InitDataError("BAD_HASH");

  // Chữ ký đúng → giờ mới tin nội dung
  const authDateSec = Number(params.get("auth_date"));
  if (!Number.isInteger(authDateSec) || authDateSec <= 0) throw new InitDataError("MALFORMED");
  const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const maxAge = opts.maxAgeSec ?? INIT_DATA_MAX_AGE_SEC;
  if (nowSec - authDateSec > maxAge || authDateSec - nowSec > FUTURE_SKEW_SEC) throw new InitDataError("EXPIRED");

  const rawUser = params.get("user");
  if (!rawUser) throw new InitDataError("NO_USER");
  let u: Record<string, unknown>;
  try {
    u = JSON.parse(rawUser) as Record<string, unknown>;
  } catch {
    throw new InitDataError("MALFORMED");
  }
  // Telegram: user id có tối đa 52 bit có nghĩa → luôn là safe integer trong JS
  if (typeof u !== "object" || u === null || typeof u.id !== "number" || !Number.isSafeInteger(u.id) || u.id <= 0) {
    throw new InitDataError("NO_USER");
  }

  return {
    user: {
      id: BigInt(u.id),
      firstName: str(u.first_name),
      lastName: str(u.last_name),
      username: str(u.username, 64),
      languageCode: str(u.language_code, 16),
      photoUrl: str(u.photo_url, 1024),
      isBot: u.is_bot === true,
    },
    authDate: new Date(authDateSec * 1000),
    startParam: str(params.get("start_param"), 512),
  };
}
