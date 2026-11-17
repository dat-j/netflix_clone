/**
 * Server-side artwork for the bot (sharp/libvips). Every screen is a single JPEG photo so navigation can always use
 * editMessageMedia on the same message. Text is rendered with Pango (fontconfig) — the Docker image installs
 * fonts-dejavu-core, which covers Vietnamese.
 */
import sharp from "sharp";

type OverlayOptions = import("sharp").OverlayOptions;

export const BRAND = "#ff5a3c";
const BRAND_2 = "#ff8a5c";
const BG = "#141414";
const FONT = "DejaVu Sans";
const JPEG = { quality: 84, mozjpeg: true, chromaSubsampling: "4:4:4" } as const;

// ───────── text ─────────

function escMarkup(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface TextOpts {
  size: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  maxWidth: number;
  maxLines?: number;
  align?: "left" | "centre" | "right";
  letterSpacing?: number;
}

export interface RenderedText { buf: Buffer; width: number; height: number }

const STRUT = "Ẫ|"; // tallest accent stack + full descender: gives every single-line render the same height/baseline
const strutWidths = new Map<string, Promise<number>>();

function pangoFont(o: TextOpts) {
  return `${FONT}${o.bold ? " Bold" : ""}${o.italic ? " Italic" : ""} ${o.size}`;
}

async function rawText(markup: string, o: TextOpts, width: number) {
  return sharp({ text: { text: markup, font: pangoFont(o), width, wrap: "word-char", align: o.align ?? "left", rgba: true, dpi: 72 } })
    .png()
    .toBuffer({ resolveWithObject: true });
}

/**
 * libvips trims rendered text to its ink box, so "Phim lẻ" and "2025" would come out with different heights and
 * baselines. Single-line text is therefore rendered after an invisible strut glyph run that spans the full
 * accent-to-descender range, and the strut is cropped off again.
 */
async function renderPango(text: string, o: TextOpts): Promise<RenderedText> {
  const ls = o.letterSpacing ? ` letter_spacing="${Math.round(o.letterSpacing * 1024)}"` : "";
  const body = `<span foreground="${o.color ?? "#ffffff"}"${ls}>${escMarkup(text)}</span>`;
  const single = (o.maxLines ?? 1) === 1 && (o.align ?? "left") === "left";
  if (!single) {
    const { data, info } = await rawText(body, o, o.maxWidth);
    return { buf: data, width: info.width, height: info.height };
  }
  const font = pangoFont(o);
  let sw = strutWidths.get(font);
  if (!sw) {
    sw = rawText(`<span alpha="1">${STRUT}</span>`, o, 4000).then((r) => r.info.width);
    strutWidths.set(font, sw);
  }
  const strutW = await sw;
  const { data, info } = await rawText(`<span alpha="1">${STRUT}</span>${body}`, o, o.maxWidth + strutW);
  const width = Math.max(1, info.width - strutW);
  const buf = await sharp(data).extract({ left: Math.min(strutW, info.width - 1), top: 0, width, height: info.height }).png().toBuffer();
  return { buf, width, height: info.height };
}

/** Renders text wrapped to maxWidth; if it needs more than maxLines, shortens on word boundaries and adds "…". */
export async function text(s: string, o: TextOpts): Promise<RenderedText> {
  const maxLines = o.maxLines ?? 1;
  const lineH = o.size * 1.25;
  const limit = lineH * maxLines + o.size * 0.4;
  let candidate = s.trim();
  let out = await renderPango(candidate, o);
  if (out.height <= limit) return out;
  const words = candidate.split(/\s+/);
  // drop whole words first, then characters for a single very long word
  while (words.length > 1) {
    words.pop();
    candidate = `${words.join(" ").replace(/[,.;:–-]+$/, "")}…`;
    out = await renderPango(candidate, o);
    if (out.height <= limit) return out;
  }
  let w = words[0] ?? "";
  while (w.length > 1) {
    w = w.slice(0, -1);
    out = await renderPango(`${w}…`, o);
    if (out.height <= limit) return out;
  }
  return out;
}

// ───────── primitives ─────────

function svg(w: number, h: number, body: string): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
}

function roundedMask(w: number, h: number, r: number): Buffer {
  return svg(w, h, `<rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/>`);
}

/** Cover-crops an image into w×h with rounded corners (PNG with alpha). */
async function roundedCover(input: Buffer, w: number, h: number, r: number, position: string = "centre"): Promise<Buffer> {
  return sharp(input)
    .resize(w, h, { fit: "cover", position })
    .composite([{ input: roundedMask(w, h, r), blend: "dest-in" }])
    .png()
    .toBuffer();
}

function shadow(w: number, h: number, r: number, blur = 18, opacity = 0.6): Buffer {
  const pad = blur * 2;
  return svg(w + pad * 2, h + pad * 2,
    `<defs><filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${blur / 2}"/></filter></defs>` +
    `<rect x="${pad}" y="${pad + blur / 3}" width="${w}" height="${h}" rx="${r}" fill="#000" fill-opacity="${opacity}" filter="url(#s)"/>`);
}

/** The BoxPhim app icon (same artwork as apps/web/src/app/icon.svg). */
function brandIcon(size: number): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BRAND_2}"/><stop offset="1" stop-color="#ff3d2e"/></linearGradient></defs>
  <rect width="64" height="64" rx="14" fill="#1d1d1d"/>
  <path d="M20 14h9v27h16v9H20z" fill="url(#g)"/>
  <path d="M33 22l14 8-14 8z" fill="#fff"/></svg>`);
}

/** Icon + "BoxPhim" wordmark as one transparent PNG. */
export async function brandMark(height: number): Promise<RenderedText> {
  const word = await text("BoxPhim", { size: Math.round(height * 0.62), bold: true, maxWidth: height * 8 });
  const gap = Math.round(height * 0.28);
  const width = height + gap + word.width;
  const buf = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: brandIcon(height), left: 0, top: 0 },
      { input: word.buf, left: height + gap, top: Math.max(0, Math.round((height - word.height) / 2)) },
    ])
    .png()
    .toBuffer();
  return { buf, width, height };
}

/** Rounded "chip" with text. */
async function chip(label: string, o: { size: number; fg?: string; bg?: string; border?: string; bold?: boolean }): Promise<RenderedText> {
  const t = await text(label, { size: o.size, bold: o.bold ?? true, color: o.fg ?? "#fff", maxWidth: 800 });
  const padX = Math.round(o.size * 0.6);
  const padY = Math.round(o.size * 0.32);
  const w = t.width + padX * 2;
  const h = t.height + padY * 2;
  const r = Math.round(h / 2.6);
  const bg = svg(w, h,
    `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${r}" fill="${o.bg ?? "rgba(255,255,255,0.14)"}"` +
    (o.border ? ` stroke="${o.border}" stroke-width="2"` : "") + "/>");
  const buf = await sharp(bg).composite([{ input: t.buf, left: padX, top: padY }]).png().toBuffer();
  return { buf, width: w, height: h };
}

/** Lays chips out left→right with a gap, returning composite ops. */
async function chipRow(labels: { label: string; style: "plain" | "brand" | "outline" | "ok" }[], x: number, y: number, size: number, maxW: number) {
  const ops: OverlayOptions[] = [];
  let cx = x;
  for (const l of labels) {
    const c = await chip(l.label, {
      size,
      bg: l.style === "brand" ? BRAND : l.style === "ok" ? "rgba(70,211,105,0.18)" : l.style === "outline" ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.14)",
      border: l.style === "outline" ? "rgba(255,255,255,0.55)" : l.style === "ok" ? "#46d369" : undefined,
      fg: l.style === "ok" ? "#7dff9f" : "#fff",
    });
    if (cx + c.width > x + maxW) break;
    ops.push({ input: c.buf, left: cx, top: y });
    cx += c.width + Math.round(size * 0.5);
  }
  return ops;
}

// ───────── placeholder artwork ─────────

/** Branded stand-in when a title has no poster/backdrop. */
export async function placeholderArt(name: string, w: number, h: number, withText = true): Promise<Buffer> {
  const icon = Math.round(Math.min(w, h) * 0.22);
  const bg = svg(w, h,
    `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a2320"/><stop offset="0.55" stop-color="#1c1c1c"/><stop offset="1" stop-color="#101010"/></linearGradient>` +
    `<radialGradient id="r" cx="0.25" cy="0.15" r="0.8"><stop offset="0" stop-color="${BRAND}" stop-opacity="0.35"/><stop offset="1" stop-color="${BRAND}" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#b)"/><rect width="${w}" height="${h}" fill="url(#r)"/>`);
  if (!withText) return sharp(bg).png().toBuffer();
  const t = await text(name.toUpperCase(), { size: Math.round(Math.min(w, h * 0.66) * 0.085), bold: true, maxWidth: Math.round(w * 0.82), maxLines: 3, align: "centre" });
  const iconTop = Math.round(h * 0.5 - icon - t.height / 2);
  return sharp(bg)
    .composite([
      { input: brandIcon(icon), left: Math.round((w - icon) / 2), top: Math.max(8, iconTop) },
      { input: t.buf, left: Math.round((w - t.width) / 2), top: Math.max(8, iconTop) + icon + Math.round(h * 0.04) },
    ])
    .png()
    .toBuffer();
}

// ───────── screens ─────────

export interface GridItem {
  number: number;
  name: string;
  meta: string;
  poster: Buffer | null;
  badge?: string | null;
}

/**
 * 2×2 poster grid for list screens (one photo per page). 1080 px wide; Telegram downsizes to ≤1280 on the long side,
 * so text sizes here are chosen to stay legible at ~0.68× on a phone.
 */
export async function renderGrid(opts: { heading: string; pageLabel: string; items: GridItem[] }): Promise<Buffer> {
  const W = 1080, M = 36, GAP = 28;
  const HEADER = 116;
  const cellW = Math.floor((W - M * 2 - GAP) / 2);
  const posterH = Math.round(cellW * 1.5);
  const TEXT_H = 104;
  const rowH = posterH + TEXT_H;
  // a partial last page with ≤2 titles collapses to one row instead of showing two empty slots
  const rows = opts.items.length <= 2 ? 1 : 2;
  const H = HEADER + rowH * rows + GAP * (rows - 1) + M - 8;

  const bg = svg(W, H,
    `<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e1e1e"/><stop offset="1" stop-color="${BG}"/></linearGradient>` +
    `<radialGradient id="r" cx="0.0" cy="0.0" r="0.6"><stop offset="0" stop-color="${BRAND}" stop-opacity="0.22"/><stop offset="1" stop-color="${BRAND}" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#b)"/><rect width="${W}" height="${H}" fill="url(#r)"/>` +
    `<rect x="${M}" y="${HEADER - 18}" width="${W - M * 2}" height="2" fill="#ffffff" fill-opacity="0.08"/>`);

  const ops: OverlayOptions[] = [];
  const mark = await brandMark(54);
  ops.push({ input: mark.buf, left: M, top: 26 });
  const page = await chip(opts.pageLabel, { size: 26, bg: "rgba(255,255,255,0.10)" });
  ops.push({ input: page.buf, left: W - M - page.width, top: Math.round(53 - page.height / 2) });
  const headW = W - M * 2 - mark.width - page.width - 48;
  const head = await text(opts.heading, { size: 34, bold: true, maxWidth: headW, color: "#e8e8e8" });
  ops.push({ input: head.buf, left: W - M - page.width - 24 - head.width, top: Math.round(53 - head.height / 2) });

  for (let i = 0; i < rows * 2; i++) {
    const it = opts.items[i];
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + col * (cellW + GAP);
    const y = HEADER + row * (rowH + GAP);
    if (!it) {
      // empty slot on a partial last page: faint outline keeps the grid rhythm
      ops.push({ input: svg(cellW, posterH, `<rect x="2" y="2" width="${cellW - 4}" height="${posterH - 4}" rx="22" fill="none" stroke="#fff" stroke-opacity="0.06" stroke-width="3" stroke-dasharray="14 12"/>`), left: x, top: y });
      continue;
    }
    const art = it.poster ?? (await placeholderArt(it.name, cellW, posterH));
    const sh = shadow(cellW, posterH, 22);
    ops.push({ input: sh, left: x - 36, top: y - 36 });
    ops.push({ input: await roundedCover(art, cellW, posterH, 22, "attention"), left: x, top: y });
    // bottom scrim so badges read on bright posters
    ops.push({ input: svg(cellW, posterH,
      `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0.72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></linearGradient></defs>` +
      `<rect width="${cellW}" height="${posterH}" rx="22" fill="url(#s)"/>`), left: x, top: y });
    // number badge
    const nb = 78;
    const num = await text(String(it.number), { size: 44, bold: true, maxWidth: nb });
    const badge = await sharp(svg(nb, nb,
      `<rect width="${nb}" height="${nb}" rx="20" fill="${BRAND}"/><rect x="0.5" y="0.5" width="${nb - 1}" height="${nb - 1}" rx="20" fill="none" stroke="#fff" stroke-opacity="0.35"/>`))
      .composite([{ input: num.buf, left: Math.round((nb - num.width) / 2), top: Math.round((nb - num.height) / 2) }])
      .png().toBuffer();
    ops.push({ input: badge, left: x + 16, top: y + 16 });
    if (it.badge) {
      const b = await chip(it.badge, { size: 22, bg: "rgba(0,0,0,0.6)", border: "rgba(255,255,255,0.5)" });
      ops.push({ input: b.buf, left: x + cellW - b.width - 16, top: y + posterH - b.height - 16 });
    }
    const name = await text(it.name, { size: 32, bold: true, maxWidth: cellW - 8, maxLines: 1 });
    ops.push({ input: name.buf, left: x + 4, top: y + posterH + 18 });
    const meta = await text(it.meta, { size: 25, maxWidth: cellW - 8, color: "#a8a8a8" });
    ops.push({ input: meta.buf, left: x + 4, top: y + posterH + 18 + name.height + 8 });
  }
  return sharp(bg).composite(ops).flatten({ background: BG }).jpeg(JPEG).toBuffer();
}

export interface DetailArt {
  name: string;
  backdrop: Buffer | null;
  poster: Buffer | null;
  logo: Buffer | null;
  chips: string[];
  flags: { label: string; style: "brand" | "ok" | "outline" }[];
  tagline?: string | null;
}

/** 1280×720 detail card: blurred-edge backdrop, poster inset, title logo (or name), meta chips. */
export async function renderDetail(d: DetailArt): Promise<Buffer> {
  const W = 1280, H = 720;
  const base = d.backdrop
    ? await sharp(d.backdrop).resize(W, H, { fit: "cover", position: "attention" }).modulate({ brightness: 0.9 }).toBuffer()
    : d.poster
      ? await sharp(d.poster).resize(W, H, { fit: "cover" }).blur(40).modulate({ brightness: 0.6 }).toBuffer()
      : await placeholderArt(d.name, W, H, false);
  const scrim = svg(W, H,
    `<defs><linearGradient id="l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0b0b0b" stop-opacity="0.96"/><stop offset="0.5" stop-color="#0b0b0b" stop-opacity="0.78"/><stop offset="1" stop-color="#0b0b0b" stop-opacity="0.15"/></linearGradient>` +
    `<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0.6" stop-color="${BG}" stop-opacity="0"/><stop offset="1" stop-color="${BG}" stop-opacity="0.9"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#l)"/><rect width="${W}" height="${H}" fill="url(#b)"/>`);
  const ops: OverlayOptions[] = [{ input: scrim, left: 0, top: 0 }];

  const PX = 64, PY = 72, PW = 384, PH = 576;
  const poster = d.poster ?? (await placeholderArt(d.name, PW, PH));
  ops.push({ input: shadow(PW, PH, 20, 28, 0.8), left: PX - 56, top: PY - 56 });
  ops.push({ input: await roundedCover(poster, PW, PH, 20), left: PX, top: PY });

  const RX = PX + PW + 56;
  const RW = W - RX - 56;
  const mark = await brandMark(40);
  ops.push({ input: mark.buf, left: W - 56 - mark.width, top: 40 });

  // right column: build blocks first, then centre them vertically against the poster
  const blocks: { buf: Buffer; height: number; gap: number }[] = [];
  if (d.logo) {
    const logo = await sharp(d.logo).trim({ threshold: 1 }).resize(RW, 200, { fit: "inside", withoutEnlargement: false }).png().toBuffer({ resolveWithObject: true });
    blocks.push({ buf: logo.data, height: logo.info.height, gap: 34 });
  } else {
    const t = await text(d.name, { size: 58, bold: true, maxWidth: RW, maxLines: 3 });
    blocks.push({ buf: t.buf, height: t.height, gap: 30 });
  }
  if (d.tagline) {
    const tg = await text(d.tagline, { size: 28, italic: true, color: "#d6d6d6", maxWidth: RW, maxLines: 2 });
    blocks.push({ buf: tg.buf, height: tg.height, gap: 30 });
  }
  const CHIP_ROW = 52;
  const total = blocks.reduce((n, b) => n + b.height + b.gap, 0) + CHIP_ROW * 2 + 18;
  let y = Math.max(96, Math.round(PY + PH / 2 - total / 2));
  for (const b of blocks) {
    ops.push({ input: b.buf, left: RX, top: y });
    y += b.height + b.gap;
  }
  ops.push(...(await chipRow(d.chips.map((label) => ({ label, style: "plain" as const })), RX, y, 26, RW)));
  y += CHIP_ROW + 18;
  ops.push(...(await chipRow(d.flags, RX, y, 26, RW)));

  return sharp(base).composite(ops).flatten({ background: BG }).jpeg(JPEG).toBuffer();
}

/** 1280×720 banner for /start, help, genre menu and empty states. */
export async function renderBanner(o: { title: string; subtitle: string; backdrop?: Buffer | null; featuredLogo?: Buffer | null; featuredLabel?: string }): Promise<Buffer> {
  const W = 1280, H = 720;
  const base = o.backdrop
    ? await sharp(o.backdrop).resize(W, H, { fit: "cover", position: "attention" }).toBuffer()
    : await sharp(svg(W, H,
      `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b1712"/><stop offset="0.6" stop-color="#161616"/><stop offset="1" stop-color="#0e0e0e"/></linearGradient>` +
      `<radialGradient id="r" cx="0.9" cy="0.1" r="0.7"><stop offset="0" stop-color="${BRAND}" stop-opacity="0.35"/><stop offset="1" stop-color="${BRAND}" stop-opacity="0"/></radialGradient></defs>` +
      `<rect width="${W}" height="${H}" fill="url(#b)"/><rect width="${W}" height="${H}" fill="url(#r)"/>` +
      // oversized, faint brand glyph balances the empty right half when there is no backdrop
      `<g transform="translate(860 150) scale(7)" opacity="0.16"><path d="M20 14h9v27h16v9H20z" fill="${BRAND}"/><path d="M33 22l14 8-14 8z" fill="#fff"/></g>`)).png().toBuffer();
  const scrim = svg(W, H,
    `<defs><linearGradient id="l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0b0b0b" stop-opacity="0.95"/><stop offset="0.55" stop-color="#0b0b0b" stop-opacity="0.6"/><stop offset="1" stop-color="#0b0b0b" stop-opacity="0.05"/></linearGradient>` +
    `<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="${BG}" stop-opacity="0"/><stop offset="1" stop-color="${BG}" stop-opacity="0.95"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#l)"/><rect width="${W}" height="${H}" fill="url(#b)"/>` +
    `<rect x="72" y="408" width="96" height="8" rx="4" fill="${BRAND}"/>`);
  const ops: OverlayOptions[] = [{ input: scrim, left: 0, top: 0 }];
  const mark = await brandMark(96);
  ops.push({ input: mark.buf, left: 72, top: 72 });
  const title = await text(o.title, { size: 64, bold: true, maxWidth: 880, maxLines: 2 });
  ops.push({ input: title.buf, left: 72, top: 400 - title.height - 24 });
  const sub = await text(o.subtitle, { size: 30, color: "#cfcfcf", maxWidth: 720, maxLines: 3 });
  ops.push({ input: sub.buf, left: 72, top: 446 });
  if (o.featuredLogo) {
    const logo = await sharp(o.featuredLogo).trim({ threshold: 1 }).resize(420, 140, { fit: "inside" }).png().toBuffer({ resolveWithObject: true });
    const lx = W - 72 - logo.info.width, ly = H - 72 - logo.info.height;
    ops.push({ input: logo.data, left: lx, top: ly });
    if (o.featuredLabel) {
      const c = await chip(o.featuredLabel, { size: 22, bg: BRAND });
      ops.push({ input: c.buf, left: W - 72 - c.width, top: ly - c.height - 16 });
    }
  }
  return sharp(base).composite(ops).flatten({ background: BG }).jpeg(JPEG).toBuffer();
}

/** Small square-ish JPEG thumbnail for inline-mode results (from poster). */
export async function renderThumb(poster: Buffer | null, name: string): Promise<Buffer> {
  const art = poster ?? (await placeholderArt(name, 200, 300));
  return sharp(art).resize(200, 300, { fit: "cover" }).jpeg({ quality: 80 }).toBuffer();
}
