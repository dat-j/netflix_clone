import sharp from "sharp";
import { join } from "node:path";
import type { ThumbsPlan } from "./hls.js";

export const THUMB_INTERVAL_SEC = 10;
export const THUMB_WIDTH = 160;
export const THUMB_COLS = 10;
export const THUMB_ROWS = 10;

/** Tile size for a source of the given display size (160 px wide, even height, aspect preserved). */
export function planThumbs(displayW: number, displayH: number, intervalSec = THUMB_INTERVAL_SEC): ThumbsPlan {
  const tileHeight = Math.max(2, 2 * Math.round((THUMB_WIDTH * displayH) / displayW / 2));
  return { intervalSec, tileWidth: THUMB_WIDTH, tileHeight, cols: THUMB_COLS, rows: THUMB_ROWS };
}

/** Number of thumbnails the `fps=1/interval` branch emits for a given duration (frames at t = 0, i, 2i, …). */
export function thumbCount(durationSec: number, intervalSec: number): number {
  return Math.max(1, Math.ceil(durationSec / intervalSec));
}

export function spriteFileName(n: number): string {
  return `sprite_${String(n).padStart(3, "0")}.jpg`;
}

export interface ThumbCue {
  start: number;
  end: number;
  sprite: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Cue i covers [i*interval, (i+1)*interval) and points at tile i of the sprite grid; the LAST cue always runs to the
 * end of the video (so no blank tile and no gap when ffmpeg emitted fewer frames than ceil(duration/interval)).
 */
export function thumbCues(durationSec: number, plan: ThumbsPlan, count = thumbCount(durationSec, plan.intervalSec)): ThumbCue[] {
  const perSheet = plan.cols * plan.rows;
  const cues: ThumbCue[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * plan.intervalSec;
    if (start >= durationSec) break;
    const end = i === count - 1 ? durationSec : Math.min((i + 1) * plan.intervalSec, durationSec);
    const sheet = Math.floor(i / perSheet);
    const pos = i % perSheet;
    cues.push({
      start,
      end,
      sprite: spriteFileName(sheet + 1),
      x: (pos % plan.cols) * plan.tileWidth,
      y: Math.floor(pos / plan.cols) * plan.tileHeight,
      w: plan.tileWidth,
      h: plan.tileHeight,
    });
  }
  return cues;
}

export function vttTimestamp(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const frac = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(frac).padStart(3, "0")}`;
}

/** thumbs.vtt; sprite references are relative to the VTT file (same directory). */
export function buildThumbsVtt(cues: ThumbCue[]): string {
  const out = ["WEBVTT", ""];
  for (const c of cues) {
    out.push(`${vttTimestamp(c.start)} --> ${vttTimestamp(c.end)}`, `${c.sprite}#xywh=${c.x},${c.y},${c.w},${c.h}`, "");
  }
  return out.join("\n");
}

/** How many sprite sheets the cues reference. */
export function spriteSheetCount(cues: ThumbCue[], plan: ThumbsPlan): number {
  return cues.length === 0 ? 0 : Math.ceil(cues.length / (plan.cols * plan.rows));
}

/**
 * Composes sprite sheets (cols×rows tiles, row-major) from individual thumbnail JPEGs, in order.
 * A partial last sheet is cropped to the rows it uses (cue coordinates are unaffected). Returns written file names.
 */
export async function composeSprites(frames: string[], plan: ThumbsPlan, outDir: string, quality = 70): Promise<string[]> {
  const perSheet = plan.cols * plan.rows;
  const written: string[] = [];
  for (let sheet = 0; sheet * perSheet < frames.length; sheet++) {
    const batch = frames.slice(sheet * perSheet, (sheet + 1) * perSheet);
    const rowsUsed = Math.ceil(batch.length / plan.cols);
    const tiles = await Promise.all(
      batch.map(async (f, i) => ({
        // frames are already tile-sized; `fit: fill` guards against off-by-one sizes from odd sources
        input: await sharp(f).resize(plan.tileWidth, plan.tileHeight, { fit: "fill" }).toBuffer(),
        left: (i % plan.cols) * plan.tileWidth,
        top: Math.floor(i / plan.cols) * plan.tileHeight,
      })),
    );
    const name = spriteFileName(sheet + 1);
    await sharp({
      create: {
        width: plan.cols * plan.tileWidth,
        height: rowsUsed * plan.tileHeight,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite(tiles)
      .jpeg({ quality, mozjpeg: false })
      .toFile(join(outDir, name));
    written.push(name);
  }
  return written;
}
