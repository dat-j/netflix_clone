import type { AdminEpisode, AdminSeason, MediaAssetDto } from "@app/shared";
import { describe, expect, it } from "vitest";
import { formatMmSs, parseMmSs } from "./format";
import {
  diffEpisodeInput,
  episodePublishBlockReason,
  episodeToForm,
  isEpisodeReady,
  nextEpisodeNumber,
  nextSeasonNumber,
  parseEpisodeForm,
  readyEpisodeCount,
  seriesCountsLabel,
  seriesPublishBlockReason,
} from "./series";

const asset = (status: MediaAssetDto["status"], durationSec = 2700): MediaAssetDto => ({
  id: "a",
  kind: "MAIN",
  status,
  durationSec,
  sourceKey: "streaming/source/s01e01.mkv",
  renditions: [],
  errorMessage: null,
  latestJob: null,
});
const episode = (n: number, p: Partial<AdminEpisode> = {}): AdminEpisode => ({
  id: `e${n}`,
  seasonId: "s1",
  seasonNumber: 1,
  episodeNumber: n,
  name: null,
  overview: null,
  runtimeMinutes: null,
  airDate: null,
  status: "DRAFT",
  introStartSec: null,
  introEndSec: null,
  creditsStartSec: null,
  still: null,
  mainAsset: null,
  ...p,
});

describe("mm:ss", () => {
  it("formats", () => {
    expect(formatMmSs(90)).toBe("1:30");
    expect(formatMmSs(3725)).toBe("1:02:05");
    expect(formatMmSs(null)).toBe("");
  });
  it("parses", () => {
    expect(parseMmSs("1:30")).toBe(90);
    expect(parseMmSs("01:30")).toBe(90);
    expect(parseMmSs("0:05")).toBe(5);
    expect(parseMmSs("1:02:05")).toBe(3725);
    expect(parseMmSs("95")).toBe(95);
    expect(parseMmSs("  ")).toBeNull();
    expect(parseMmSs("1:75")).toBeUndefined();
    expect(parseMmSs("1:60:00")).toBeUndefined();
    expect(parseMmSs("abc")).toBeUndefined();
    expect(parseMmSs("1.5")).toBeUndefined();
  });
});

describe("episode rules", () => {
  it("readiness + publish block", () => {
    expect(episodePublishBlockReason(episode(1))).toMatch(/Chưa gắn video/);
    expect(episodePublishBlockReason(episode(1, { mainAsset: asset("PROCESSING") }))).toMatch(/transcode/);
    expect(episodePublishBlockReason(episode(1, { mainAsset: asset("READY") }))).toBeNull();
    expect(isEpisodeReady(episode(1, { mainAsset: asset("READY") }))).toBe(true);
    expect(isEpisodeReady(episode(1, { mainAsset: asset("READY"), status: "PUBLISHED" }))).toBe(false);
    const season = { episodes: [episode(1, { mainAsset: asset("READY") }), episode(2, { mainAsset: asset("READY"), status: "PUBLISHED" }), episode(5)] } as AdminSeason;
    expect(readyEpisodeCount(season)).toBe(1);
    expect(nextEpisodeNumber(season)).toBe(6);
    expect(nextEpisodeNumber({ episodes: [] })).toBe(1);
    expect(nextSeasonNumber([{ seasonNumber: 1 }, { seasonNumber: 3 }])).toBe(4);
  });
  it("series publish rule + counts", () => {
    expect(seriesPublishBlockReason({ status: "DRAFT", publishedEpisodeCount: 0, episodeCount: 0 })).toMatch(/ít nhất 1 tập/);
    expect(seriesPublishBlockReason({ status: "DRAFT", publishedEpisodeCount: 0, episodeCount: 8 })).toMatch(/transcode/);
    expect(seriesPublishBlockReason({ status: "DRAFT", publishedEpisodeCount: 1, episodeCount: 8 })).toBeNull();
    expect(seriesCountsLabel({ type: "SERIES", seasonCount: 2, episodeCount: 18, publishedEpisodeCount: 3 })).toBe("2 mùa · 18 tập");
    expect(seriesCountsLabel({ type: "SERIES", seasonCount: 0, episodeCount: 0, publishedEpisodeCount: 0 })).toBe("Chưa có tập");
    expect(seriesCountsLabel({ type: "MOVIE", seasonCount: 0, episodeCount: 0, publishedEpisodeCount: 0 })).toBe("—");
  });
});

describe("episode form", () => {
  const ep = episode(3, { name: "Cũ", introStartSec: 30, introEndSec: 90, airDate: "2024-03-01T00:00:00.000Z", mainAsset: asset("READY", 2700) });
  it("round-trips and diffs only changes", () => {
    const form = episodeToForm(ep);
    expect(form).toMatchObject({ introStart: "0:30", introEnd: "1:30", creditsStart: "", airDate: "2024-03-01" });
    const parsed = parseEpisodeForm(form, 2700);
    if (!("input" in parsed)) throw new Error("should parse");
    expect(diffEpisodeInput(ep, parsed.input)).toEqual({});
    const changed = parseEpisodeForm({ ...form, name: "Mới", creditsStart: "42:10", runtimeMinutes: "45" }, 2700);
    if (!("input" in changed)) throw new Error("should parse");
    expect(diffEpisodeInput(ep, changed.input)).toEqual({ name: "Mới", creditsStartSec: 2530, runtimeMinutes: 45 });
  });
  it("validates markers", () => {
    const form = episodeToForm(ep);
    const bad = parseEpisodeForm({ ...form, introEnd: "0:20", creditsStart: "99:00", episodeNumber: "0" }, 2700);
    expect("errors" in bad && bad.errors).toMatchObject({ introEnd: expect.any(String), creditsStart: expect.stringMatching(/Vượt quá/), episodeNumber: expect.any(String) });
    const missingEnd = parseEpisodeForm({ ...form, introEnd: "" });
    expect("errors" in missingEnd && missingEnd.errors.introEnd).toBeTruthy();
    const garbage = parseEpisodeForm({ ...form, introStart: "1:99" });
    expect("errors" in garbage && garbage.errors.introStart).toMatch(/m:ss/);
  });
});
