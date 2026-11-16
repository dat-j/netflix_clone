import { type ProbeJobData, QUEUE_PROBE } from "@app/shared/media";
import { type Job, Queue, UnrecoverableError, Worker } from "bullmq";
import { env } from "../env.js";
import { db, redisConnection, sourceBucket } from "../lib/context.js";
import { logger } from "../lib/log.js";
import { assertBucketWideAllowed, resolveListPrefix, ScopeError } from "../lib/scope.js";
import { probeSourceFile, scanBucket } from "../pipeline/source-files.js";

const log = logger("probe");

export const PROBE_JOB_OPTS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 10_000 },
  removeOnComplete: true,
  removeOnFail: { count: 500 },
} as const;

/** Enqueues a `probe` job per id; jobId dedupes files already waiting. */
export async function enqueueProbes(queue: Queue<ProbeJobData>, ids: string[]) {
  for (let i = 0; i < ids.length; i += 500) {
    await queue.addBulk(
      ids.slice(i, i + 500).map((id) => ({ name: "probe", data: { type: "probe", sourceFileId: id } as ProbeJobData, opts: { ...PROBE_JOB_OPTS, jobId: `probe-${id}` } })),
    );
  }
}

export function startProbeWorker() {
  const queue = new Queue<ProbeJobData>(QUEUE_PROBE, { connection: redisConnection() });
  const worker = new Worker<ProbeJobData>(
    QUEUE_PROBE,
    async (job: Job<ProbeJobData>) => {
      const d = job.data;
      if (d.type === "scan") {
        const e = env();
        const scope = e.sourcePrefix;
        // `allBucket` is a worker-internal extension of the scan payload (set by `pnpm scan --all-bucket`)
        const allBucket = e.allowAllBucket || (d as { allBucket?: boolean }).allBucket === true;
        let prefix: string;
        try {
          prefix = resolveListPrefix(d.prefix, scope);
          assertBucketWideAllowed({ endpoint: e.source.endpoint, bucket: e.source.bucket, listPrefix: prefix, allBucket });
        } catch (err) {
          if (err instanceof ScopeError) {
            log.error("scan refused", { err: err.message });
            throw new UnrecoverableError(err.message);
          }
          throw err;
        }
        const t = Date.now();
        const r = await scanBucket(db(), sourceBucket(), { prefix, scope });
        await enqueueProbes(queue, r.pendingIds);
        const { pendingIds, ...stats } = r;
        log.info("scan done", { prefix: prefix || "(all)", ...stats, probesQueued: pendingIds.length, ms: Date.now() - t });
        return { ...stats, probesQueued: pendingIds.length };
      }
      if (d.type === "probe") {
        const t = Date.now();
        const r = await probeSourceFile(db(), sourceBucket(), env().sourcePrefix, d.sourceFileId);
        if (r.ok) {
          const s = r.summary!;
          log.info("probed", { id: d.sourceFileId, container: s.container, video: `${s.videoCodec} ${s.width}x${s.height}@${s.frameRate}`, dur: s.durationSec, audio: s.audioTracks.length, subs: s.subtitleTracks.length, ms: Date.now() - t });
        } else {
          log.warn("probe failed", { id: d.sourceFileId, error: r.error });
        }
        return { ok: r.ok, error: r.error };
      }
      throw new Error(`unknown probe job type ${(d as { type?: string }).type}`);
    },
    { connection: redisConnection(), concurrency: env().probeConcurrency },
  );
  worker.on("failed", (job, err) => log.error("job failed", { job: job?.id, attempt: job?.attemptsMade, err: err.message }));
  worker.on("error", (err) => log.error("worker error", { err: err.message }));
  return {
    worker,
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
