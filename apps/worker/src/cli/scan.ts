/**
 * Enqueues a `scan` job on the probe queue (what the API's "scan bucket" button does).
 *
 *   pnpm --filter @app/worker scan [--prefix samples/] [--reprobe-failed] [--all-bucket]
 *
 * The prefix is resolved inside SOURCE_S3_PREFIX. --all-bucket is required for an un-prefixed scan of a non-local
 * endpoint (passed to the worker as `allBucket: true` in the job payload).
 *
 * --reprobe-failed resets FAILED SourceFile rows under the prefix to PENDING first so the scan re-probes them.
 */
import "../env.js";
import { type ProbeJobData, QUEUE_PROBE } from "@app/shared/media";
import { Queue } from "bullmq";
import { parseArgs } from "node:util";
import { env } from "../env.js";
import { closeContext, db, redisConnection } from "../lib/context.js";
import { assertBucketWideAllowed, resolveListPrefix } from "../lib/scope.js";

async function main() {
  const { values } = parseArgs({
    options: { prefix: { type: "string" }, "reprobe-failed": { type: "boolean", default: false }, "all-bucket": { type: "boolean", default: false } },
  });
  const prefix = resolveListPrefix(values.prefix, env().sourcePrefix);
  assertBucketWideAllowed({ endpoint: env().source.endpoint, bucket: env().source.bucket, listPrefix: prefix, allBucket: values["all-bucket"]! });
  if (values["reprobe-failed"]) {
    const r = await db().sourceFile.updateMany({
      where: { bucket: env().source.bucket, probeStatus: "FAILED", key: { startsWith: prefix } },
      data: { probeStatus: "PENDING", probeError: null },
    });
    console.log(`reset ${r.count} FAILED source files to PENDING`);
  }
  const q = new Queue<ProbeJobData>(QUEUE_PROBE, { connection: redisConnection() });
  const data = { type: "scan", ...(prefix ? { prefix } : {}), ...(values["all-bucket"] ? { allBucket: true } : {}) } as ProbeJobData;
  const job = await q.add("scan", data, { removeOnComplete: true, removeOnFail: 100 });
  await q.close();
  console.log(`scan enqueued (job ${job.id}, prefix "${prefix}")`);
  await closeContext();
}
main().catch(async (err) => {
  console.error(`scan failed: ${err instanceof Error ? err.message : String(err)}`);
  await closeContext();
  process.exit(1);
});
