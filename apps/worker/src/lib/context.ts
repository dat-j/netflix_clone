import { createPrismaClient, type PrismaClient } from "@app/db";
import { Redis } from "ioredis";
import { env } from "../env.js";
import { type Bucket, createBucket } from "./s3.js";

let prisma: PrismaClient | undefined;
let source: Bucket | undefined;
let media: Bucket | undefined;

export function db(): PrismaClient {
  prisma ??= createPrismaClient(env().databaseUrl);
  return prisma;
}
export function sourceBucket(): Bucket {
  source ??= createBucket(env().source);
  return source;
}
export function mediaBucket(): Bucket {
  media ??= createBucket(env().media, env().mediaPrefix);
  return media;
}
const connections: Redis[] = [];
/** BullMQ requires `maxRetriesPerRequest: null` on worker connections. BullMQ does not close instances it was given,
 *  so they are tracked here and closed by closeContext(). */
export function redisConnection(): Redis {
  const c = new Redis(env().redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  connections.push(c);
  return c;
}

export async function closeContext() {
  await prisma?.$disconnect().catch(() => {});
  source?.client.destroy();
  media?.client.destroy();
  await Promise.all(connections.splice(0).map((c) => c.quit().catch(() => c.disconnect())));
}
