import "../src/env.js";
import { describe, expect, it } from "vitest";
import { createKV, MemoryKV } from "../src/lib/kv.js";

describe("MemoryKV", () => {
  it("expires and evicts", async () => {
    const kv = new MemoryKV(2);
    await kv.set("a", "1");
    await kv.set("b", "2");
    await kv.set("c", "3");
    expect(await kv.get("a")).toBeNull();
    expect(await kv.get("c")).toBe("3");
    await kv.set("t", "x", -1 as unknown as number);
    await kv.del("c");
    expect(await kv.get("c")).toBeNull();
  });
});

describe.skipIf(!process.env.REDIS_URL)("LayeredKV (local Redis)", () => {
  it("persists file_ids across instances", async () => {
    const key = `bot:test:${Date.now()}`;
    const a = createKV(process.env.REDIS_URL!);
    await a.set(key, "fid-xyz", 60);
    await a.close();
    const b = createKV(process.env.REDIS_URL!);
    expect(await b.get(key)).toBe("fid-xyz");
    await b.del(key);
    expect(await b.get(key)).toBeNull();
    await b.close();
  });
  it("degrades to memory when Redis is unreachable", async () => {
    const kv = createKV("redis://127.0.0.1:1");
    await kv.set("k", "v");
    expect(await kv.get("k")).toBe("v");
    await kv.close();
  });
});
