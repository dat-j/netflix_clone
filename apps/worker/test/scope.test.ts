import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { listAllObjects, physicalKey, type Bucket } from "../src/lib/s3.js";
import {
  applyKeyPrefix,
  assertBucketWideAllowed,
  assertKeyInScope,
  assertLocalForWrites,
  isLocalEndpoint,
  keyInScope,
  normalizePrefix,
  resolveListPrefix,
  ScopeError,
  stripKeyPrefix,
} from "../src/lib/scope.js";

describe("normalizePrefix", () => {
  it("adds exactly one trailing slash, strips leading ones", () => {
    expect(normalizePrefix("")).toBe("");
    expect(normalizePrefix(undefined)).toBe("");
    expect(normalizePrefix("movies")).toBe("movies/");
    expect(normalizePrefix("/movies//")).toBe("movies/");
    expect(normalizePrefix(" a/b ")).toBe("a/b/");
  });
});

describe("isLocalEndpoint", () => {
  it("only localhost / loopback literals are local", () => {
    expect(isLocalEndpoint("http://localhost:9010")).toBe(true);
    expect(isLocalEndpoint("http://127.0.0.1:9000")).toBe(true);
    expect(isLocalEndpoint("http://[::1]:9000")).toBe(true);
    expect(isLocalEndpoint("https://s3.wasabisys.com")).toBe(false);
    expect(isLocalEndpoint("https://abc.r2.cloudflarestorage.com")).toBe(false);
    expect(isLocalEndpoint("http://localhost.evil.com")).toBe(false);
    expect(isLocalEndpoint("http://192.168.1.10:9000")).toBe(false);
    expect(isLocalEndpoint(undefined)).toBe(false); // no endpoint = AWS
    expect(isLocalEndpoint("not a url")).toBe(false);
  });
});

describe("SOURCE_S3_PREFIX boundary", () => {
  it("keyInScope respects folder boundaries", () => {
    expect(keyInScope("movies/a.mp4", "movies")).toBe(true);
    expect(keyInScope("movies2/a.mp4", "movies")).toBe(false);
    expect(keyInScope("uploads/u1/clip.mp4", "movies/")).toBe(false);
    expect(keyInScope("anything.mp4", "")).toBe(true);
    expect(() => assertKeyInScope("uploads/x.mp4", "movies/")).toThrow(ScopeError);
    expect(() => assertKeyInScope("movies/x.mp4", "movies/")).not.toThrow();
  });

  it("resolveListPrefix never escapes the scope", () => {
    expect(resolveListPrefix(undefined, "movies/")).toBe("movies/");
    expect(resolveListPrefix("", "movies")).toBe("movies/");
    expect(resolveListPrefix("movies/action/", "movies/")).toBe("movies/action/");
    expect(resolveListPrefix("action/", "movies/")).toBe("movies/action/");
    expect(resolveListPrefix("/uploads/", "movies/")).toBe("movies/uploads/");
    expect(resolveListPrefix("samples/", "")).toBe("samples/");
    expect(resolveListPrefix(undefined, "")).toBe("");
    expect(() => resolveListPrefix("movies/../uploads/", "movies/")).toThrow(ScopeError);
    for (const p of ["", "x", "movies", "moviesX/", "uploads/"]) {
      expect(resolveListPrefix(p, "movies/").startsWith("movies/")).toBe(true);
    }
  });

  it("bucket-wide listing on a remote endpoint requires an explicit opt-in", () => {
    const remote = { endpoint: "https://s3.example.com", bucket: "shared", allBucket: false };
    expect(() => assertBucketWideAllowed({ ...remote, listPrefix: "" })).toThrow(/--all-bucket/);
    expect(() => assertBucketWideAllowed({ ...remote, endpoint: undefined, listPrefix: "" })).toThrow(ScopeError);
    expect(() => assertBucketWideAllowed({ ...remote, listPrefix: "", allBucket: true })).not.toThrow();
    expect(() => assertBucketWideAllowed({ ...remote, listPrefix: "movies/" })).not.toThrow();
    expect(() => assertBucketWideAllowed({ ...remote, endpoint: "http://localhost:9010", listPrefix: "" })).not.toThrow();
  });

  it("seed writes are refused on non-local endpoints", () => {
    expect(() => assertLocalForWrites("https://s3.example.com", "seed:samples")).toThrow(/refuses to write/);
    expect(() => assertLocalForWrites(undefined, "seed:samples")).toThrow(ScopeError);
    expect(() => assertLocalForWrites("http://127.0.0.1:9010", "seed:samples")).not.toThrow();
  });
});

describe("MEDIA_S3_PREFIX mapping", () => {
  it("apply/strip are inverse; DB keys stay logical", () => {
    expect(applyKeyPrefix("", "hls/a/master.m3u8")).toBe("hls/a/master.m3u8");
    expect(applyKeyPrefix("streaming", "hls/a/master.m3u8")).toBe("streaming/hls/a/master.m3u8");
    expect(applyKeyPrefix("streaming/", "/hls/a/x.ts")).toBe("streaming/hls/a/x.ts");
    expect(stripKeyPrefix("streaming/", "streaming/hls/a/x.ts")).toBe("hls/a/x.ts");
    expect(stripKeyPrefix("streaming/", "other/hls/a/x.ts")).toBeNull();
    expect(stripKeyPrefix("", "hls/a/x.ts")).toBe("hls/a/x.ts");
  });

  it("bucket helpers send physical keys and list logical keys", async () => {
    const client = new S3Client({ region: "us-east-1", credentials: { accessKeyId: "x", secretAccessKey: "y" } });
    const send = vi.fn(async (cmd: { input: { Prefix?: string } }) => ({
      Contents: [{ Key: "streaming/hls/a/master.m3u8" }, { Key: "streaming/hls/a/360p/seg_00000.ts" }, { Key: "streaming/hls/ab/x.ts" }],
      IsTruncated: false,
      _prefix: cmd.input.Prefix,
    }));
    (client as unknown as { send: typeof send }).send = send;
    const b: Bucket = { client, name: "shared", keyPrefix: "streaming/" };
    expect(physicalKey(b, "hls/a/master.m3u8")).toBe("streaming/hls/a/master.m3u8");
    const keys: string[] = [];
    for await (const o of listAllObjects(b, "hls/a/")) keys.push(o.Key!);
    expect(send.mock.calls[0]![0].input.Prefix).toBe("streaming/hls/a/");
    expect(keys).toEqual(["hls/a/master.m3u8", "hls/a/360p/seg_00000.ts"]);
  });
});
