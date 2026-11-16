/**
 * Test helper (no API needed): creates MediaAsset + TranscodeJob rows for a source object and enqueues the job.
 *
 *   pnpm --filter @app/worker enqueue --source-key samples/sample-1080p-h264.mp4 [--wait] [--attempts 3]
 *   pnpm --filter @app/worker enqueue --asset-id <uuid> [--wait]      # re-transcode an existing asset
 */
import "../env.js";
import { QUEUE_TRANSCODE, type TranscodeJobData } from "@app/shared/media";
import { Queue } from "bullmq";
import { parseArgs } from "node:util";
import { closeContext, db, redisConnection, sourceBucket } from "../lib/context.js";
import { headObject } from "../lib/s3.js";
import { assertKeyInScope } from "../lib/scope.js";
import { env } from "../env.js";
import { TRANSCODE_JOB_OPTS } from "../workers/transcode-worker.js";

async function main() {
  const { values } = parseArgs({
    options: {
      "source-key": { type: "string" },
      "asset-id": { type: "string" },
      wait: { type: "boolean", default: false },
      attempts: { type: "string", default: String(TRANSCODE_JOB_OPTS.attempts) },
      json: { type: "boolean", default: false },
    },
  });
  const prisma = db();
  const bucket = sourceBucket();
  let assetId = values["asset-id"];

  if (!assetId) {
    const key = values["source-key"];
    if (!key) throw new Error("--source-key <key> or --asset-id <id> is required");
    assertKeyInScope(key, env().sourcePrefix);
    let src = await prisma.sourceFile.findUnique({ where: { bucket_key: { bucket: bucket.name, key } } });
    if (!src) {
      const head = await headObject(bucket, key).catch(() => null);
      if (!head) throw new Error(`s3://${bucket.name}/${key} does not exist`);
      src = await prisma.sourceFile.create({
        data: { bucket: bucket.name, key, sizeBytes: BigInt(head.ContentLength ?? 0), etag: head.ETag?.replace(/"/g, "") ?? null, lastModified: head.LastModified ?? null },
      });
    }
    const asset = await prisma.mediaAsset.create({ data: { sourceFileId: src.id, kind: "MAIN", status: "QUEUED" } });
    assetId = asset.id;
  } else {
    await prisma.mediaAsset.update({ where: { id: assetId }, data: { status: "QUEUED", errorMessage: null } });
  }
  const job = await prisma.transcodeJob.create({ data: { assetId, status: "QUEUED" } });
  const queue = new Queue<TranscodeJobData>(QUEUE_TRANSCODE, { connection: redisConnection() });
  const qJob = await queue.add(
    "transcode",
    { assetId, transcodeJobId: job.id },
    { ...TRANSCODE_JOB_OPTS, attempts: Number(values.attempts), jobId: job.id },
  );
  await prisma.transcodeJob.update({ where: { id: job.id }, data: { queueJobId: qJob.id } });
  await queue.close();
  if (!values.json) console.log(`enqueued asset=${assetId} transcodeJob=${job.id}`);

  if (values.wait) {
    const t0 = Date.now();
    let last = "";
    for (;;) {
      const j = await prisma.transcodeJob.findUniqueOrThrow({ where: { id: job.id } });
      const line = `${j.status} ${j.progress}% ${j.stage ?? ""} (attempt ${j.attempt})`;
      if (line !== last && !values.json) console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${line}`);
      last = line;
      if (j.status === "SUCCEEDED" || (j.status === "FAILED" && j.finishedAt)) {
        const a = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId }, include: { renditions: true, subtitleTracks: true } });
        const summary = {
          assetId,
          transcodeJobId: job.id,
          status: j.status,
          seconds: (Date.now() - t0) / 1000,
          error: j.error,
          asset: { status: a.status, durationSec: a.durationSec, outputPrefix: a.outputPrefix, errorMessage: a.errorMessage },
          renditions: a.renditions.map((r) => `${r.name} ${r.width}x${r.height} ${r.videoKbps}k ${r.codecs}`),
          subtitles: a.subtitleTracks.map((s) => `${s.language} "${s.label}" ${s.key}`),
        };
        console.log(JSON.stringify(summary, null, values.json ? 0 : 2));
        process.exitCode = j.status === "SUCCEEDED" ? 0 : 2;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await closeContext();
}

main().catch(async (err) => {
  console.error(`enqueue failed: ${err instanceof Error ? err.message : String(err)}`);
  await closeContext();
  process.exit(1);
});
