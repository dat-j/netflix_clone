import { describe, expect, it } from "vitest";
import {
  CALLBACK_MAX_BYTES, decode, encode, parseStartPayload, shortToUuid, startPayloadForTitle, uuidToShort, type Action,
} from "../src/lib/callback.js";

const ID = "01a1e3ee-ddff-778e-87e2-24a9c49e6f69";

describe("uuid <-> short id", () => {
  it("round-trips and is 22 chars", () => {
    const s = uuidToShort(ID);
    expect(s).toHaveLength(22);
    expect(shortToUuid(s)).toBe(ID);
  });
  it("rejects garbage and non-canonical encodings", () => {
    expect(shortToUuid("abc")).toBeNull();
    expect(shortToUuid("!!!!!!!!!!!!!!!!!!!!!!")).toBeNull();
    const s = uuidToShort(ID);
    // flip the last char's unused low bits → same bytes, different string
    const last = s.at(-1)!;
    const alt = s.slice(0, -1) + (last === "p" ? "q" : "p");
    if (Buffer.from(alt, "base64url").equals(Buffer.from(s, "base64url"))) expect(shortToUuid(alt)).toBeNull();
    expect(() => uuidToShort("not-a-uuid")).toThrow();
  });
});

describe("encode/decode", () => {
  const cases: Action[] = [
    { a: "home" }, { a: "noop" }, { a: "search" }, { a: "help" },
    { a: "genres", page: 2 },
    { a: "list", list: { kind: "movies" }, page: 1 },
    { a: "list", list: { kind: "series" }, page: 12 },
    { a: "list", list: { kind: "new" }, page: 3 },
    { a: "list", list: { kind: "hot" }, page: 9999 },
    { a: "list", list: { kind: "genre", slug: "khoa-hoc-vien-tuong" }, page: 4 },
    { a: "list", list: { kind: "search", qid: "AbC_-12345" }, page: 1 },
    { a: "detail", id: ID },
    { a: "detail", id: ID, back: { list: { kind: "genre", slug: "khoa-hoc-vien-tuong" }, page: 123 } },
    { a: "detail", id: ID, back: { list: { kind: "search", qid: "AbC_-12345" }, page: 2 } },
  ];
  it.each(cases)("round-trips %j within 64 bytes", (a) => {
    const s = encode(a);
    expect(Buffer.byteLength(s)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
    expect(decode(s)).toEqual(a);
  });
  it("is compact", () => {
    expect(encode({ a: "list", list: { kind: "movies" }, page: 2 })).toBe("L:m:2");
    expect(encode({ a: "detail", id: ID, back: { list: { kind: "hot" }, page: 3 } })).toMatch(/^D:[A-Za-z0-9_-]{22}:t:3$/);
  });
  it("drops the back-reference instead of overflowing 64 bytes", () => {
    const slug = "a".repeat(45);
    const s = encode({ a: "detail", id: ID, back: { list: { kind: "genre", slug }, page: 1 } });
    expect(Buffer.byteLength(s)).toBeLessThanOrEqual(64);
    expect(decode(s)).toEqual({ a: "detail", id: ID });
  });
  it("clamps pages", () => {
    expect(encode({ a: "list", list: { kind: "movies" }, page: 0 })).toBe("L:m:1");
    expect(encode({ a: "list", list: { kind: "movies" }, page: 1e9 })).toBe("L:m:9999");
  });
  it("refuses invalid slugs / query ids when encoding", () => {
    expect(() => encode({ a: "list", list: { kind: "genre", slug: "Bad Slug" }, page: 1 })).toThrow();
    expect(() => encode({ a: "list", list: { kind: "search", qid: "x" }, page: 1 })).toThrow();
  });
  it.each([
    undefined, null, "", "garbage", "L", "L:m", "L:m:0", "L:m:01", "L:m:-1", "L:m:1:extra", "L:z:1", "L:g.:1", "L:g.Bad:1",
    "L:g.a--b:1", "L:q.<script>:1", "G:x", "G:0", "D:", "D:short", "D:" + "A".repeat(22) + ":m", "D:" + "!".repeat(22),
    "h:1", "x".repeat(65), "L:m:10000",
  ])("rejects %j", (s) => {
    expect(decode(s as string)).toBeNull();
  });
});

describe("start payloads", () => {
  it("round-trips titles and fits Telegram's 64-char limit", () => {
    const p = startPayloadForTitle(ID);
    expect(p).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(parseStartPayload(p)).toEqual({ a: "detail", id: ID });
  });
  it("maps named payloads and ignores unknown ones", () => {
    expect(parseStartPayload("hot")).toEqual({ a: "list", list: { kind: "hot" }, page: 1 });
    expect(parseStartPayload("moi")).toEqual({ a: "list", list: { kind: "new" }, page: 1 });
    expect(parseStartPayload("whatever")).toBeNull();
    expect(parseStartPayload("d_nope")).toBeNull();
    expect(parseStartPayload(undefined)).toBeNull();
  });
});
