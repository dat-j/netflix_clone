import { describe, expect, it } from "vitest";
import { escapeHtml, normalizeQuery, queryKey, stripAccents, truncate, visibleLength } from "../src/lib/text.js";
import { SearchStore } from "../src/lib/search-store.js";
import { MemoryKV } from "../src/lib/kv.js";

describe("search normalisation", () => {
  it("trims, collapses whitespace and strips commands", () => {
    expect(normalizeQuery("  người   gác\n đèn  ")).toBe("người gác đèn");
    expect(normalizeQuery("/search nguoi gac den")).toBe("nguoi gac den");
    expect(normalizeQuery("/search@boxphim_bot  Bão Lửa")).toBe("Bão Lửa");
    expect(normalizeQuery("a\u0000b")).toBe("a b");
    expect(normalizeQuery("x".repeat(300))).toHaveLength(100);
    expect(normalizeQuery(undefined)).toBe("");
  });
  it("strips Vietnamese accents including đ", () => {
    expect(stripAccents("Người Gác Đèn Biển")).toBe("Nguoi Gac Den Bien");
    expect(queryKey("  NGƯỜI gác  đèn ")).toBe("nguoi gac den");
  });
  it("gives accent/case-insensitive search ids", async () => {
    expect(SearchStore.idFor("Người Gác Đèn")).toBe(SearchStore.idFor("nguoi gac den"));
    const s = new SearchStore(new MemoryKV());
    const { qid, query } = await s.put("  Bão  Lửa ");
    expect(query).toBe("Bão Lửa");
    expect(qid).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(await s.get(qid)).toBe("Bão Lửa");
  });
});

describe("html + lengths", () => {
  it("escapes HTML", () => {
    expect(escapeHtml(`<b>"Tom & Jerry"</b>`)).toBe("&lt;b&gt;&quot;Tom &amp; Jerry&quot;&lt;/b&gt;");
  });
  it("counts visible length like Telegram (tags removed, entities = 1 char)", () => {
    expect(visibleLength("<b>a&amp;b</b>")).toBe(3);
    expect(visibleLength("😀")).toBe(2); // UTF-16 units
  });
  it("truncates on word boundaries without splitting surrogate pairs", () => {
    expect(truncate("một hai ba bốn năm sáu", 12)).toBe("một hai ba…");
    expect(truncate("short", 10)).toBe("short");
    const t = truncate("😀😀😀😀😀😀", 6);
    expect(t.length).toBeLessThanOrEqual(6);
    expect(/[\uD800-\uDBFF]…$/.test(t)).toBe(false);
  });
});
