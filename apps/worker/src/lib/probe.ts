import { extname } from "node:path";
import { ffprobePath, ProcessError, runProcess } from "./ffmpeg.js";

/** Subset of ffprobe's JSON we rely on (everything else is kept verbatim in `probeData`). */
export interface FfprobeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  sample_aspect_ratio?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  color_transfer?: string;
  color_primaries?: string;
  color_space?: string;
  bits_per_raw_sample?: string;
  channels?: number;
  duration?: string;
  bit_rate?: string;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
  side_data_list?: Array<Record<string, unknown>>;
}
export interface FfprobeResult {
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
  error?: { code: number; string: string };
}

export interface AudioTrackInfo {
  index: number;
  codec: string;
  language: string | null;
  channels: number | null;
}
export interface SubtitleTrackInfo {
  index: number;
  codec: string;
  language: string | null;
}
export interface ProbeSummary {
  container: string | null;
  durationSec: number | null;
  videoCodec: string | null;
  /** Display dimensions (sample aspect ratio + rotation applied). */
  width: number | null;
  height: number | null;
  frameRate: number | null;
  bitrateKbps: number | null;
  isHdr: boolean;
  audioTracks: AudioTrackInfo[];
  subtitleTracks: SubtitleTrackInfo[];
}

export class ProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProbeError";
  }
}

/** Runs ffprobe on a local path or (presigned) URL. Throws ProbeError with a readable message. */
export async function ffprobe(input: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<FfprobeResult> {
  const isUrl = /^https?:\/\//.test(input);
  const args = [
    "-v", "error",
    "-hide_banner",
    ...(isUrl ? ["-rw_timeout", "30000000"] : []),
    "-probesize", "50M",
    "-analyzeduration", "20M",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    "-show_error",
    input,
  ];
  let stdout: string;
  try {
    ({ stdout } = await runProcess(ffprobePath(), args, { captureStdout: true, signal: opts.signal, timeoutMs: opts.timeoutMs ?? 120_000 }));
  } catch (err) {
    if (err instanceof ProcessError) {
      // ffprobe prints {"error":...} JSON on stdout too, but stderr is usually more precise
      const detail = cleanFfmpegMessage(err.stderrTail.filter((l) => !/^\s*$/.test(l)).slice(-3).join(" | "), input);
      throw new ProbeError(`ffprobe failed: ${detail || cleanFfmpegMessage(err.message, input)}`);
    }
    throw err;
  }
  let json: FfprobeResult;
  try {
    json = JSON.parse(stdout) as FfprobeResult;
  } catch {
    throw new ProbeError("ffprobe returned invalid JSON");
  }
  if (json.error) throw new ProbeError(`ffprobe: ${json.error.string}`);
  return json;
}

/** Makes ffmpeg/ffprobe messages readable: drops `[demuxer @ 0x…]` prefixes and the input URL/path. */
export function cleanFfmpegMessage(msg: string, input?: string): string {
  let m = msg.replace(/\[[^\]]+ @ 0x[0-9a-f]+\]\s*/g, "");
  if (input) m = m.split(`${input}: `).join("").split(input).join("<input>");
  return redactUrl(m).trim();
}

/** Strips query strings (presigned signatures) from messages. */
export function redactUrl(s: string): string {
  return s.replace(/(https?:\/\/[^\s?]+)\?[^\s]*/g, "$1?…");
}

export function parseRational(r: string | undefined): number | null {
  if (!r) return null;
  const [a, b] = r.split("/").map(Number);
  if (a === undefined || !Number.isFinite(a)) return null;
  if (b === undefined) return a;
  if (!b || !Number.isFinite(b)) return null;
  const v = a / b;
  return v > 0 ? v : null;
}

/** Rotation in degrees (0/90/180/270) from the display matrix side data or the legacy `rotate` tag. */
export function streamRotation(s: FfprobeStream): number {
  let rot = 0;
  const tag = s.tags?.rotate;
  if (tag && Number.isFinite(Number(tag))) rot = Number(tag);
  for (const sd of s.side_data_list ?? []) {
    if (typeof sd.rotation === "number") rot = sd.rotation;
  }
  return ((Math.round(rot / 90) * 90) % 360 + 360) % 360;
}

/** First "real" video stream (skips cover art / attached pictures). */
export function primaryVideoStream(p: FfprobeResult): FfprobeStream | undefined {
  return p.streams?.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic && (s.width ?? 0) > 0);
}

/** Display size: applies non-square SAR (to width) and 90/270 rotation (swap). */
export function displaySize(s: FfprobeStream): { width: number; height: number } | null {
  if (!s.width || !s.height) return null;
  let w = s.width;
  const h = s.height;
  const sar = parseRational(s.sample_aspect_ratio?.replace(":", "/"));
  if (sar && Math.abs(sar - 1) > 0.01) w = Math.round(w * sar);
  const rot = streamRotation(s);
  return rot === 90 || rot === 270 ? { width: h, height: w } : { width: w, height: h };
}

const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);
export function isHdrStream(s: FfprobeStream): boolean {
  return HDR_TRANSFERS.has(s.color_transfer ?? "");
}
/** True if the stream is >8-bit (needs a pixel-format conversion for H.264 High profile). */
export function isHighBitDepth(s: FfprobeStream): boolean {
  if (s.pix_fmt && /(p10|p12|p16|10le|12le|10be|12be)/.test(s.pix_fmt)) return true;
  return Number(s.bits_per_raw_sample ?? 8) > 8;
}

/** Normalized container name: mp4 / mov / mkv / webm / avi / mpegts / … (ffprobe reports families). */
export function normalizeContainer(formatName: string | undefined, key: string, brand?: string): string | null {
  if (!formatName) return null;
  const ext = extname(key).toLowerCase().replace(".", "");
  if (formatName.includes("mov,mp4")) {
    if (brand?.trim() === "qt" || ext === "mov") return "mov";
    if (ext === "m4v") return "m4v";
    return "mp4";
  }
  if (formatName.includes("matroska")) return ext === "webm" ? "webm" : "mkv";
  if (formatName === "mpegts") return ext === "m2ts" || ext === "mts" ? "m2ts" : "mpegts";
  if (formatName === "asf") return "wmv";
  return formatName.split(",")[0] ?? formatName;
}

function lang(tags?: Record<string, string>): string | null {
  const l = tags?.language?.trim();
  return l && l !== "und" ? l : null;
}

export function summarizeProbe(p: FfprobeResult, key: string): ProbeSummary {
  const v = primaryVideoStream(p);
  const size = v ? displaySize(v) : null;
  const streams = p.streams ?? [];
  const fmtDur = Number(p.format?.duration);
  const vDur = Number(v?.duration);
  const durationSec = Number.isFinite(fmtDur) && fmtDur > 0 ? fmtDur : Number.isFinite(vDur) && vDur > 0 ? vDur : null;
  const br = Number(p.format?.bit_rate);
  let bitrateKbps = Number.isFinite(br) && br > 0 ? Math.round(br / 1000) : null;
  if (bitrateKbps === null && durationSec && p.format?.size) {
    bitrateKbps = Math.round((Number(p.format.size) * 8) / durationSec / 1000) || null;
  }
  const fr = v ? (parseRational(v.avg_frame_rate) ?? parseRational(v.r_frame_rate)) : null;
  return {
    container: normalizeContainer(p.format?.format_name, key, p.format?.tags?.major_brand),
    durationSec,
    videoCodec: v?.codec_name ?? null,
    width: size?.width ?? null,
    height: size?.height ?? null,
    frameRate: fr !== null && fr < 1000 ? Math.round(fr * 1000) / 1000 : null,
    bitrateKbps,
    isHdr: v ? isHdrStream(v) : false,
    audioTracks: streams
      .filter((s) => s.codec_type === "audio")
      .map((s) => ({ index: s.index, codec: s.codec_name ?? "unknown", language: lang(s.tags), channels: s.channels ?? null })),
    subtitleTracks: streams
      .filter((s) => s.codec_type === "subtitle")
      .map((s) => ({ index: s.index, codec: s.codec_name ?? "unknown", language: lang(s.tags) })),
  };
}

/** Throws ProbeError when the file is not something we can transcode. */
export function assertTranscodable(p: FfprobeResult, s: ProbeSummary): FfprobeStream {
  const v = primaryVideoStream(p);
  if (!v) throw new ProbeError("no video stream found");
  if (!s.width || !s.height) throw new ProbeError("video stream has no dimensions");
  if (!s.durationSec || s.durationSec < 0.5) throw new ProbeError("could not determine a usable duration");
  return v;
}
