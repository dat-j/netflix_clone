import { RENDITION_LADDER } from "@app/shared/media";

export interface LadderRung {
  readonly name: string;
  readonly height: number;
  readonly videoKbps: number;
  readonly audioKbps: number;
}

export interface RenditionPlan {
  name: string;
  width: number;
  height: number;
  videoKbps: number;
  audioKbps: number;
  /** H.264 level as an integer ×10 (e.g. 31 = 3.1). */
  level: number;
}

const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));
const floorEven = (n: number) => Math.max(2, 2 * Math.floor(n / 2));
/** A source a few lines short of a rung (e.g. 1912x1072, 1280x714) still gets that rung (never upscaled though). */
const TOLERANCE = 1.05;

/**
 * Picks ladder rungs for a source of the given DISPLAY size.
 * Each rung is a 16:9 bounding box (`height` = short side, so portrait video uses a 9:16 box); the source is scaled
 * to fit inside the box preserving aspect ratio. A rung is kept only if that does not upscale (within TOLERANCE).
 * The lowest rung is always produced (at source size if the source is smaller than it). Dimensions are even.
 */
export function selectRenditions(srcW: number, srcH: number, frameRate = 30, ladder: readonly LadderRung[] = RENDITION_LADDER): RenditionPlan[] {
  if (!(srcW > 0 && srcH > 0)) throw new Error(`invalid source size ${srcW}x${srcH}`);
  const portrait = srcH > srcW;
  const sorted = [...ladder].sort((a, b) => a.height - b.height);
  const out: RenditionPlan[] = [];
  for (const [i, rung] of sorted.entries()) {
    const boxLong = Math.round((rung.height * 16) / 9);
    const boxW = portrait ? rung.height : boxLong;
    const boxH = portrait ? boxLong : rung.height;
    const fit = Math.min(boxW / srcW, boxH / srcH);
    if (fit > TOLERANCE && i > 0) continue; // would upscale; the lowest rung is always kept
    const scale = Math.min(fit, 1);
    const width = Math.min(even(srcW * scale), floorEven(srcW));
    const height = Math.min(even(srcH * scale), floorEven(srcH));
    if (out.some((r) => r.width === width && r.height === height)) continue;
    // Fewer pixels than the box (letterboxed / small source) → proportionally lower bitrate (floor 50%).
    const pixelRatio = Math.min(1, (width * height) / (boxW * boxH));
    const fpsBoost = frameRate > 40 ? 1.5 : 1;
    const videoKbps = Math.round(rung.videoKbps * Math.max(0.5, pixelRatio) * fpsBoost);
    out.push({ name: rung.name, width, height, videoKbps, audioKbps: rung.audioKbps, level: h264Level(width, height, frameRate, videoKbps) });
  }
  // `fit > TOLERANCE` skips can only drop higher rungs, so `out` is ascending and starts with the lowest rung.
  return out;
}

// H.264 Annex A limits: [level, MaxFS (macroblocks/frame), MaxMBPS (macroblocks/s), MaxBR (kbps, High profile = ×1.25 Baseline)]
const LEVELS: Array<[number, number, number, number]> = [
  [30, 1620, 40500, 10000],
  [31, 3600, 108000, 14000],
  [32, 5120, 216000, 20000],
  [40, 8192, 245760, 20000],
  [41, 8192, 245760, 50000],
  [42, 8704, 522240, 50000],
  [50, 22080, 589824, 135000],
  [51, 36864, 983040, 240000],
  [52, 36864, 2073600, 240000],
];
/** Smallest H.264 level (×10) that fits the frame size, macroblock rate and (peak) bitrate. */
export function h264Level(width: number, height: number, fps: number, videoKbps: number): number {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const mbps = mbs * Math.max(1, fps);
  const peakKbps = videoKbps * 1.1; // maxrate
  for (const [level, maxFs, maxMbps, maxBr] of LEVELS) {
    if (mbs <= maxFs && mbps <= maxMbps && peakKbps <= maxBr * 1.25) return level;
  }
  return 52;
}

/** RFC 6381 codec string for H.264 High profile at the given level, e.g. `avc1.64001f`. */
export function avcCodecString(level: number): string {
  return `avc1.6400${level.toString(16).padStart(2, "0")}`;
}
export const AAC_LC_CODEC = "mp4a.40.2";
