import type { PrismaClient } from "@app/db";
import {
  encryptMediaKey,
  generateHlsKey,
  HLS_KEY_URI_PLACEHOLDER,
  mediaLayout,
  type TranscodeJobData,
} from "@app/shared/media";
import { UnrecoverableError } from "bullmq";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { extname, join, relative, sep } from "node:path";
import type { WorkerEnv } from "../env.js";
import { ffmpegPath, ProcessError, progressLineHandler, runProcess } from "../lib/ffmpeg.js";
import { errMessage, type Logger } from "../lib/log.js";
import { mapPool } from "../lib/pool.js";
import {
  assertTranscodable,
  displaySize,
  ffprobe,
  type FfprobeResult,
  isHdrStream,
  ProbeError,
  summarizeProbe,
} from "../lib/probe.js";
import { keyInScope } from "../lib/scope.js";
import { type Bucket, deleteKeys, downloadToFile, listAllObjects, uploadFile } from "../lib/s3.js";
import {
  buildMasterPlaylist,
  buildPosterArgs,
  buildThumbFrameArgs,
  buildTranscodeArgs,
  keyInfoFile,
  type MasterVariant,
  outputFrameRate,
  parseMediaPlaylist,
  renditionCodecs,
  variantBandwidth,
} from "./hls.js";
import { selectRenditions } from "./renditions.js";
import { probeFields } from "./source-files.js";
import { buildSubtitleArgs, languageLabel, normalizeLanguage, planSubtitles, type SubtitlePlan } from "./subtitles.js";
import { buildThumbsVtt, composeSprites, planThumbs, thumbCues } from "./thumbs.js";

export interface TranscodeContext {
  prisma: PrismaClient;
  source: Bucket;
  media: Bucket;
  env: WorkerEnv;
  log: Logger;
  signal: AbortSignal;
  /** 1-based attempt number. */
  attempt: number;
  queueJobId?: string;
}

/** Thrown with the ffmpeg stderr tail so the caller can store it in TranscodeJob.log. */
export class TranscodeError extends Error {
  constructor(
    message: string,
    readonly logTail: string[] = [],
  ) {
    super(message);
    this.name = "TranscodeError";
  }
}

/** Stage → [start%, end%] of overall progress. */
const STAGES = {
  preparing: [0, 2],
  downloading: [2, 8],
  probing: [8, 9],
  transcoding: [9, 85],
  thumbnails: [85, 88],
  subtitles: [88, 90],
  uploading: [90, 99],
  finalizing: [99, 100],
} as const;
type Stage = keyof typeof STAGES;

class ProgressReporter {
  private lastWrite = 0;
  private lastValue = -1;
  private stage: Stage = "preparing";
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private prisma: PrismaClient,
    private jobId: string,
    private onProgress?: (pct: number) => void,
  ) {}
  setStage(stage: Stage) {
    this.stage = stage;
    this.report(0, true);
  }
  /** fraction 0..1 within the current stage */
  report(fraction: number, force = false) {
    const [a, b] = STAGES[this.stage];
    const pct = Math.min(100, Math.max(0, Math.floor(a + (b - a) * Math.min(1, Math.max(0, fraction)))));
    const now = Date.now();
    if (!force && (now - this.lastWrite < 2000 || pct === this.lastValue)) return;
    this.lastWrite = now;
    this.lastValue = pct;
    this.onProgress?.(pct);
    const stage = this.stage;
    this.pending = this.pending
      .then(() => this.prisma.transcodeJob.update({ where: { id: this.jobId }, data: { progress: pct, stage } }))
      .catch(() => {});
  }
  flush() {
    return this.pending;
  }
}

/** Default audio track: disposition.default, else the first audio stream. */
export function pickAudioStream(p: FfprobeResult) {
  const audio = (p.streams ?? []).filter((s) => s.codec_type === "audio" && (s.channels ?? 1) > 0);
  return audio.find((s) => s.disposition?.default) ?? audio[0];
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p)));
    else out.push(p);
  }
  return out;
}

export interface TranscodeResult {
  durationSec: number;
  renditions: { name: string; width: number; height: number; videoKbps: number; bandwidth: number }[];
  objects: number;
  bytes: number;
  subtitles: number;
  timings: Record<string, number>;
}

export async function runTranscode(ctx: TranscodeContext, data: TranscodeJobData, onProgress?: (pct: number) => void): Promise<TranscodeResult> {
  const { prisma, log, signal } = ctx;
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const mark = (name: string, since: number) => (timings[name] = Math.round((Date.now() - since) / 100) / 10);

  const job = await prisma.transcodeJob.findUnique({ where: { id: data.transcodeJobId } });
  if (!job) throw new UnrecoverableError(`TranscodeJob ${data.transcodeJobId} not found`);
  if (job.assetId !== data.assetId) throw new UnrecoverableError(`TranscodeJob ${job.id} belongs to asset ${job.assetId}, not ${data.assetId}`);
  const asset = await prisma.mediaAsset.findUnique({ where: { id: data.assetId }, include: { sourceFile: true } });
  if (!asset) throw new UnrecoverableError(`MediaAsset ${data.assetId} not found`);
  const src = asset.sourceFile;
  if (!src) throw new UnrecoverableError("asset has no source file attached");
  if (src.bucket !== ctx.source.name) throw new UnrecoverableError(`source bucket "${src.bucket}" is not the configured source bucket "${ctx.source.name}"`);
  if (!keyInScope(src.key, ctx.env.sourcePrefix)) {
    throw new UnrecoverableError(`source key "${src.key}" is outside SOURCE_S3_PREFIX "${ctx.env.sourcePrefix}" — refusing to read it`);
  }

  await prisma.$transaction([
    prisma.transcodeJob.update({
      where: { id: job.id },
      data: { status: "RUNNING", progress: 0, stage: "preparing", attempt: ctx.attempt, startedAt: new Date(), finishedAt: null, error: null, log: null, queueJobId: ctx.queueJobId ?? job.queueJobId },
    }),
    prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: "PROCESSING", errorMessage: null } }),
  ]);
  const progress = new ProgressReporter(prisma, job.id, onProgress);

  await mkdir(ctx.env.workDir, { recursive: true });
  const work = await mkdtemp(join(ctx.env.workDir, `${workDirPrefix()}${asset.id}-`));
  const outDir = join(work, "out");
  const secretDir = join(work, "secret"); // key material: local only, never uploaded
  try {
    await mkdir(outDir);
    await mkdir(secretDir, { mode: 0o700 });

    // ── download ──
    progress.setStage("downloading");
    let t = Date.now();
    const input = join(work, `source${extname(src.key).toLowerCase() || ".bin"}`);
    const size = await downloadToFile(ctx.source, src.key, input, signal);
    mark("download", t);
    log.info("downloaded source", { asset: asset.id, key: src.key, mb: +(size / 1048576).toFixed(1), s: timings.download });

    // ── probe the local copy (authoritative; also fills/refreshes the SourceFile row) ──
    progress.setStage("probing");
    let probe: FfprobeResult;
    let summary;
    try {
      probe = await ffprobe(input, { signal });
      summary = summarizeProbe(probe, src.key);
      assertTranscodable(probe, summary);
    } catch (err) {
      if (err instanceof ProbeError) {
        await prisma.sourceFile.update({
          where: { id: src.id },
          data: { probeStatus: "FAILED", probeError: err.message.slice(0, 1000), probedAt: new Date() },
        });
        throw new UnrecoverableError(`source is not a usable video: ${err.message}`);
      }
      throw err;
    }
    await prisma.sourceFile.update({ where: { id: src.id }, data: { ...probeFields(summary, probe), probeStatus: "OK", probeError: null } });

    const video = assertTranscodable(probe, summary);
    const disp = displaySize(video)!;
    const hdr = isHdrStream(video);
    const srcFps = summary.frameRate;
    const fps = outputFrameRate(srcFps);
    const duration = summary.durationSec!;
    const renditions = selectRenditions(disp.width, disp.height, fps);
    const audio = pickAudioStream(probe);
    const hasAudio = !!audio;
    log.info("plan", {
      asset: asset.id,
      source: `${disp.width}x${disp.height}@${srcFps ?? "?"} ${summary.videoCodec}${hdr ? " HDR" : ""}`,
      duration: +duration.toFixed(2),
      renditions: renditions.map((r) => `${r.name}:${r.width}x${r.height}@${r.videoKbps}k`).join(","),
      audio: audio ? `#${audio.index} ${audio.codec_name} ${audio.channels}ch` : "none",
    });

    // ── key material ──
    const { key, ivHex } = generateHlsKey();
    const keyPath = join(secretDir, "enc.key");
    const keyInfoPath = join(secretDir, "enc.keyinfo");
    await writeFile(keyPath, key, { mode: 0o600 });
    await writeFile(keyInfoPath, keyInfoFile(HLS_KEY_URI_PLACEHOLDER, keyPath, ivHex), { mode: 0o600 });
    await chmod(keyPath, 0o600);

    // ── transcode (one ffmpeg run, all renditions) ──
    progress.setStage("transcoding");
    t = Date.now();
    for (const r of renditions) await mkdir(join(outDir, r.name));
    const args = buildTranscodeArgs({
      input,
      outDir,
      keyInfoPath,
      renditions,
      videoStreamIndex: video.index,
      audioStreamIndex: audio ? audio.index : null,
      sourceFrameRate: srcFps,
      hdr,
      preset: ctx.env.x264Preset,
      threads: ctx.env.ffmpegThreads || undefined,
    });
    try {
      await runProcess(ffmpegPath(), args, {
        signal,
        onStdoutLine: progressLineHandler((sec) => progress.report(sec / duration)),
        tailLines: 30,
      });
    } catch (err) {
      if (err instanceof ProcessError) {
        const hint =
          /SIGSEGV/.test(err.message) && !process.env.FFMPEG_PATH
            ? " (the bundled static ffmpeg 7.0.2 crashes on some inputs, e.g. MPEG-TS sources; set FFMPEG_PATH to a system ffmpeg)"
            : "";
        throw new TranscodeError(`ffmpeg transcode failed: ${err.message}${hint}`, err.stderrTail);
      }
      throw err;
    }
    mark("transcode", t);
    log.info("ffmpeg done", { asset: asset.id, s: timings.transcode, speed: +(duration / timings.transcode!).toFixed(2) + "x" });

    // ── variant stats + master ──
    const variants: MasterVariant[] = [];
    let outDuration = 0;
    for (const r of renditions) {
      const dir = join(outDir, r.name);
      const pl = await readFile(join(dir, "index.m3u8"), "utf8");
      if (!pl.includes(`URI="${HLS_KEY_URI_PLACEHOLDER}"`) || !pl.includes(`IV=0x${ivHex}`)) {
        throw new TranscodeError(`variant ${r.name} playlist is missing the expected EXT-X-KEY`);
      }
      const segs = parseMediaPlaylist(pl);
      if (!segs.length) throw new TranscodeError(`variant ${r.name} has no segments`);
      const sizes = new Map<string, number>();
      for (const s of segs) sizes.set(s.uri, (await stat(join(dir, s.uri))).size);
      const bw = variantBandwidth(segs, (u) => sizes.get(u) ?? 0);
      outDuration = Math.max(outDuration, bw.duration);
      variants.push({ rendition: r, bandwidth: bw.peak, averageBandwidth: bw.average });
    }
    await writeFile(join(outDir, "master.m3u8"), buildMasterPlaylist(variants, { frameRate: fps, hasAudio }));

    // ── thumbnails: sprites + VTT + poster ──
    progress.setStage("thumbnails");
    t = Date.now();
    const thumbsDir = join(outDir, "thumbs");
    const framesDir = join(work, "thumb-frames"); // not under outDir → never uploaded
    await mkdir(thumbsDir);
    await mkdir(framesDir);
    const thumbsPlan = planThumbs(disp.width, disp.height);
    try {
      await runProcess(
        ffmpegPath(),
        buildThumbFrameArgs({ input, framesDir, videoStreamIndex: video.index, hdr, thumbs: thumbsPlan, keyframesOnly: duration > 600, threads: ctx.env.ffmpegThreads || undefined }),
        { signal },
      );
    } catch (err) {
      if (err instanceof ProcessError) throw new TranscodeError(`ffmpeg thumbnail pass failed: ${err.message}`, err.stderrTail);
      throw err;
    }
    const frames = (await readdir(framesDir)).filter((f) => f.endsWith(".jpg")).sort().map((f) => join(framesDir, f));
    if (!frames.length) throw new TranscodeError("thumbnail pass produced no frames");
    await composeSprites(frames, thumbsPlan, thumbsDir);
    await writeFile(join(thumbsDir, "thumbs.vtt"), buildThumbsVtt(thumbCues(duration, thumbsPlan, frames.length)));
    const top = renditions.at(-1)!;
    const posterPath = join(outDir, "poster.jpg");
    try {
      await runProcess(
        ffmpegPath(),
        buildPosterArgs({ input, output: posterPath, videoStreamIndex: video.index, hdr, atSec: Math.min(duration * 0.1, Math.max(0, duration - 1)), width: top.width, height: top.height }),
        { signal },
      );
    } catch (err) {
      if (err instanceof ProcessError) throw new TranscodeError(`ffmpeg poster failed: ${err.message}`, err.stderrTail);
      throw err;
    }
    mark("thumbnails", t);

    // ── subtitles (text only; failures are non-fatal) ──
    progress.setStage("subtitles");
    t = Date.now();
    const { extract: subPlans, skipped } = planSubtitles(probe);
    if (skipped.length) log.warn("skipping bitmap subtitles", { asset: asset.id, streams: skipped.map((s) => `#${s.index}:${s.codec_name}`).join(",") });
    const subsDir = join(outDir, "subs");
    const subsDone: SubtitlePlan[] = [];
    if (subPlans.length) {
      await mkdir(subsDir);
      try {
        await runProcess(ffmpegPath(), buildSubtitleArgs(input, subsDir, subPlans), { signal });
        subsDone.push(...subPlans);
      } catch {
        // retry one by one to isolate the broken track(s)
        for (const p of subPlans) {
          try {
            await runProcess(ffmpegPath(), buildSubtitleArgs(input, subsDir, [p]), { signal });
            subsDone.push(p);
          } catch (err) {
            log.warn("subtitle extraction failed", { asset: asset.id, stream: p.streamIndex, err: errMessage(err) });
            await rm(join(subsDir, p.fileName), { force: true });
          }
        }
      }
    }
    mark("subtitles", t);

    // ── upload: segments/images first, variant playlists next, master last ──
    progress.setStage("uploading");
    t = Date.now();
    const prefix = mediaLayout.assetPrefix(asset.id);
    const files = (await listFiles(outDir)).map((abs) => ({ abs, key: `${prefix}/${relative(outDir, abs).split(sep).join("/")}` }));
    const rank = (k: string) => (k.endsWith("/master.m3u8") ? 2 : k.endsWith(".m3u8") ? 1 : 0);
    files.sort((a, b) => rank(a.key) - rank(b.key));
    let uploadedBytes = 0;
    let done = 0;
    for (const tier of [0, 1, 2]) {
      await mapPool(
        files.filter((f) => rank(f.key) === tier),
        ctx.env.uploadConcurrency,
        async (f) => {
          if (signal.aborted) throw new Error("aborted");
          uploadedBytes += await uploadFile(ctx.media, f.abs, f.key, { cacheControl: f.key.endsWith(".m3u8") ? "no-cache" : "public, max-age=86400" });
          progress.report(++done / files.length);
        },
      );
    }
    // remove leftovers from a previous run of this asset (e.g. a rendition that no longer exists)
    const keep = new Set(files.map((f) => f.key));
    const stale: string[] = [];
    for await (const o of listAllObjects(ctx.media, `${prefix}/`)) if (!keep.has(o.Key!)) stale.push(o.Key!);
    if (stale.length) await deleteKeys(ctx.media, stale);
    mark("upload", t);
    log.info("uploaded", { asset: asset.id, objects: files.length, mb: +(uploadedBytes / 1048576).toFixed(1), staleRemoved: stale.length, s: timings.upload });

    // ── finalize (single transaction) ──
    progress.setStage("finalizing");
    const enc = encryptMediaKey(key, ctx.env.mediaKeySecret);
    key.fill(0);
    const lang = normalizeLanguage(audio?.tags?.language);
    await progress.flush();
    await prisma.$transaction([
      prisma.rendition.deleteMany({ where: { assetId: asset.id } }),
      prisma.subtitleTrack.deleteMany({ where: { assetId: asset.id } }),
      prisma.audioTrack.deleteMany({ where: { assetId: asset.id } }),
      prisma.rendition.createMany({
        data: renditions.map((r) => ({
          assetId: asset.id,
          name: r.name,
          width: r.width,
          height: r.height,
          videoKbps: r.videoKbps,
          audioKbps: hasAudio ? r.audioKbps : 0,
          codecs: renditionCodecs(r, hasAudio),
          playlistKey: mediaLayout.renditionPlaylist(asset.id, r.name),
        })),
      }),
      prisma.subtitleTrack.createMany({
        data: subsDone.map((s) => ({
          assetId: asset.id,
          language: s.language,
          label: s.label,
          key: `${prefix}/subs/${s.fileName}`,
          isDefault: s.isDefault,
          isForced: s.isForced,
        })),
      }),
      prisma.audioTrack.createMany({
        data: hasAudio ? [{ assetId: asset.id, language: lang, label: audio.tags?.title?.trim() || languageLabel(lang), channels: 2, playlistKey: null, isDefault: true }] : [],
      }),
      prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: "READY",
          readyAt: new Date(),
          errorMessage: null,
          durationSec: Math.round((outDuration || duration) * 1000) / 1000,
          outputPrefix: prefix,
          encKeyCipher: new Uint8Array(enc.encKeyCipher),
          encKeyIv: new Uint8Array(enc.encKeyIv),
          encKeyTag: new Uint8Array(enc.encKeyTag),
          hlsIv: ivHex,
          thumbsVttKey: mediaLayout.thumbsVtt(asset.id),
          posterFrameKey: mediaLayout.posterFrame(asset.id),
        },
      }),
      prisma.transcodeJob.update({
        where: { id: job.id },
        data: { status: "SUCCEEDED", progress: 100, stage: "done", finishedAt: new Date(), error: null },
      }),
    ]);
    onProgress?.(100);
    timings.total = Math.round((Date.now() - t0) / 100) / 10;
    return {
      durationSec: outDuration || duration,
      renditions: variants.map((v) => ({ name: v.rendition.name, width: v.rendition.width, height: v.rendition.height, videoKbps: v.rendition.videoKbps, bandwidth: v.bandwidth })),
      objects: files.length,
      bytes: uploadedBytes,
      subtitles: subsDone.length,
      timings,
    };
  } finally {
    await rm(work, { recursive: true, force: true }).catch((err) => log.warn("failed to clean work dir", { work, err: errMessage(err) }));
  }
}

/** `job-<host>-<pid>-`: lets a restarted worker tell its dead predecessors' dirs from live siblings' dirs. */
function workDirPrefix(pid = process.pid) {
  return `job-${hostname().replace(/[^a-zA-Z0-9]/g, "")}-${pid}-`;
}

/** Removes work dirs left behind by crashed workers on this host (dirs of live processes are kept). */
export async function cleanStaleWorkDirs(workDir: string, log: Logger) {
  let entries: string[] = [];
  try {
    entries = await readdir(workDir);
  } catch {
    return;
  }
  const host = hostname().replace(/[^a-zA-Z0-9]/g, "");
  for (const e of entries) {
    const m = /^job-([a-zA-Z0-9]*)-(\d+)-/.exec(e);
    if (!m || m[1] !== host) continue;
    const pid = Number(m[2]);
    let alive = pid === process.pid;
    if (!alive) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch (err) {
        alive = (err as NodeJS.ErrnoException).code === "EPERM";
      }
    }
    if (alive) continue;
    await rm(join(workDir, e), { recursive: true, force: true });
    log.warn("removed stale work dir", { dir: e });
  }
}
