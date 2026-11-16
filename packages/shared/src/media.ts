/**
 * Hợp đồng giữa apps/api và apps/worker (chỉ dùng phía server — có import node:crypto).
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ───────── hàng đợi BullMQ ─────────
export const QUEUE_TRANSCODE = "media-transcode";
export const QUEUE_PROBE = "media-probe";
export interface TranscodeJobData { assetId: string; transcodeJobId: string }
/** `scan`: liệt kê bucket nguồn (theo prefix) → upsert SourceFile rồi đẩy job `probe` cho từng file PENDING */
export type ProbeJobData =
  | { type: "scan"; prefix?: string }
  | { type: "probe"; sourceFileId: string };

// ───────── bố cục object trong bucket media ─────────
export const HLS_KEY_URI_PLACEHOLDER = "urn:app:hls-key";
export const mediaLayout = {
  assetPrefix: (assetId: string) => `hls/${assetId}`,
  master: (assetId: string) => `hls/${assetId}/master.m3u8`,
  renditionPlaylist: (assetId: string, rendition: string) => `hls/${assetId}/${rendition}/index.m3u8`,
  segmentPattern: "seg_%05d.ts",
  thumbsVtt: (assetId: string) => `hls/${assetId}/thumbs/thumbs.vtt`,
  thumbsSpritePattern: "sprite_%03d.jpg",
  posterFrame: (assetId: string) => `hls/${assetId}/poster.jpg`,
  titleImage: (titleId: string, file: string) => `images/${titleId}/${file}`,
};

/** Thang chất lượng chuẩn; worker bỏ các bậc cao hơn nguồn (luôn giữ ít nhất bậc thấp nhất). */
export const RENDITION_LADDER = [
  { name: "360p", height: 360, videoKbps: 800, audioKbps: 96 },
  { name: "480p", height: 480, videoKbps: 1400, audioKbps: 128 },
  { name: "720p", height: 720, videoKbps: 2800, audioKbps: 128 },
  { name: "1080p", height: 1080, videoKbps: 5000, audioKbps: 192 },
] as const;
export const HLS_SEGMENT_SECONDS = 4;

// ───────── mã hóa key AES-128 của asset khi lưu DB (AES-256-GCM) ─────────
function masterKey(secretHex: string): Buffer {
  const key = Buffer.from(secretHex, "hex");
  if (key.length !== 32) throw new Error("MEDIA_KEY_ENCRYPTION_SECRET phải là 32 byte hex");
  return key;
}
export function generateHlsKey(): { key: Buffer; ivHex: string } {
  return { key: randomBytes(16), ivHex: randomBytes(16).toString("hex") };
}
export function encryptMediaKey(key: Buffer, secretHex: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(secretHex), iv);
  const cipherText = Buffer.concat([cipher.update(key), cipher.final()]);
  return { encKeyCipher: cipherText, encKeyIv: iv, encKeyTag: cipher.getAuthTag() };
}
export function decryptMediaKey(
  enc: { encKeyCipher: Uint8Array; encKeyIv: Uint8Array; encKeyTag: Uint8Array },
  secretHex: string,
): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", masterKey(secretHex), enc.encKeyIv);
  decipher.setAuthTag(enc.encKeyTag);
  return Buffer.concat([decipher.update(enc.encKeyCipher), decipher.final()]);
}

// ───────── token CDN theo thư mục (provider `local`; bunny/cloudflare có signer riêng) ─────────
/** Ký một prefix thư mục, ví dụ `hls/<assetId>/`. URL: `${base}/s/${token}/${exp}/${objectKey}` */
export function signCdnPrefix(prefix: string, expUnix: number, secret: string): string {
  return createHmac("sha256", secret).update(`${prefix}\n${expUnix}`).digest("base64url");
}
export function verifyCdnToken(objectKey: string, token: string, expUnix: number, secret: string, nowUnix = Math.floor(Date.now() / 1000)): boolean {
  if (!Number.isFinite(expUnix) || expUnix < nowUnix) return false;
  if (objectKey.includes("..")) return false;
  // prefix được ký là 2 đoạn đầu: `hls/<assetId>/`
  const parts = objectKey.split("/");
  if (parts.length < 3) return false;
  const prefix = `${parts[0]}/${parts[1]}/`;
  const expected = Buffer.from(signCdnPrefix(prefix, expUnix, secret));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
