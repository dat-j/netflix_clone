import { HLS_SEGMENT_SECONDS, mediaLayout } from "@app/shared/media";
import { AAC_LC_CODEC, avcCodecString, type RenditionPlan } from "./renditions.js";

export interface ThumbsPlan {
  intervalSec: number;
  tileWidth: number;
  tileHeight: number;
  cols: number;
  rows: number;
}

export interface TranscodeArgsInput {
  input: string;
  /** Output root; variants go to `<outDir>/<name>/index.m3u8`. */
  outDir: string;
  keyInfoPath: string;
  renditions: RenditionPlan[];
  /** Absolute ffprobe stream index of the video stream. */
  videoStreamIndex: number;
  /** Absolute stream index of the audio track to keep (null = video only). */
  audioStreamIndex: number | null;
  sourceFrameRate: number | null;
  hdr: boolean;
  preset: string;
  threads?: number;
  segmentSeconds?: number;
}

/**
 * Filters applied once to the decoded source before the split: fps cap, HDR→SDR tone-map (or plain 8-bit 4:2:0
 * conversion). For HDR, `prescale` (the largest rendition) is applied first so the expensive float-RGB tone-mapping
 * runs at output size rather than source size (2560x1440 → 1920x1080 halves its cost).
 */
export function preFilterChain(opts: { hdr: boolean; sourceFrameRate: number | null; prescale?: { width: number; height: number } }): string[] {
  const f: string[] = [];
  if (opts.sourceFrameRate && opts.sourceFrameRate > 60.5) f.push(`fps=${Math.round((opts.sourceFrameRate / 2) * 1000) / 1000}`);
  if (opts.hdr) {
    if (opts.prescale) f.push(`scale=${opts.prescale.width}:${opts.prescale.height}:flags=bicubic`);
    // PQ/HLG → linear → BT.709 primaries → Hable tone-map → BT.709 limited range 8-bit
    f.push(
      "zscale=t=linear:npl=100",
      "format=gbrpf32le",
      "zscale=p=bt709",
      "tonemap=tonemap=hable:desat=0",
      "zscale=t=bt709:m=bt709:r=tv",
    );
  }
  f.push("format=yuv420p");
  return f;
}

/** Effective output frame rate after preFilterChain (used for GOP size and FRAME-RATE). */
export function outputFrameRate(sourceFrameRate: number | null): number {
  const fr = sourceFrameRate && sourceFrameRate > 0 ? sourceFrameRate : 30;
  return fr > 60.5 ? fr / 2 : fr;
}

/**
 * ONE ffmpeg run: decode once → split → N scaled H.264 renditions (+AAC from one audio track) muxed into encrypted
 * MPEG-TS HLS via var_stream_map.
 *
 * Sprite sheets are deliberately NOT a branch of this graph: a `tile=10x10` output emits one frame per ~1000 s of
 * content, and ffmpeg 7's scheduler keeps feeding the starved branch, buffering raw frames for every other branch
 * (measured: 4.6 GB RSS for a 25 s 1080p clip vs 0.7 GB without it). They get their own cheap pass instead.
 */
export function buildTranscodeArgs(o: TranscodeArgsInput): string[] {
  const seg = o.segmentSeconds ?? HLS_SEGMENT_SECONDS;
  const n = o.renditions.length;
  if (n === 0) throw new Error("no renditions");
  const fps = outputFrameRate(o.sourceFrameRate);
  const gop = Math.max(1, Math.round(fps * seg));

  const top = o.renditions.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  const pre = preFilterChain({ hdr: o.hdr, sourceFrameRate: o.sourceFrameRate, prescale: top });
  const splitLabels = o.renditions.map((_, i) => `[s${i}]`).join("");
  const graph = [
    `[0:${o.videoStreamIndex}]${pre.join(",")},split=${n}${splitLabels}`,
    ...o.renditions.map((r, i) => `[s${i}]scale=${r.width}:${r.height}:flags=bicubic,setsar=1[v${i}]`),
  ].join(";");

  const args: string[] = [
    "-hide_banner", "-nostdin", "-y",
    "-loglevel", "warning",
    "-progress", "pipe:1", "-nostats",
    "-i", o.input,
    "-filter_complex", graph,
  ];
  if (o.threads) args.push("-threads", String(o.threads));

  // ── output 1: HLS ──
  for (let i = 0; i < n; i++) {
    args.push("-map", `[v${i}]`);
    if (o.audioStreamIndex !== null) args.push("-map", `0:${o.audioStreamIndex}`);
  }
  args.push(
    "-c:v", "libx264",
    "-preset", o.preset,
    "-profile:v", "high",
    "-pix_fmt", "yuv420p",
    "-g", String(gop),
    "-keyint_min", String(gop),
    "-sc_threshold", "0",
    "-flags", "+cgop",
    "-force_key_frames", `expr:gte(t,n_forced*${seg})`,
    "-x264-params", `scenecut=0:open-gop=0:keyint=${gop}:min-keyint=${gop}`,
  );
  o.renditions.forEach((r, i) => {
    args.push(
      `-b:v:${i}`, `${r.videoKbps}k`,
      `-maxrate:v:${i}`, `${Math.round(r.videoKbps * 1.1)}k`,
      `-bufsize:v:${i}`, `${Math.round(r.videoKbps * 1.5)}k`,
      `-level:v:${i}`, (r.level / 10).toFixed(1),
    );
  });
  if (o.audioStreamIndex !== null) {
    args.push("-c:a", "aac", "-ac", "2", "-ar", "48000");
    o.renditions.forEach((r, i) => args.push(`-b:a:${i}`, `${r.audioKbps}k`));
  }
  const streamMap = o.renditions
    .map((r, i) => (o.audioStreamIndex !== null ? `v:${i},a:${i},name:${r.name}` : `v:${i},name:${r.name}`))
    .join(" ");
  args.push(
    "-f", "hls",
    "-hls_time", String(seg),
    "-hls_playlist_type", "vod",
    "-hls_flags", "independent_segments",
    "-hls_segment_type", "mpegts",
    "-hls_list_size", "0",
    "-hls_key_info_file", o.keyInfoPath,
    "-hls_segment_filename", `${o.outDir}/%v/${mediaLayout.segmentPattern}`,
    "-var_stream_map", streamMap,
    `${o.outDir}/%v/index.m3u8`,
  );
  return args;
}

/**
 * Thumbnail frames: one small JPEG every `intervalSec` (`thumb_00001.jpg`, …) into `framesDir`; sprite sheets are
 * composed from them in Node (thumbs.ts) so the cue count always equals the real number of frames — ffmpeg's
 * `fps=1/N` picks the frame just before each slot's midpoint, so the count is not simply ceil(duration/N).
 */
export function buildThumbFrameArgs(o: {
  input: string;
  framesDir: string;
  videoStreamIndex: number;
  hdr: boolean;
  thumbs: ThumbsPlan;
  /** Decode keyframes only (much faster on long sources; thumbnail lands on the nearest keyframe). */
  keyframesOnly: boolean;
  threads?: number;
}): string[] {
  const t = o.thumbs;
  const chain = [
    `fps=1/${t.intervalSec}`,
    `scale=${t.tileWidth}:${t.tileHeight}:flags=bicubic`,
    ...preFilterChain({ hdr: o.hdr, sourceFrameRate: null }),
    "setsar=1",
  ];
  return [
    "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
    ...(o.keyframesOnly ? ["-skip_frame", "nokey"] : []),
    ...(o.threads ? ["-threads", String(o.threads)] : []),
    "-i", o.input,
    "-map", `0:${o.videoStreamIndex}`,
    "-an", "-sn", "-dn",
    "-vf", chain.join(","),
    "-c:v", "mjpeg", "-q:v", "3",
    "-f", "image2", "-start_number", "1",
    `${o.framesDir}/thumb_%05d.jpg`,
  ];
}

/** Single poster frame at `atSec`, at the size of the top rendition. */
export function buildPosterArgs(o: { input: string; output: string; videoStreamIndex: number; hdr: boolean; atSec: number; width: number; height: number }): string[] {
  const chain = [...preFilterChain({ hdr: o.hdr, sourceFrameRate: null }), `scale=${o.width}:${o.height}:flags=bicubic`, "setsar=1"];
  return [
    "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
    "-ss", o.atSec.toFixed(3),
    "-i", o.input,
    "-map", `0:${o.videoStreamIndex}`,
    "-frames:v", "1",
    "-an", "-sn", "-dn",
    "-vf", chain.join(","),
    "-c:v", "mjpeg", "-q:v", "3",
    "-f", "image2", "-update", "1",
    o.output,
  ];
}

/** Contents of the file passed to `-hls_key_info_file`: key URI, local key path, IV (hex). */
export function keyInfoFile(keyUri: string, keyPath: string, ivHex: string): string {
  if (!/^[0-9a-f]{32}$/i.test(ivHex)) throw new Error("IV must be 16 bytes hex");
  return `${keyUri}\n${keyPath}\n${ivHex}\n`;
}

// ───────── variant stats + master playlist ─────────

export interface PlaylistSegment {
  uri: string;
  duration: number;
}
export function parseMediaPlaylist(text: string): PlaylistSegment[] {
  const segs: PlaylistSegment[] = [];
  let pending: number | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) pending = Number.parseFloat(line.slice(8));
    else if (line && !line.startsWith("#") && pending !== null) {
      segs.push({ uri: line, duration: pending });
      pending = null;
    }
  }
  return segs;
}

/** Peak (max per-segment) and average bitrate in bits/s, from segment durations and sizes. */
export function variantBandwidth(segments: PlaylistSegment[], sizeOf: (uri: string) => number): { peak: number; average: number; duration: number } {
  let bits = 0;
  let duration = 0;
  let peak = 0;
  for (const s of segments) {
    const b = sizeOf(s.uri) * 8;
    bits += b;
    duration += s.duration;
    // ignore tiny trailing segments for the peak (their rate is noisy)
    if (s.duration >= 0.5) peak = Math.max(peak, b / s.duration);
  }
  const average = duration > 0 ? bits / duration : 0;
  return { peak: Math.ceil(Math.max(peak, average)), average: Math.ceil(average), duration };
}

export interface MasterVariant {
  rendition: RenditionPlan;
  bandwidth: number;
  averageBandwidth: number;
}
export function buildMasterPlaylist(variants: MasterVariant[], opts: { frameRate: number; hasAudio: boolean }): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS"];
  const sorted = [...variants].sort((a, b) => a.bandwidth - b.bandwidth);
  for (const v of sorted) {
    const r = v.rendition;
    const codecs = [avcCodecString(r.level), ...(opts.hasAudio ? [AAC_LC_CODEC] : [])].join(",");
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},AVERAGE-BANDWIDTH=${v.averageBandwidth},` +
        `RESOLUTION=${r.width}x${r.height},CODECS="${codecs}",FRAME-RATE=${opts.frameRate.toFixed(3)}`,
      `${r.name}/index.m3u8`,
    );
  }
  return lines.join("\n") + "\n";
}

/** Codec string stored on Rendition rows. */
export function renditionCodecs(r: RenditionPlan, hasAudio: boolean): string {
  return [avcCodecString(r.level), ...(hasAudio ? [AAC_LC_CODEC] : [])].join(",");
}
