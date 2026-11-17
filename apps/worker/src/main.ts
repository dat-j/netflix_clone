import { randomUUID } from "node:crypto";
import { env } from "./env.js";
import { QUEUE_PROBE, QUEUE_TRANSCODE } from "@app/shared/media";
import { closeContext, db, redisConnection } from "./lib/context.js";
import { ffmpegPath, ffprobePath, runProcess } from "./lib/ffmpeg.js";
import { errMessage, logger } from "./lib/log.js";
import { cleanStaleWorkDirs } from "./pipeline/transcode.js";
import { startProbeWorker } from "./workers/probe-worker.js";
import { startTranscodeWorker } from "./workers/transcode-worker.js";

const log = logger("main");

async function main() {
  const e = env();
  // fail fast on missing config
  void [e.databaseUrl, e.mediaKeySecret, e.source, e.media];
  if (Buffer.from(e.mediaKeySecret, "hex").length !== 32) throw new Error("MEDIA_KEY_ENCRYPTION_SECRET must be 32 bytes hex");
  const version = async (bin: string) => (await runProcess(bin, ["-version"], { captureStdout: true, timeoutMs: 10_000 })).stdout.split("\n")[0];
  log.info("media worker starting", {
    pid: process.pid,
    ffmpeg: `${ffmpegPath()} (${await version(ffmpegPath())})`,
    ffprobe: `${ffprobePath()} (${await version(ffprobePath())})`,
    sourceBucket: e.source.bucket,
    mediaBucket: e.media.bucket,
    transcodeConcurrency: e.transcodeConcurrency,
    probeConcurrency: e.probeConcurrency,
    preset: e.x264Preset,
    workDir: e.workDir,
  });
  await db().$queryRaw`SELECT 1`;
  await cleanStaleWorkDirs(e.workDir, log);

  const probe = startProbeWorker();
  const transcode = startTranscodeWorker();
  await Promise.all([probe.worker.waitUntilReady(), transcode.worker.waitUntilReady()]);
  log.info("consuming", { queues: `${QUEUE_PROBE},${QUEUE_TRANSCODE}` });

  const heartbeat = redisConnection();
  const heartbeatKey = `health:worker:${process.pid}:${randomUUID()}`;
  const beat = () => heartbeat.set(heartbeatKey, String(Date.now()), "EX", 45)
    .catch((err: unknown) => log.warn("worker heartbeat failed", { err: errMessage(err) }));
  await beat();
  const heartbeatTimer = setInterval(() => void beat(), 15_000);
  heartbeatTimer.unref();

  let stopping = false;
  const shutdown = async (sig: string) => {
    if (stopping) {
      log.warn("second signal, exiting now");
      process.exit(1);
    }
    stopping = true;
    clearInterval(heartbeatTimer);
    log.info("shutting down", { signal: sig, graceMs: e.shutdownGraceMs });
    try {
      await heartbeat.del(heartbeatKey).catch(() => undefined);
      await Promise.all([probe.close(), transcode.close(e.shutdownGraceMs)]);
      await closeContext();
    } catch (err) {
      log.error("error during shutdown", { err: errMessage(err) });
    }
    log.info("bye");
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("fatal", { err: errMessage(err) });
  process.exit(1);
});
