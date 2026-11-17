import { createHmac } from "node:crypto";
import { BunnyCdnSigner, bunnySignDirectory, roundedDailyExpiry } from "./cdn-signer.js";

/** Bản tham chiếu viết lại thẳng từ token.js chính thức của Bunny (signUrl, isDirectory=true, không IP). */
function referenceSign(url: string, key: string, expires: number, pathAllowed: string): string {
  const parsed = new URL(url);
  const parameters: Record<string, string> = { token_path: pathAllowed };
  const sorted = Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b));
  const signingData = sorted.map(([k, v]) => `${k}=${v}`).join("&");
  const urlData = sorted.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const h = createHmac("sha256", key);
  h.update(pathAllowed);
  h.update(String(expires));
  h.update(signingData);
  const token = "HS256-" + h.digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${parsed.protocol}//${parsed.host}/bcdn_token=${token}&${urlData}&expires=${expires}${parsed.pathname}`;
}

describe("Bunny token signing", () => {
  const key = "test-security-key";
  const exp = 1_900_000_000;

  it("matches the official algorithm for directory tokens", () => {
    const pathname = "/streaming/media/hls/abc/720p/seg_00001.ts";
    const dir = "/streaming/media/hls/abc/";
    expect(bunnySignDirectory({ baseUrl: "https://boxphim.b-cdn.net", securityKey: key, pathname, directory: dir, expires: exp }))
      .toBe(referenceSign(`https://boxphim.b-cdn.net${pathname}`, key, exp, dir));
  });

  it("puts the token in the path so relative URLs inherit it", () => {
    const url = bunnySignDirectory({ baseUrl: "https://z.b-cdn.net", securityKey: key, pathname: "/p/hls/a/thumbs/thumbs.vtt", directory: "/p/hls/a/", expires: exp });
    expect(new URL("sprite_001.jpg", url).href).toBe(url.replace("thumbs.vtt", "sprite_001.jpg"));
    expect(url).toMatch(/^https:\/\/z\.b-cdn\.net\/bcdn_token=HS256-[A-Za-z0-9_-]+&token_path=%2Fp%2Fhls%2Fa%2F&expires=1900000000\/p\/hls\/a\/thumbs\/thumbs\.vtt$/);
  });

  it("signer applies MEDIA_S3_PREFIX and scopes tokens to the asset or images directory", () => {
    process.env.MEDIA_S3_PREFIX = "streaming/media";
    const s = new BunnyCdnSigner("https://z.b-cdn.net/", key, 21600, 604800);
    const seg = s.signedUrl("hls/asset1/480p/seg_00000.ts");
    expect(seg).toContain("token_path=%2Fstreaming%2Fmedia%2Fhls%2Fasset1%2F");
    expect(seg.endsWith("/streaming/media/hls/asset1/480p/seg_00000.ts")).toBe(true);
    const img = s.publicUrl("images/t1/poster.webp");
    expect(img).toContain("token_path=%2Fstreaming%2Fmedia%2Fimages%2F");
    expect(img.endsWith("/streaming/media/images/t1/poster.webp")).toBe(true);
    expect(() => s.publicUrl("books/secret.pdf")).toThrow();
    delete process.env.MEDIA_S3_PREFIX;
  });

  it("rounds image expiry to whole days", () => {
    expect(roundedDailyExpiry(604800, 1_000_000) % 86400).toBe(0);
  });
});
