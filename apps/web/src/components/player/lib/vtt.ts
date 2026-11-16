/**
 * Minimal WebVTT parsing for (1) thumbnail sprite tracks and (2) subtitle cues.
 * Pure functions — no DOM — so they are unit-testable and safe to run anywhere.
 */

export interface ThumbnailCue {
  start: number;
  end: number;
  /** Absolute sprite image URL (resolved against the VTT URL) */
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextCue {
  start: number;
  end: number;
  text: string;
}

/** "01:02:03.456" | "02:03.456" | "02:03,456" → seconds. Returns NaN when malformed. */
export function parseTimestamp(raw: string): number {
  const m = raw.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!m) return NaN;
  const [, h, min, s, ms] = m;
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s) + (ms ? Number(ms.padEnd(3, "0")) / 1000 : 0);
}

interface RawCue {
  start: number;
  end: number;
  payload: string[];
}

function parseCues(text: string): RawCue[] {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const cues: RawCue[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const arrow = line.indexOf("-->");
    if (arrow === -1) {
      i++;
      continue;
    }
    const start = parseTimestamp(line.slice(0, arrow));
    // End timestamp may be followed by cue settings ("line:90% align:center")
    const end = parseTimestamp(line.slice(arrow + 3).trim().split(/\s+/)[0] ?? "");
    i++;
    const payload: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      payload.push(lines[i]);
      i++;
    }
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) cues.push({ start, end, payload });
  }
  return cues;
}

function resolveUrl(ref: string, base: string): string {
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
}

/** Parse a thumbnail VTT whose payloads look like `sprite_001.jpg#xywh=0,0,160,90`. */
export function parseThumbnailVtt(text: string, vttUrl: string): ThumbnailCue[] {
  const out: ThumbnailCue[] = [];
  for (const cue of parseCues(text)) {
    const ref = cue.payload.join("").trim();
    if (!ref) continue;
    const hash = ref.indexOf("#xywh=");
    const file = hash === -1 ? ref : ref.slice(0, hash);
    let x = 0, y = 0, w = 0, h = 0;
    if (hash !== -1) {
      const nums = ref.slice(hash + 6).split(",").map(Number);
      if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) continue;
      [x, y, w, h] = nums;
    }
    out.push({ start: cue.start, end: cue.end, url: resolveUrl(file, vttUrl), x, y, w, h });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Binary search for the cue covering `time` (falls back to the nearest previous cue). */
export function findCueAt<T extends { start: number; end: number }>(cues: readonly T[], time: number): T | null {
  if (!cues.length || !Number.isFinite(time)) return null;
  let lo = 0;
  let hi = cues.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= time) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (best === -1) return cues[0];
  return cues[best];
}

/** Cues active at `time` (subtitles may overlap). */
export function activeCues(cues: readonly TextCue[], time: number): TextCue[] {
  return cues.filter((c) => c.start <= time && time < c.end);
}

/** Parse a subtitle VTT/SRT-ish file into plain text cues (tags stripped, line breaks kept). */
export function parseSubtitleVtt(text: string): TextCue[] {
  return parseCues(text)
    .map((c) => ({
      start: c.start,
      end: c.end,
      text: c.payload
        .join("\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .trim(),
    }))
    .filter((c) => c.text)
    .sort((a, b) => a.start - b.start);
}
