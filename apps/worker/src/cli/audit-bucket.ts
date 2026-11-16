/**
 * Phase-0 bucket audit: lists the source bucket, ffprobes every video (presigned URL, no download) with bounded
 * concurrency, upserts SourceFile rows, writes reports/bucket-audit-<timestamp>.csv and prints a summary.
 *
 *   pnpm audit:bucket [--prefix movies/] [--concurrency 8] [--limit 100] [--no-db] [--reprobe] [--all-bucket]
 *
 * SOURCE_S3_PREFIX is a hard boundary (--prefix is resolved inside it). On a non-local endpoint with no prefix at all
 * the audit refuses to run unless --all-bucket is given (the client's bucket is shared with other projects).
 *
 * With the DB enabled, unchanged files already probed OK are not probed again unless --reprobe is given.
 */
import { REPO_ROOT, env } from "../env.js";
import type { SourceFile } from "@app/db";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { closeContext, db, sourceBucket } from "../lib/context.js";
import { isVideoKey } from "../lib/extensions.js";
import { errMessage } from "../lib/log.js";
import { mapPool } from "../lib/pool.js";
import type { ProbeSummary } from "../lib/probe.js";
import { listAllObjects } from "../lib/s3.js";
import { assertBucketWideAllowed, keyInScope, resolveListPrefix } from "../lib/scope.js";
import { selectRenditions } from "../pipeline/renditions.js";
import { probeObject, saveProbeOutcome, scanBucket } from "../pipeline/source-files.js";

interface Row {
  key: string;
  size: number;
  lastModified: Date | null;
  status: "OK" | "FAILED";
  error: string | null;
  s: ProbeSummary | null;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const human = (bytes: number) => {
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 2 : 0)} ${u[i]}`;
};
const hours = (sec: number) => (sec >= 3600 ? `${(sec / 3600).toFixed(1)} h` : `${(sec / 60).toFixed(1)} min`);

/** Resolution class by the 16:9 box the frame fills (1920x800 scope → 1080p, portrait uses the short side). */
export function resolutionBucket(w: number | null, h: number | null): string {
  if (!w || !h) return "unknown";
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  const cls = Math.max(short, (long * 9) / 16);
  for (const [name, min] of [["4K+", 2160], ["1440p", 1440], ["1080p", 1080], ["720p", 720], ["480p", 480], ["360p", 360]] as const) {
    if (cls >= min * 0.95) return name;
  }
  return "<360p";
}

/** Estimated HLS output bytes: ladder bitrates × duration + ~6% MPEG-TS overhead. */
export function estimateOutputBytes(s: ProbeSummary | null): number {
  if (!s?.width || !s.height || !s.durationSec) return 0;
  const kbps = selectRenditions(s.width, s.height, s.frameRate ?? 30).reduce((a, r) => a + r.videoKbps + r.audioKbps, 0);
  return ((kbps * 1000) / 8) * s.durationSec * 1.06;
}

function tally(rows: Row[], keyOf: (r: Row) => string) {
  const m = new Map<string, { n: number; bytes: number; dur: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    const e = m.get(k) ?? { n: 0, bytes: 0, dur: 0 };
    e.n++;
    e.bytes += r.size;
    e.dur += r.s?.durationSec ?? 0;
    m.set(k, e);
  }
  return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
}
function printTable(title: string, rows: Row[], keyOf: (r: Row) => string) {
  console.log(`\n${title}`);
  for (const [k, e] of tally(rows, keyOf)) {
    console.log(`  ${k.padEnd(18)} ${String(e.n).padStart(6)} files  ${human(e.bytes).padStart(10)}  ${hours(e.dur).padStart(9)}`);
  }
}

function fromDb(sf: SourceFile): ProbeSummary {
  return {
    container: sf.container,
    durationSec: sf.durationSec,
    videoCodec: sf.videoCodec,
    width: sf.width,
    height: sf.height,
    frameRate: sf.frameRate,
    bitrateKbps: sf.bitrateKbps,
    isHdr: !!sf.isHdr,
    audioTracks: (sf.audioTracks as unknown as ProbeSummary["audioTracks"]) ?? [],
    subtitleTracks: (sf.subtitleTracks as unknown as ProbeSummary["subtitleTracks"]) ?? [],
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      prefix: { type: "string" },
      concurrency: { type: "string", default: "8" },
      limit: { type: "string" },
      "no-db": { type: "boolean", default: false },
      reprobe: { type: "boolean", default: false },
      "all-bucket": { type: "boolean", default: false },
    },
  });
  const scope = env().sourcePrefix;
  const prefix = resolveListPrefix(values.prefix, scope);
  assertBucketWideAllowed({ endpoint: env().source.endpoint, bucket: env().source.bucket, listPrefix: prefix, allBucket: values["all-bucket"]! });
  const concurrency = Math.max(1, Number(values.concurrency));
  const limit = values.limit ? Number(values.limit) : undefined;
  const useDb = !values["no-db"];
  const bucket = sourceBucket();
  const t0 = Date.now();

  console.log(`Auditing s3://${bucket.name}/${prefix} (concurrency ${concurrency}${limit ? `, limit ${limit}` : ""}${useDb ? "" : ", no DB"})`);

  // 1) list
  const objects: { key: string; size: number; lastModified: Date | null }[] = [];
  let listed = 0;
  let nonVideo = 0;
  let nonVideoBytes = 0;
  for await (const o of listAllObjects(bucket, prefix)) {
    if (!keyInScope(o.Key!, scope)) continue;
    listed++;
    if (!isVideoKey(o.Key!)) {
      nonVideo++;
      nonVideoBytes += o.Size ?? 0;
      continue;
    }
    objects.push({ key: o.Key!, size: o.Size ?? 0, lastModified: o.LastModified ?? null });
    if (limit && objects.length >= limit) break;
  }
  console.log(`Listed ${listed} objects: ${objects.length} video files, ${nonVideo} other (${human(nonVideoBytes)})`);

  // 2) upsert rows (resets changed files) and load existing results
  const rowsByKey = new Map<string, SourceFile>();
  if (useDb) {
    const scan = await scanBucket(db(), bucket, { prefix, scope, limit });
    console.log(`DB: ${scan.created} new, ${scan.reset} changed, ${scan.unchanged} unchanged`);
    for (let i = 0; i < objects.length; i += 1000) {
      const chunk = await db().sourceFile.findMany({ where: { bucket: bucket.name, key: { in: objects.slice(i, i + 1000).map((o) => o.key) } } });
      for (const r of chunk) rowsByKey.set(r.key, r);
    }
  }

  // 3) probe
  let done = 0;
  let probed = 0;
  const rows = await mapPool(objects, concurrency, async (o): Promise<Row> => {
    const existing = rowsByKey.get(o.key);
    let row: Row;
    if (existing && existing.probeStatus === "OK" && !values.reprobe) {
      row = { ...o, status: "OK", error: null, s: fromDb(existing) };
    } else {
      probed++;
      try {
        const r = await probeObject(bucket, o.key);
        if (existing) await saveProbeOutcome(db(), existing.id, r);
        row = { ...o, status: r.ok ? "OK" : "FAILED", error: r.error ?? null, s: r.summary ?? null };
      } catch (err) {
        row = { ...o, status: "FAILED", error: errMessage(err), s: null };
      }
    }
    done++;
    if (process.stdout.isTTY) process.stdout.write(`\r  probed ${done}/${objects.length}`);
    return row;
  });
  if (process.stdout.isTTY) process.stdout.write("\n");

  // 4) CSV
  const header = [
    "key", "size_bytes", "size", "last_modified", "probe_status", "probe_error", "container", "duration_sec", "video_codec",
    "width", "height", "resolution_class", "frame_rate", "bitrate_kbps", "hdr", "audio_tracks", "subtitle_tracks",
    "planned_renditions", "est_output_bytes",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const s = r.s;
    const planned = s?.width && s.height ? selectRenditions(s.width, s.height, s.frameRate ?? 30).map((x) => x.name).join(" ") : "";
    lines.push(
      [
        r.key, r.size, human(r.size), r.lastModified, r.status, r.error, s?.container, s?.durationSec?.toFixed(3), s?.videoCodec,
        s?.width, s?.height, resolutionBucket(s?.width ?? null, s?.height ?? null), s?.frameRate, s?.bitrateKbps, s ? (s.isHdr ? "yes" : "no") : "",
        s?.audioTracks.map((a) => `${a.codec}:${a.language ?? "und"}:${a.channels ?? "?"}ch`).join(" | "),
        s?.subtitleTracks.map((t) => `${t.codec}:${t.language ?? "und"}`).join(" | "),
        planned, Math.round(estimateOutputBytes(s)),
      ].map(csvCell).join(","),
    );
  }
  const reportsDir = join(REPO_ROOT, "reports");
  await mkdir(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const csvPath = join(reportsDir, `bucket-audit-${stamp}.csv`);
  await writeFile(csvPath, lines.join("\n") + "\n");

  // 5) summary
  const ok = rows.filter((r) => r.status === "OK");
  const failed = rows.filter((r) => r.status === "FAILED");
  const totalBytes = rows.reduce((a, r) => a + r.size, 0);
  const totalDur = ok.reduce((a, r) => a + (r.s?.durationSec ?? 0), 0);
  const estOut = ok.reduce((a, r) => a + estimateOutputBytes(r.s), 0);
  console.log("\n════════ Bucket audit summary ════════");
  console.log(`Video files:        ${rows.length} (${ok.length} OK, ${failed.length} failed; ${probed} probed this run)`);
  console.log(`Total size:         ${human(totalBytes)}`);
  console.log(`Total duration:     ${hours(totalDur)}`);
  console.log(`HDR files:          ${ok.filter((r) => r.s?.isHdr).length}`);
  console.log(`Multi-audio files:  ${ok.filter((r) => (r.s?.audioTracks.length ?? 0) > 1).length}`);
  console.log(`With text subs:     ${ok.filter((r) => r.s?.subtitleTracks.some((t) => !/pgs|dvd|dvb|xsub/.test(t.codec))).length}`);
  printTable("By container:", ok, (r) => r.s?.container ?? "unknown");
  printTable("By video codec:", ok, (r) => r.s?.videoCodec ?? "unknown");
  printTable("By resolution:", ok, (r) => resolutionBucket(r.s?.width ?? null, r.s?.height ?? null));
  if (failed.length) {
    console.log(`\nFailed to probe (${failed.length}):`);
    for (const r of failed.slice(0, 30)) console.log(`  ${r.key}: ${r.error}`);
    if (failed.length > 30) console.log(`  … ${failed.length - 30} more in the CSV`);
  }
  console.log(`\nEstimated HLS output (ladder ${"360p/480p/720p/1080p"}, never upscaled): ${human(estOut)}` + (totalBytes ? ` (${((estOut / totalBytes) * 100).toFixed(0)}% of source)` : ""));
  console.log(`CSV report:         ${csvPath}`);
  console.log(`Elapsed:            ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await closeContext();
}

main().catch(async (err) => {
  console.error(`audit failed: ${errMessage(err)}`);
  await closeContext();
  process.exit(1);
});
