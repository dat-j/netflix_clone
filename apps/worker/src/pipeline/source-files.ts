import { Prisma, type PrismaClient } from "@app/db";
import type { _Object } from "@aws-sdk/client-s3";
import { isVideoKey } from "../lib/extensions.js";
import { errMessage } from "../lib/log.js";
import { assertTranscodable, ffprobe, ProbeError, type FfprobeResult, type ProbeSummary, summarizeProbe } from "../lib/probe.js";
import { withReadableUrl } from "../lib/http-relay.js";
import { keyInScope } from "../lib/scope.js";
import { type Bucket, listAllObjects, presignGet } from "../lib/s3.js";

const normEtag = (e: string | undefined) => (e ? e.replace(/"/g, "") : null);

export interface ScanResult {
  listed: number;
  videos: number;
  skippedNonVideo: number;
  created: number;
  reset: number;
  unchanged: number;
  pendingIds: string[];
}

const RESET_PROBE_FIELDS = {
  probeStatus: "PENDING",
  probeError: null,
  container: null,
  durationSec: null,
  videoCodec: null,
  width: null,
  height: null,
  frameRate: null,
  bitrateKbps: null,
  isHdr: null,
  audioTracks: Prisma.DbNull,
  subtitleTracks: Prisma.DbNull,
  probeData: Prisma.DbNull,
  probedAt: null,
} satisfies Prisma.SourceFileUpdateInput;

/**
 * Lists the bucket (paginated), upserts SourceFile rows for video-like keys and returns the ids still PENDING.
 * A changed etag/size resets the probe result. Non-video objects are not stored.
 */
export async function scanBucket(
  prisma: PrismaClient,
  bucket: Bucket,
  /** `prefix` must already be resolved inside `scope` (see resolveListPrefix); keys outside `scope` are ignored. */
  opts: { prefix?: string; scope: string; limit?: number; onPage?: (r: ScanResult) => void },
): Promise<ScanResult> {
  const r: ScanResult = { listed: 0, videos: 0, skippedNonVideo: 0, created: 0, reset: 0, unchanged: 0, pendingIds: [] };
  let page: _Object[] = [];
  const flush = async () => {
    if (!page.length) return;
    const keys = page.map((o) => o.Key!);
    const existing = await prisma.sourceFile.findMany({ where: { bucket: bucket.name, key: { in: keys } } });
    const byKey = new Map(existing.map((e) => [e.key, e]));
    for (const o of page) {
      const etag = normEtag(o.ETag);
      const size = BigInt(o.Size ?? 0);
      const prev = byKey.get(o.Key!);
      if (!prev) {
        const row = await prisma.sourceFile.upsert({
          where: { bucket_key: { bucket: bucket.name, key: o.Key! } },
          create: { bucket: bucket.name, key: o.Key!, sizeBytes: size, etag, lastModified: o.LastModified ?? null },
          update: {},
        });
        r.created++;
        if (row.probeStatus === "PENDING") r.pendingIds.push(row.id);
      } else if (prev.sizeBytes !== size || (etag && prev.etag && prev.etag !== etag)) {
        await prisma.sourceFile.update({
          where: { id: prev.id },
          data: { ...RESET_PROBE_FIELDS, sizeBytes: size, etag, lastModified: o.LastModified ?? null },
        });
        r.reset++;
        r.pendingIds.push(prev.id);
      } else {
        r.unchanged++;
        if (prev.probeStatus === "PENDING") r.pendingIds.push(prev.id);
      }
    }
    page = [];
    opts.onPage?.(r);
  };
  for await (const o of listAllObjects(bucket, opts.prefix)) {
    r.listed++;
    if (!keyInScope(o.Key!, opts.scope)) continue;
    if (!isVideoKey(o.Key!)) {
      r.skippedNonVideo++;
      continue;
    }
    r.videos++;
    page.push(o);
    if (page.length >= 500) await flush();
    if (opts.limit && r.videos >= opts.limit) break;
  }
  await flush();
  return r;
}

export function probeFields(summary: ProbeSummary, data: FfprobeResult) {
  return {
    container: summary.container,
    durationSec: summary.durationSec,
    videoCodec: summary.videoCodec,
    width: summary.width,
    height: summary.height,
    frameRate: summary.frameRate,
    bitrateKbps: summary.bitrateKbps,
    isHdr: summary.isHdr,
    audioTracks: summary.audioTracks as unknown as Prisma.InputJsonValue,
    subtitleTracks: summary.subtitleTracks as unknown as Prisma.InputJsonValue,
    probeData: data as unknown as Prisma.InputJsonValue,
    probedAt: new Date(),
  };
}

export interface ProbeOutcome {
  ok: boolean;
  summary?: ProbeSummary;
  data?: FfprobeResult;
  error?: string;
}

/** ffprobe over a presigned GET URL (no download); never throws for media problems. */
export async function probeObject(bucket: Bucket, key: string, signal?: AbortSignal): Promise<ProbeOutcome> {
  try {
    const url = await presignGet(bucket, key, 900);
    const data = await withReadableUrl(url, (u) => ffprobe(u, { signal }));
    const summary = summarizeProbe(data, key);
    try {
      assertTranscodable(data, summary);
    } catch (err) {
      return { ok: false, summary, data, error: errMessage(err) };
    }
    return { ok: true, summary, data };
  } catch (err) {
    if (err instanceof ProbeError) return { ok: false, error: err.message };
    throw err; // infra errors (S3 auth, network) → let the job retry
  }
}

/** Probes one SourceFile row and stores the result (status OK / FAILED with a readable error). */
export async function probeSourceFile(prisma: PrismaClient, bucket: Bucket, scope: string, id: string, signal?: AbortSignal): Promise<ProbeOutcome> {
  const row = await prisma.sourceFile.findUnique({ where: { id } });
  if (!row) throw new Error(`SourceFile ${id} not found`);
  if (row.bucket !== bucket.name || !keyInScope(row.key, scope)) {
    // never read objects outside the configured bucket/prefix
    const error = `s3://${row.bucket}/${row.key} is outside the configured source scope s3://${bucket.name}/${scope} — not probed`;
    await prisma.sourceFile.update({ where: { id }, data: { probeStatus: "SKIPPED", probeError: error } });
    return { ok: false, error };
  }
  const outcome = await probeObject(bucket, row.key, signal);
  await saveProbeOutcome(prisma, id, outcome);
  return outcome;
}

export async function saveProbeOutcome(prisma: PrismaClient, id: string, outcome: ProbeOutcome) {
  await prisma.sourceFile.update({
    where: { id },
    data: {
      ...(outcome.summary && outcome.data ? probeFields(outcome.summary, outcome.data) : { probedAt: new Date() }),
      probeStatus: outcome.ok ? "OK" : "FAILED",
      probeError: outcome.ok ? null : (outcome.error ?? "unknown probe error").slice(0, 1000),
    },
  });
}
