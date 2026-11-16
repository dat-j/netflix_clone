/**
 * Generates short synthetic test videos with ffmpeg lavfi sources, uploads them to the source bucket under
 * `samples/` and triggers a scan. Each clip has a burned-in running timecode + frame number (rendered with
 * libass, since this ffmpeg build has no drawtext) so player work can verify seeking.
 *
 *   pnpm --filter @app/worker seed:samples [--only 1,3] [--no-scan] [--prefix samples/] [--duration-scale 1]
 */
import "../env.js";
import { type ProbeJobData, QUEUE_PROBE } from "@app/shared/media";
import { Queue } from "bullmq";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { env } from "../env.js";
import { closeContext, redisConnection, sourceBucket } from "../lib/context.js";
import { ffmpegPath, runProcess } from "../lib/ffmpeg.js";
import { logger } from "../lib/log.js";
import { uploadFile } from "../lib/s3.js";
import { assertLocalForWrites, resolveListPrefix } from "../lib/scope.js";

const log = logger("seed");

interface Sample {
  file: string;
  title: string;
  width: number;
  height: number;
  fps: string;
  duration: number;
  /** lavfi video source (size/rate/duration appended by us) */
  video: (s: Sample) => string;
  /** extra inputs (audio sources, subtitle files) and encoding args */
  build: (s: Sample, dir: string) => Promise<{ inputs: string[]; args: string[] }>;
}

const fpsNum = (fps: string) => (fps.includes("/") ? Number(fps.split("/")[0]) / Number(fps.split("/")[1]) : Number(fps));

function assTime(sec: number) {
  const cs = Math.floor(sec * 100 + 1e-6);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}
function hms(sec: number) {
  const ms = Math.round(sec * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

/** One ASS event per frame (start = floor to centiseconds, so each frame shows its own number). */
function timecodeAss(s: Sample): string {
  const fps = fpsNum(s.fps);
  const frames = Math.round(s.duration * fps);
  const size = Math.round(s.height / 16);
  const head = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${s.width}`,
    `PlayResY: ${s.height}`,
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: TC,DejaVu Sans Mono,${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&HA0000000,1,0,0,0,100,100,0,0,3,${Math.max(2, size / 8)},0,7,${size / 2},${size / 2},${size / 2},1`,
    `Style: Title,DejaVu Sans,${Math.round(size * 0.7)},&H0000FFFF,&H00FFFFFF,&H00000000,&HA0000000,1,0,0,0,100,100,0,0,3,${Math.max(2, size / 10)},0,3,${size / 2},${size / 2},${size / 2},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,${assTime(0)},${assTime(s.duration + 1)},Title,,0,0,0,,${s.title}`,
  ];
  const ev: string[] = [];
  for (let n = 0; n < frames; n++) {
    const t = n / fps;
    ev.push(`Dialogue: 1,${assTime(t)},${assTime((n + 1) / fps)},TC,,0,0,0,,${hms(t)}\\Nframe ${String(n).padStart(5, "0")}`);
  }
  return [...head, ...ev, ""].join("\n");
}

function srt(cues: Array<[number, number, string]>) {
  const t = (x: number) => hms(x).replace(".", ",");
  return cues.map(([a, b, txt], i) => `${i + 1}\n${t(a)} --> ${t(b)}\n${txt}\n`).join("\n");
}

const SAMPLES: Sample[] = [
  {
    file: "sample-1080p-h264.mp4",
    title: "Sample 1 · 1080p H.264/AAC MP4",
    width: 1920, height: 1080, fps: "30", duration: 48,
    video: (s) => `testsrc2=s=${s.width}x${s.height}:r=${s.fps}`,
    build: async (s) => ({
      inputs: ["-f", "lavfi", "-i", `sine=f=440:sample_rate=48000:beep_factor=4:d=${s.duration}`],
      args: ["-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-metadata:s:a:0", "language=eng", "-movflags", "+faststart"],
    }),
  },
  {
    file: "sample-720p-hevc-2audio-subs.mkv",
    title: "Sample 2 · 720p HEVC MKV · 2 audio · 2 subs",
    width: 1280, height: 720, fps: "25", duration: 52,
    video: (s) => `life=s=${s.width}x${s.height}:r=${s.fps}:mold=10:ratio=0.1:death_color=#202060:life_color=#40ff80`,
    build: async (s, dir) => {
      const en = join(dir, "s2.en.srt");
      const vi = join(dir, "s2.vi.srt");
      const cues = (lang: "en" | "vi") =>
        Array.from({ length: Math.floor(s.duration / 5) }, (_, i): [number, number, string] => [i * 5 + 0.5, i * 5 + 4, lang === "en" ? `English subtitle #${i + 1} (t=${i * 5 + 0.5}s)` : `Phụ đề tiếng Việt số ${i + 1} (t=${i * 5 + 0.5}s)`]);
      await writeFile(en, srt(cues("en")));
      await writeFile(vi, srt(cues("vi")));
      return {
        inputs: [
          "-f", "lavfi", "-i", `sine=f=330:sample_rate=48000:d=${s.duration}`,
          "-f", "lavfi", "-i", `sine=f=550:sample_rate=48000:beep_factor=2:d=${s.duration}`,
          "-i", en, "-i", vi,
        ],
        args: ["-map", "[v]", "-map", "1:a", "-map", "2:a", "-map", "3:s", "-map", "4:s",
          "-c:v", "libx265", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p", "-x265-params", "log-level=error",
          "-c:a:0", "aac", "-b:a:0", "128k", "-ac:a:0", "2",
          "-c:a:1", "ac3", "-b:a:1", "384k", "-ac:a:1", "6",
          "-c:s:0", "srt", "-c:s:1", "ass",
          "-metadata:s:a:0", "language=eng", "-metadata:s:a:0", "title=English Stereo",
          "-metadata:s:a:1", "language=vie", "-metadata:s:a:1", "title=Tiếng Việt 5.1",
          "-metadata:s:s:0", "language=eng", "-metadata:s:s:1", "language=vie",
          "-disposition:a:0", "default", "-disposition:a:1", "0", "-disposition:s:0", "0", "-disposition:s:1", "0"],
      };
    },
  },
  {
    file: "sample-480p-4x3.mov",
    title: "Sample 3 · 480p 4:3 MPEG-4 Part 2 MOV · 29.97",
    width: 640, height: 480, fps: "30000/1001", duration: 44,
    video: (s) => `testsrc=s=${s.width}x${s.height}:r=${s.fps}`,
    build: async (s) => ({
      inputs: ["-f", "lavfi", "-i", `sine=f=880:sample_rate=44100:d=${s.duration}`],
      args: ["-map", "[v]", "-map", "1:a", "-c:v", "mpeg4", "-q:v", "4", "-pix_fmt", "yuv420p",
        "-c:a", "pcm_s16le", "-ac", "1", "-metadata:s:a:0", "language=fre"],
    }),
  },
  {
    file: "sample-1440p-vp9-hdr10.webm",
    title: "Sample 4 · 1440p VP9 10-bit HDR10 (PQ) WebM",
    width: 2560, height: 1440, fps: "24", duration: 40,
    video: (s) => `gradients=s=${s.width}x${s.height}:r=${s.fps}:speed=0.03:n=4:type=spiral`,
    build: async (s) => ({
      inputs: ["-f", "lavfi", "-i", `sine=f=220:sample_rate=48000:beep_factor=3:d=${s.duration}`],
      args: ["-map", "[v]", "-map", "1:a",
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p10le", "-profile:v", "2", "-deadline", "realtime", "-cpu-used", "8",
        "-row-mt", "1", "-b:v", "3M", "-g", "96",
        "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc", "-color_range", "tv",
        "-c:a", "libopus", "-b:a", "96k", "-metadata:s:a:0", "language=jpn"],
    }),
  },
];

async function generate(s: Sample, dir: string, fontsDir: string | null): Promise<string> {
  const out = join(dir, s.file);
  const assPath = join(dir, `${s.file}.ass`);
  let burn = "";
  if (fontsDir) {
    await writeFile(assPath, timecodeAss(s));
    burn = `,subtitles=filename=${assPath}:fontsdir=${fontsDir}`;
  }
  const { inputs, args } = await s.build(s, dir);
  const full = [
    "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `${s.video(s)},trim=duration=${s.duration}`,
    ...inputs,
    "-filter_complex", `[0:v]format=yuv420p${burn}[v]`,
    ...args,
    "-t", String(s.duration),
    out,
  ];
  await runProcess(ffmpegPath(), full, { tailLines: 20 });
  return out;
}

async function main() {
  const { values } = parseArgs({
    options: {
      only: { type: "string" },
      prefix: { type: "string", default: "samples/" },
      "no-scan": { type: "boolean", default: false },
      "keep-local": { type: "boolean", default: false },
    },
  });
  // never write synthetic files into a real (shared) bucket
  assertLocalForWrites(env().source.endpoint, "seed:samples");
  const prefix = resolveListPrefix(values.prefix!, env().sourcePrefix).replace(/\/?$/, "/");
  const only = values.only ? new Set(values.only.split(",").map(Number)) : null;
  const fontsDir = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu", "/usr/share/fonts/TTF"].find((d) => existsSync(d)) ?? null;
  if (!fontsDir) log.warn("DejaVu fonts not found — timecode overlay disabled (testsrc patterns still show counters)");

  const base = join(env().workDir || tmpdir());
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, "seed-"));
  const bucket = sourceBucket();
  try {
    for (const [i, s] of SAMPLES.entries()) {
      if (only && !only.has(i + 1)) continue;
      const t = Date.now();
      const path = await generate(s, dir, fontsDir);
      const size = (await stat(path)).size;
      const key = `${prefix}${s.file}`;
      await uploadFile(bucket, path, key);
      log.info("sample uploaded", { key, mb: +(size / 1048576).toFixed(2), genSeconds: (Date.now() - t) / 1000 });
    }
  } finally {
    if (!values["keep-local"]) await rm(dir, { recursive: true, force: true });
    else log.info("kept local files", { dir });
  }
  if (!values["no-scan"]) {
    const q = new Queue<ProbeJobData>(QUEUE_PROBE, { connection: redisConnection() });
    await q.add("scan", { type: "scan", prefix }, { removeOnComplete: true, removeOnFail: 100 });
    await q.close();
    log.info("scan job enqueued (a running worker will upsert SourceFile rows and probe them)", { prefix });
  }
  await closeContext();
}

main().catch(async (err) => {
  log.error("seed failed", { err: err instanceof Error ? err.message : String(err) });
  await closeContext();
  process.exit(1);
});
