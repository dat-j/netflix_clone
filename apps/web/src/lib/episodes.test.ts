import type { EpisodeRef, WatchProgressDto } from "@app/shared";
import { describe, expect, it } from "vitest";
import { episodeCode, episodeLabel, episodeName, playAction, watchUrl } from "./episodes";

const ep = (s: number, e: number, name: string | null = null, id = `e${s}${e}`): EpisodeRef => ({
  id,
  seasonNumber: s,
  episodeNumber: e,
  name,
  still: null,
  runtimeMinutes: 45,
});
const progress = (p: Partial<WatchProgressDto>): WatchProgressDto => ({
  positionSec: 600,
  durationSec: 2700,
  ratio: 0.22,
  completed: false,
  episodeId: null,
  updatedAt: "",
  ...p,
});

describe("episode labels", () => {
  it("formats", () => {
    expect(episodeCode(ep(1, 3))).toBe("T1:E3");
    expect(episodeCode(null)).toBeNull();
    expect(episodeLabel(ep(2, 10, "Đêm trắng"))).toBe("T2:E10 · Đêm trắng");
    expect(episodeLabel(ep(1, 1, "  "))).toBe("T1:E1");
    expect(episodeLabel(undefined)).toBeNull();
    expect(episodeName({ episodeNumber: 4, name: null })).toBe("Tập 4");
    expect(episodeName({ episodeNumber: 4, name: "Bão" })).toBe("Bão");
  });
  it("watch urls", () => {
    expect(watchUrl("t1")).toBe("/watch/t1");
    expect(watchUrl("t1", "e 1")).toBe("/watch/t1?episode=e%201");
  });
});

describe("play button", () => {
  const series = { id: "t1", type: "SERIES" as const };
  it("series: fresh start, resume, next episode", () => {
    expect(playAction({ ...series, progress: null, resumeEpisode: ep(1, 1) })).toEqual({ href: "/watch/t1?episode=e11", label: "Phát", resume: false });
    expect(playAction({ ...series, progress: null, resumeEpisode: ep(2, 1) }).label).toBe("Phát T2:E1");
    expect(playAction({ ...series, progress: progress({ episodeId: "e13" }), resumeEpisode: ep(1, 3) })).toEqual({
      href: "/watch/t1?episode=e13",
      label: "Tiếp tục T1:E3",
      resume: true,
    });
    // last episode finished → resume episode is the next one
    expect(playAction({ ...series, progress: progress({ episodeId: "e13", completed: true }), resumeEpisode: ep(1, 4) }).label).toBe("Phát T1:E4");
  });
  it("series card without detail: in-progress episode or let the API pick", () => {
    expect(playAction({ ...series, progress: progress({ episodeId: "e13" }) }).href).toBe("/watch/t1?episode=e13");
    expect(playAction({ ...series, progress: progress({ episodeId: "e13", completed: true }) }).href).toBe("/watch/t1");
    expect(playAction({ ...series, progress: null }).href).toBe("/watch/t1");
  });
  it("movie", () => {
    expect(playAction({ id: "m", type: "MOVIE", progress: null })).toEqual({ href: "/watch/m", label: "Phát", resume: false });
    expect(playAction({ id: "m", type: "MOVIE", progress: progress({}) }).label).toBe("Tiếp tục");
    expect(playAction({ id: "m", type: "MOVIE", progress: progress({ positionSec: 5 }) }).label).toBe("Phát");
  });
});
