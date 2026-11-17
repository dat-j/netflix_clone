import { describe, expect, it } from "vitest";
import type { EpisodeInfo, TitleCard, TitleDetail } from "../src/catalog.js";
import {
  cardMeta, detailCaption, episodeCaption, episodeHeading, episodesCaption, firstEpisode, fitCaption, lengthLabel, listCaption, runtimeLabel,
} from "../src/lib/format.js";
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

const ep = (n: number, over: Partial<EpisodeInfo> = {}): EpisodeInfo => ({
  id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`, episodeNumber: n, name: `Tên tập ${n}`, overview: null,
  runtimeMinutes: 45, stillKey: null, playable: true, ...over,
});

describe("labels", () => {
  it("formats runtime and series length", () => {
    expect(runtimeLabel(118)).toBe("1 giờ 58 phút");
    expect(runtimeLabel(45)).toBe("45 phút");
    expect(runtimeLabel(120)).toBe("2 giờ");
    expect(runtimeLabel(null)).toBeNull();
    expect(lengthLabel(detail({ type: "SERIES", seasons: [] }))).toBeNull();
    expect(lengthLabel(detail({ type: "SERIES", seasons: [
      { seasonNumber: 1, name: null, episodes: [ep(1), ep(2, { playable: false })] },
      { seasonNumber: 2, name: null, episodes: [ep(1, { playable: false })] },
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

describe("series captions", () => {
  const series = (over: Partial<TitleDetail> = {}) => detail({
    type: "SERIES", name: "Phố Cổ Tình Nhân", seasonCount: 2,
    seasons: [
      { seasonNumber: 1, name: "Mùa 1", episodes: Array.from({ length: 14 }, (_, i) => ep(i + 1)) },
      { seasonNumber: 2, name: "Hồi kết", episodes: [ep(1), ep(2, { playable: false, runtimeMinutes: null })] },
    ],
    ...over,
  });
  it("series cards show the season count", () => {
    expect(cardMeta(card({ type: "SERIES", seasonCount: 3, rating: null }))).toBe("2025 · Phim bộ · 3 mùa");
    expect(cardMeta(card({ type: "SERIES", seasonCount: 0, rating: null }))).toBe("2025 · Phim bộ");
  });
  it("detail shows N mùa · M tập and the generic resume hint", () => {
    const c = detailCaption(series());
    expect(c).toContain("Phim bộ · 2 mùa · 16 tập");
    expect(c).toContain("• Mùa 1: 14 tập\n• Mùa 2 (Hồi kết): 2 tập");
    expect(c).toContain("Xem ngay</i> mở Mùa 1 · Tập 1");
    expect(c).toContain("tiếp tục tập bạn đang xem dở");
  });
  it("detail of a series with no published episodes says so", () => {
    expect(detailCaption(series({ seasons: [], playable: false }))).toContain("Chưa có tập nào được phát hành");
  });
  it("first episode skips specials and unplayable episodes", () => {
    const d = series({ seasons: [
      { seasonNumber: 1, name: null, episodes: [ep(1, { playable: false }), ep(2)] },
      { seasonNumber: 0, name: null, episodes: [ep(1)] },
    ] });
    expect(firstEpisode(d)).toMatchObject({ season: { seasonNumber: 1 }, episode: { episodeNumber: 2 } });
    expect(firstEpisode(series({ seasons: [] }))).toBeNull();
  });
  it("episode heading omits generic names", () => {
    expect(episodeHeading(1, { episodeNumber: 3, name: "Đêm trắng" })).toBe("Mùa 1 · Tập 3 — Đêm trắng");
    expect(episodeHeading(2, { episodeNumber: 3, name: "Episode 3" })).toBe("Mùa 2 · Tập 3");
    expect(episodeHeading(0, { episodeNumber: 1, name: null })).toBe("Đặc biệt · Tập 1");
  });
  it("picker caption lists this page's episodes", () => {
    const d = series();
    const c = episodesCaption(d, d.seasons[0]!, paginate(14, 2, 12));
    expect(c).toContain("Mùa 1 · 14 tập · trang 2/2");
    expect(c).toContain("<b>13.</b> Tên tập 13");
    expect(c).not.toContain("<b>12.</b>");
    const c2 = episodesCaption(d, d.seasons[1]!, paginate(2, 1, 12));
    expect(c2).toContain("<i>(Hồi kết)</i>");
    expect(c2).toContain("⏳ sắp có");
  });
  it("episode caption has heading, runtime, synopsis and position, within the limit", () => {
    const d = series();
    const e1 = { ...d.seasons[0]!.episodes[2]!, overview: "Một đêm & <mưa>." };
    const c = episodeCaption(d, { ...d.seasons[0]!, episodes: d.seasons[0]!.episodes.map((x, i) => (i === 2 ? e1 : x)) }, e1);
    expect(c).toContain("<b>Mùa 1 · Tập 3 — Tên tập 3</b>");
    expect(c).toContain("⏱ 45 phút · ✅ Xem được ngay");
    expect(c).toContain("Một đêm &amp; &lt;mưa&gt;.");
    expect(c).toContain("Tập 3/14 của Mùa 1");
    const huge = { ...e1, name: "Tên ".repeat(200), overview: "Rất dài ".repeat(500) };
    expect(visibleLength(episodeCaption(d, { ...d.seasons[0]!, episodes: [huge] }, huge))).toBeLessThanOrEqual(CAPTION_LIMIT);
  });
});
