/** Xử lý playlist HLS thuần (không I/O) — dễ test. */
import { HLS_KEY_URI_PLACEHOLDER } from "@app/shared/media";

export interface RenditionInfo { name: string; height: number }

const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** `720p/index.m3u8` → `720p` (null nếu không theo bố cục chuẩn). */
export function renditionNameFromUri(uri: string): string | null {
  const m = /^(?:\.\/)?([A-Za-z0-9_-]{1,32})\/index\.m3u8$/.exec(uri.trim());
  return m ? m[1]! : null;
}

export function isValidRenditionName(name: string): boolean {
  return NAME_RE.test(name);
}

/**
 * Lọc master playlist: chỉ giữ variant có tên trong `allowed`, đổi URI variant thành `r/<name>/index.m3u8`
 * (tương đối, cùng origin với master). Bỏ I-frame playlist. Media (audio/sub) có URI cũng được đổi tương tự.
 */
export function rewriteMaster(text: string, allowed: Set<string>): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("#EXT-X-STREAM-INF")) {
      let j = i + 1;
      while (j < lines.length && (lines[j]!.trim() === "" || (lines[j]!.startsWith("#") && !lines[j]!.startsWith("#EXT")))) j++;
      const uri = lines[j]?.trim() ?? "";
      const name = renditionNameFromUri(uri);
      i = j;
      if (!name || !allowed.has(name)) continue;
      out.push(line, `r/${name}/index.m3u8`);
      continue;
    }
    if (line.startsWith("#EXT-X-I-FRAME-STREAM-INF")) continue;
    if (line.startsWith("#EXT-X-MEDIA") && /URI="([^"]*)"/.test(line)) {
      const uri = /URI="([^"]*)"/.exec(line)![1]!;
      const name = renditionNameFromUri(uri);
      if (!name || !allowed.has(name)) continue;
      out.push(line.replace(/URI="[^"]*"/, `URI="r/${name}/index.m3u8"`));
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Tên các playlist con được tham chiếu từ master gốc (variant + media). */
export function masterRenditionNames(text: string): string[] {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#")) {
      const m = /URI="([^"]*)"/.exec(t);
      if (m && t.startsWith("#EXT-X-MEDIA")) {
        const n = renditionNameFromUri(m[1]!);
        if (n) names.add(n);
      }
      continue;
    }
    const n = renditionNameFromUri(t);
    if (n) names.add(n);
  }
  return [...names];
}

/**
 * Viết lại playlist rendition:
 *  - URI segment (tương đối với `hls/<asset>/<rendition>/`) → URL CDN đã ký (`signObject(objectKey)`)
 *  - `#EXT-X-KEY` URI (placeholder của worker) → `keyUrl`
 *  - `#EXT-X-MAP` URI → URL CDN đã ký
 * Object nằm ngoài `hls/<asset>/` bị từ chối (ném lỗi).
 */
export function rewriteRendition(
  text: string,
  opts: { assetPrefix: string; renditionDir: string; keyUrl: string; signObject: (objectKey: string) => string },
): string {
  const base = `https://x/${opts.renditionDir.replace(/\/?$/, "/")}`;
  const prefix = opts.assetPrefix.replace(/\/?$/, "/");
  const resolve = (uri: string) => {
    if (/^[a-z]+:/i.test(uri)) throw new Error(`URI tuyệt đối không được phép trong playlist: ${uri}`);
    const key = decodeURIComponent(new URL(uri, base).pathname.slice(1));
    if (!key.startsWith(prefix)) throw new Error(`URI ra ngoài asset: ${uri}`);
    return opts.signObject(key);
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#EXT-X-KEY")) {
        if (/METHOD=NONE/.test(t)) return line;
        return /URI="[^"]*"/.test(t) ? t.replace(/URI="[^"]*"/, `URI="${opts.keyUrl}"`) : `${t},URI="${opts.keyUrl}"`;
      }
      if (t.startsWith("#EXT-X-MAP")) return t.replace(/URI="([^"]*)"/, (_m, u: string) => `URI="${resolve(u)}"`);
      if (t.startsWith("#")) return line;
      return resolve(t);
    })
    .join("\n");
}

export { HLS_KEY_URI_PLACEHOLDER };
