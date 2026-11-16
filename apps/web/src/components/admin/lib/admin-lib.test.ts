import { describe, expect, it } from "vitest";
import type { AdminTitle } from "@app/shared";
import { basename, formatBytes, formatDuration, formatRelative, moveItem, normalizeProgress } from "./format";
import { diffTitleInput, grantFormSchema, parsedToInput, planFormSchema, planToForm, titleFormSchema, titleToForm } from "./schemas";

describe("format", () => {
  it("formatBytes handles bigint strings and units", () => {
    expect(formatBytes("0")).toBe("0 B");
    expect(formatBytes("1536")).toBe("1,5 KB");
    expect(formatBytes("10737418240")).toBe("10 GB");
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes("abc")).toBe("—");
  });
  it("formatDuration", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(null)).toBe("—");
  });
  it("normalizeProgress accepts fraction or percent", () => {
    expect(normalizeProgress(0.42)).toBeCloseTo(42);
    expect(normalizeProgress(42)).toBe(42);
    expect(normalizeProgress(140)).toBe(100);
    expect(normalizeProgress(undefined)).toBe(0);
  });
  it("formatRelative", () => {
    const now = Date.parse("2026-11-16T10:00:00Z");
    expect(formatRelative("2026-11-16T09:59:50Z", now)).toBe("vừa xong");
    expect(formatRelative("2026-11-16T09:50:00Z", now)).toBe("10 phút trước");
    expect(formatRelative("2026-11-16T07:00:00Z", now)).toBe("3 giờ trước");
  });
  it("moveItem", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    expect(moveItem([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
  });
  it("basename", () => {
    expect(basename("a/b/c.mp4")).toBe("c.mp4");
    expect(basename("c.mp4")).toBe("c.mp4");
  });
});

const title: AdminTitle = {
  id: "t1",
  slug: "phim-a",
  type: "MOVIE",
  tmdbId: 1,
  name: "Phim A",
  originalName: null,
  tagline: null,
  overview: "Mô tả",
  releaseDate: "2020-01-02T00:00:00.000Z",
  runtimeMinutes: 100,
  maturityRating: "T13",
  countries: ["VN"],
  status: "DRAFT",
  publishedAt: null,
  overriddenFields: [],
  genres: [{ id: "g1", slug: "hanh-dong", name: "Hành động" }],
  images: [],
  mainAsset: null,
  previewAsset: null,
  createdAt: "",
  updatedAt: "",
};

describe("title form", () => {
  it("round-trips and diffs only changed fields", () => {
    const form = titleToForm(title);
    expect(form.releaseDate).toBe("2020-01-02");
    const unchanged = parsedToInput(titleFormSchema.parse(form));
    expect(diffTitleInput(title, unchanged)).toEqual({});
    const changed = parsedToInput(titleFormSchema.parse({ ...form, name: "Phim B", countries: "vn, us", genreIds: ["g1", "g2"] }));
    expect(diffTitleInput(title, changed)).toEqual({ name: "Phim B", countries: ["VN", "US"], genreIds: ["g1", "g2"] });
  });
  it("validates", () => {
    const r = titleFormSchema.safeParse({ ...titleToForm(null), name: " ", slug: "Bad Slug", runtimeMinutes: "x", countries: "Vietnam" });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["name", "slug", "runtimeMinutes", "countries"]));
  });
});

describe("plan + grant forms", () => {
  it("parses plan numbers", () => {
    const v = planFormSchema.parse({ ...planToForm(null), code: "basic", name: "Cơ bản", priceAmount: "70000" });
    expect(v).toMatchObject({ priceAmount: 70000, maxHeight: 1080, intervalMonths: 1, description: null });
  });
  it("grant months bounds", () => {
    expect(grantFormSchema.safeParse({ planCode: "standard", months: "0", note: "" }).success).toBe(false);
    expect(grantFormSchema.parse({ planCode: "standard", months: "3", note: "" })).toEqual({ planCode: "standard", months: 3, note: undefined });
  });
});
