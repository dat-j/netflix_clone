import { describe, expect, it } from "vitest";
import type { TitleCard, TitleDetail } from "../src/catalog.js";
import { detailCaption, fitCaption, lengthLabel, listCaption, runtimeLabel } from "../src/lib/format.js";
import { paginate } from "../src/lib/pagination.js";
import { CAPTION_LIMIT, visibleLength } from "../src/lib/text.js";

const card = (over: Partial<TitleCard> = {}): TitleCard => ({
  id: "01a1e3ee-ddff-778e-87e2-24a9c49e6f69", slug: "x", type: "MOVIE", name: "Người Gác Đèn Biển", year: 2025,
  runtimeMinutes: 118, maturityRating: "T13", rating: 8.1, genres: ["Chính kịch"], posterKey: null, backdropKey: null,
  logoKey: null, overview: "Ánh sáng cuối cùng.", ...over,
});
const detail = (over: Partial<TitleDetail> = {}): TitleDetail => ({
  ...card(), originalName: null, tagline: null, countries: ["VN"], genreList: [{ slug: "chinh-kich", name: "Chính kịch" }],
  directors: ["A"], cast: ["B", "C"], playable: true, maxHeight: 1080, seasons: [], ...over,
});

describe("labels", () => {
  it("formats runtime and series length", () => {
    expect(runtimeLabel(118)).toBe("1 giờ 58 phút");
    expect(runtimeLabel(45)).toBe("45 phút");
    expect(runtimeLabel(120)).toBe("2 giờ");
    expect(runtimeLabel(null)).toBeNull();
    expect(lengthLabel(detail({ type: "SERIES", seasons: [] }))).toBeNull();
    expect(lengthLabel(detail({ type: "SERIES", seasons: [
      { seasonNumber: 1, name: null, episodes: [{ episodeNumber: 1, name: null, playable: true }, { episodeNumber: 2, name: null, playable: false }] },
      { seasonNumber: 2, name: null, episodes: [{ episodeNumber: 1, name: null, playable: false }] },
    ] }))).toBe("2 mùa · 3 tập");
  });
});

describe("detail caption", () => {
  it("contains the key facts", () => {
    const c = detailCaption(detail());
    expect(c).toContain("<b>Người Gác Đèn Biển</b> (2025)");
    expect(c).toContain("Phim lẻ · 1 giờ 58 phút · T13");
    expect(c).toContain("Chính kịch");
    expect(c).toContain("✅ Xem được ngay");
    expect(c).toContain("Full HD");
  });
  it("marks unplayable titles", () => {
    expect(detailCaption(detail({ playable: false, maxHeight: null }))).toContain("⏳ Sắp có");
  });
  it("escapes HTML in user-visible data", () => {
    const c = detailCaption(detail({ name: "<script>&", overview: "a < b & c > d" }));
    expect(c).toContain("&lt;script&gt;&amp;");
    expect(c).toContain("a &lt; b &amp; c &gt; d");
    expect(c).not.toContain("<script>");
  });
  it("never exceeds 1024 visible characters, even with huge data", () => {
    const huge = detail({
      name: "Tên ".repeat(100), originalName: "Orig ".repeat(100), overview: "Rất dài & <đặc biệt> ".repeat(500),
      cast: Array.from({ length: 50 }, (_, i) => `Diễn viên số ${i}`), directors: ["Đạo diễn ".repeat(40)],
      genreList: Array.from({ length: 30 }, (_, i) => ({ slug: `g${i}`, name: `Thể loại ${i}` })),
      type: "SERIES",
      seasons: Array.from({ length: 12 }, (_, i) => ({ seasonNumber: i + 1, name: `Mùa ${"x".repeat(80)}`, episodes: [] })),
    });
    const c = detailCaption(huge);
    expect(visibleLength(c)).toBeLessThanOrEqual(CAPTION_LIMIT);
  });
  it("keeps the synopsis when there is room", () => {
    const c = detailCaption(detail({ overview: "Một câu chuyện cảm động." }));
    expect(c.endsWith("Một câu chuyện cảm động.")).toBe(true);
  });
});

describe("list caption", () => {
  it("numbers items globally across pages", () => {
    const p = paginate(10, 2);
    const c = listCaption("Phim lẻ", "🎬", p, [card({ name: "A" }), card({ name: "B" })]);
    expect(c).toContain("trang 2/3");
    expect(c).toContain("<b>5.</b> <b>A</b>");
    expect(c).toContain("<b>6.</b> <b>B</b>");
    expect(visibleLength(c)).toBeLessThanOrEqual(CAPTION_LIMIT);
  });
  it("handles empty lists", () => {
    expect(listCaption("Phim bộ", "📺", paginate(0, 1), [])).toContain("Chưa có phim");
  });
  it("fitCaption trims overly long captions", () => {
    const long = Array.from({ length: 200 }, (_, i) => `<b>dòng ${i}</b>`).join("\n");
    expect(visibleLength(fitCaption(long))).toBeLessThanOrEqual(CAPTION_LIMIT);
    expect(visibleLength(fitCaption("x".repeat(5000)))).toBeLessThanOrEqual(CAPTION_LIMIT);
  });
});
