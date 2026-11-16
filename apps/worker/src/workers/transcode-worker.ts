import { QUEUE_TRANSCODE, type TranscodeJobData } from "@app/shared/media";
import { type Job, UnrecoverableError, Worker } from "bullmq";
import { env } from "../env.js";
import { db, mediaBucket, redisConnection, sourceBucket } from "../lib/context.js";
import { errMessage, logger } from "../lib/log.js";
import { redactUrl } from "../lib/probe.js";
import { runTranscode, TranscodeError } from "../pipeline/transcode.js";

const log = logger("transcode");

/** Recommended options for producers (API) adding transcode jobs. */
export const TRANSCODE_JOB_OPTS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 60_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 1000 },
} as const;

export function startTranscodeWorker() {
  const e = env();
  /** Aborted on forced shutdown → kills running ffmpeg processes. */
  const abort = new AbortController();

  const worker = new Worker<TranscodeJobData>(
    QUEUE_TRANSCODE,
    async (job: Job<TranscodeJobData>) => {
      const attempt = job.attemptsMade + 1;
      const maxAttempts = Math.max(1, job.opts.attempts ?? 1);
      const { assetId, transcodeJobId } = job.data;
      log.info("job start", { queueJob: job.id, asset: assetId, job: transcodeJobId, attempt: `${attempt}/${maxAttempts}` });
      try {
        const result = await runTranscode(
          { prisma: db(), source: sourceBucket(), media: mediaBucket(), env: e, log, signal: abort.signal, attempt, queueJobId: job.id },
          job.data,
          (pct) => void job.updateProgress(pct).catch(() => {}),
        );
        log.info("job done", {
          asset: assetId,
          renditions: result.renditions.map((r) => `${r.name}:${r.width}x${r.height}`).join(","),
          duration: +result.durationSec.toFixed(2),
          objects: result.objects,
          mb: +(result.bytes / 1048576).toFixed(1),
          subs: result.subtitles,
          timings: result.timings,
        });
        return result;
      } catch (err) {
        const message = redactUrl(errMessage(err)).slice(0, 2000);
        const tail = err instanceof TranscodeError ? err.logTail : [];
        const final = err instanceof UnrecoverableError || attempt >= maxAttempts;
        const shuttingDown = abort.signal.aborted;
        log.error("job failed", { asset: assetId, attempt, final, err: message });
        await db()
          .$transaction([
            db().transcodeJob.update({
              where: { id: transcodeJobId },
              data: {
                status: final ? "FAILED" : "QUEUED",
                stage: final ? "failed" : shuttingDown ? "interrupted (worker shutdown), will retry" : "retrying",
                error: message,
                log: tail.length ? redactUrl(tail.join("\n")).slice(-8000) : null,
                finishedAt: final ? new Date() : null,
                attempt,
              },
            }),
            db().mediaAsset.update({
              where: { id: assetId },
              data: final ? { status: "FAILED", errorMessage: message } : { status: "QUEUED", errorMessage: `attempt ${attempt} failed: ${message}` },
            }),
          ])
          .catch((dbErr) => log.error("could not record failure", { err: errMessage(dbErr) }));
        throw err;
      }
    },
    {
      connection: redisConnection(),
      concurrency: e.transcodeConcurrency,
      // ffmpeg runs in a child process so the event loop stays free to renew the lock; keep it generous anyway.
      lockDuration: 120_000,
      maxStalledCount: 2,
    },
  );
  worker.on("error", (err) => log.error("worker error", { err: err.message }));

  return {
    worker,
    /** Waits up to graceMs for running jobs, then kills ffmpeg (the job fails this attempt and is retried). */
    async close(graceMs: number) {
      const closing = worker.close();
      const timer = setTimeout(() => {
        log.warn("grace period over, aborting running transcodes");
        abort.abort();
      }, graceMs);
      await closing;
      clearTimeout(timer);
    },
  };
}
