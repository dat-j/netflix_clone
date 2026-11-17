/** Small key-value cache: in-memory LRU in front of optional Redis. Redis failures degrade to memory-only. */
import { Redis } from "ioredis";
import { errMessage, logger } from "./log.js";

const log = logger("kv");

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  close(): Promise<void>;
}

export class MemoryKV implements KV {
  private readonly map = new Map<string, { v: string; exp: number }>();
  constructor(private readonly max = 5000) {}
  async get(key: string) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) {
      this.map.delete(key);
      return null;
    }
    // refresh LRU position
    this.map.delete(key);
    this.map.set(key, e);
    return e.v;
  }
  async set(key: string, v: string, ttlSec?: number) {
    this.map.delete(key);
    this.map.set(key, { v, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
  async del(key: string) {
    this.map.delete(key);
  }
  async close() {}
}

export class LayeredKV implements KV {
  private warned = false;
  constructor(private readonly mem: MemoryKV, private readonly redis: Redis) {}

  private fail(err: unknown) {
    if (!this.warned) log.warn("redis unavailable, using memory cache only", { err: errMessage(err) });
    this.warned = true;
  }
  async get(key: string) {
    const m = await this.mem.get(key);
    if (m !== null) return m;
    try {
      const v = await this.redis.get(key);
      if (v !== null) {
        const ttl = await this.redis.ttl(key);
        await this.mem.set(key, v, ttl > 0 ? ttl : undefined);
      }
      this.warned = false;
      return v;
    } catch (err) {
      this.fail(err);
      return null;
    }
  }
  async set(key: string, v: string, ttlSec?: number) {
    await this.mem.set(key, v, ttlSec);
    try {
      if (ttlSec) await this.redis.set(key, v, "EX", ttlSec);
      else await this.redis.set(key, v);
    } catch (err) {
      this.fail(err);
    }
  }
  async del(key: string) {
    await this.mem.del(key);
    try {
      await this.redis.del(key);
    } catch (err) {
      this.fail(err);
    }
  }
  async close() {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

export function createKV(redisUrl: string): KV {
  const mem = new MemoryKV();
  if (!redisUrl) return mem;
  // Commands queue briefly while (re)connecting; commandTimeout bounds the wait so a dead Redis never stalls updates.
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 5000, commandTimeout: 1500 });
  redis.on("error", () => {}); // surfaced (once) through LayeredKV.fail
  return new LayeredKV(mem, redis);
}
