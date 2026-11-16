import type { Redis } from "ioredis";

/** Cache JSON ngắn hạn trong Redis cho dữ liệu không cá nhân hóa. Lỗi Redis → bỏ qua cache. */
export async function cached<T>(redis: Redis, key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch {
    /* bỏ qua */
  }
  const value = await load();
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSec);
  } catch {
    /* bỏ qua */
  }
  return value;
}

/** Xóa toàn bộ cache catalog (gọi sau khi admin sửa nội dung). */
export async function invalidateCatalogCache(redis: Redis): Promise<void> {
  try {
    const stream = redis.scanStream({ match: "cat:*", count: 200 });
    for await (const keys of stream as AsyncIterable<string[]>) {
      if (keys.length) await redis.del(...keys);
    }
  } catch {
    /* bỏ qua */
  }
}
