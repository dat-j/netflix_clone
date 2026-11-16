/** Sinh artwork demo bằng SVG → sharp (poster 2:3, backdrop 16:9, logo nền trong suốt). */
import { createHash } from "node:crypto";
import sharp from "sharp";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

function rng(seed: string) {
  let h = createHash("sha256").update(seed).digest();
  let i = 0;
  return () => {
    if (i >= h.length - 4) { h = createHash("sha256").update(h).digest(); i = 0; }
    const v = h.readUInt32BE(i) / 0xffffffff;
    i += 4;
    return v;
  };
}

function shapes(seed: string, w: number, h: number, color: string, n = 7): string {
  const r = rng(seed);
  let out = "";
  for (let i = 0; i < n; i++) {
    const cx = r() * w, cy = r() * h, rad = (0.08 + r() * 0.35) * Math.min(w, h);
    out += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rad.toFixed(0)}" fill="${color}" fill-opacity="${(0.06 + r() * 0.14).toFixed(2)}"/>`;
  }
  return out;
}

const FONT = `font-family="DejaVu Sans, Noto Sans, Liberation Sans, Arial, sans-serif"`;

function titleBlock(name: string, x: number, yBottom: number, size: number, maxChars: number, anchor: "start" | "middle") {
  const lines = wrap(name.toUpperCase(), maxChars);
  const lh = size * 1.22;
  const y0 = yBottom - (lines.length - 1) * lh;
  return lines.map((l, i) =>
    `<text x="${x}" y="${(y0 + i * lh).toFixed(0)}" ${FONT} font-weight="800" font-size="${size}" fill="#fff" text-anchor="${anchor}" letter-spacing="1" filter="url(#sh)">${esc(l)}</text>`,
  ).join("");
}

const defs = (c1: string, c2: string, angle: "v" | "d") => `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="${angle === "v" ? 0 : 1}" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.75"/>
    </linearGradient>
    <filter id="sh" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.6"/></filter>
  </defs>`;

export async function posterPng(name: string, year: number, colors: [string, string]): Promise<Buffer> {
  const [w, h] = [600, 900];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${defs(colors[0], colors[1], "v")}
    <rect width="100%" height="100%" fill="url(#g)"/>${shapes(name, w, h, "#fff")}
    <rect width="100%" height="100%" fill="url(#fade)"/>
    ${titleBlock(name, w / 2, h - 120, 58, 14, "middle")}
    <text x="${w / 2}" y="${h - 50}" ${FONT} font-size="26" fill="#ffffffcc" text-anchor="middle" letter-spacing="6">${year}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function backdropPng(name: string, tagline: string | undefined, colors: [string, string]): Promise<Buffer> {
  const [w, h] = [1920, 1080];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${defs(colors[0], colors[1], "d")}
    <rect width="100%" height="100%" fill="url(#g)"/>${shapes(`${name}-bd`, w, h, "#fff", 10)}
    <rect width="100%" height="100%" fill="url(#fade)"/>
    ${tagline ? `<text x="${w - 90}" y="${h - 90}" ${FONT} font-size="34" font-style="italic" fill="#ffffffaa" text-anchor="end">${esc(tagline)}</text>` : ""}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function logoPng(name: string, accent: string): Promise<Buffer> {
  const lines = wrap(name.toUpperCase(), 14);
  const longest = Math.max(...lines.map((l) => l.length));
  const w = 800;
  // chữ hoa DejaVu Bold ~0.78em/ký tự
  const size = Math.min(96, Math.floor((w * 0.94) / (longest * 0.78)));
  const lh = size * 1.25;
  const h = Math.round(lines.length * lh + size * 0.45);
  const text = lines.map((l, i) =>
    `<text x="${w / 2}" y="${(size * 1.15 + i * lh).toFixed(0)}" ${FONT} font-weight="900" font-size="${size}" fill="#fff" stroke="${accent}" stroke-width="2" text-anchor="middle" letter-spacing="2" filter="url(#sh)">${esc(l)}</text>`,
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><filter id="sh" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity="0.7"/></filter></defs>
    ${text}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
