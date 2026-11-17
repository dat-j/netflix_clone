import { describe, expect, it } from "vitest";
import { clamp, episodeLabel, formatClock, formatRemainingClock, formatSpokenTime, qualityName } from "./format";
import { commandForKey, isEditableTarget } from "./keymap";
import { backoffDelay, levelForHeight, sanitizePrefs } from "./prefs";
import { currentQualityLabel, initialPlayerState, isPausedIdle, playerReducer, type PlayerAction, type PlayerState } from "./state";
import { activeCues, findCueAt, parseSubtitleVtt, parseThumbnailVtt, parseTimestamp } from "./vtt";

describe("format", () => {
  it("formats clocks", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5.9)).toBe("0:05");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(NaN)).toBe("0:00");
    expect(formatClock(-3)).toBe("0:00");
  });
  it("formats remaining time", () => {
    expect(formatRemainingClock(10, 48)).toBe("-0:38");
    expect(formatRemainingClock(47.5, 48)).toBe("-0:01");
    expect(formatRemainingClock(60, 48)).toBe("-0:00");
  });
  it("formats spoken time, quality, episode", () => {
    expect(formatSpokenTime(3725)).toBe("1 giờ 2 phút 5 giây");
    expect(formatSpokenTime(0)).toBe("0 giây");
    expect(qualityName(1080)).toBe("1080p (Full HD)");
    expect(qualityName(480)).toBe("480p");
    expect(clamp(5, 0, 3)).toBe(3);
    expect(episodeLabel({ seasonNumber: 1, episodeNumber: 3, name: "Khởi đầu" })).toBe("T1:E3 · Khởi đầu");
    expect(episodeLabel(null)).toBeNull();
  });
});

describe("vtt", () => {
  const VTT = `WEBVTT

00:00:00.000 --> 00:00:10.000
sprite_001.jpg#xywh=0,0,160,90

00:00:10.000 --> 00:00:20.000
sprite_001.jpg#xywh=160,0,160,90

00:20.000 --> 00:30.000
sub/sprite_002.jpg#xywh=0,90,160,90

00:00:30.000 --> 00:00:40.000
broken.jpg#xywh=1,2,3
`;
  const base = "http://cdn.test/s/tok/123/hls/a/thumbs/thumbs.vtt";

  it("parses timestamps", () => {
    expect(parseTimestamp("00:01:02.500")).toBe(62.5);
    expect(parseTimestamp("01:02.5")).toBe(62.5);
    expect(parseTimestamp("1:00:00,000")).toBe(3600);
    expect(parseTimestamp("nope")).toBeNaN();
  });

  it("parses sprite cues and resolves URLs against the VTT", () => {
    const cues = parseThumbnailVtt(VTT, base);
    expect(cues).toHaveLength(3);
    expect(cues[1]).toEqual({ start: 10, end: 20, url: "http://cdn.test/s/tok/123/hls/a/thumbs/sprite_001.jpg", x: 160, y: 0, w: 160, h: 90 });
    expect(cues[2].url).toBe("http://cdn.test/s/tok/123/hls/a/thumbs/sub/sprite_002.jpg");
  });

  it("handles CRLF + BOM", () => {
    expect(parseThumbnailVtt("﻿WEBVTT\r\n\r\n00:00.000 --> 00:05.000\r\na.jpg#xywh=1,2,3,4\r\n", base)).toHaveLength(1);
  });

  it("finds the cue at a time", () => {
    const cues = parseThumbnailVtt(VTT, base);
    expect(findCueAt(cues, 0)?.x).toBe(0);
    expect(findCueAt(cues, 15)?.x).toBe(160);
    expect(findCueAt(cues, 29.99)?.y).toBe(90);
    expect(findCueAt(cues, 999)?.y).toBe(90); // past the end → last
    expect(findCueAt([], 3)).toBeNull();
  });

  it("parses subtitles with settings and tags", () => {
    const subs = parseSubtitleVtt(`WEBVTT

1
00:00:01.000 --> 00:00:03.000 line:90% align:center
<i>Xin chào</i> &amp; tạm biệt
dòng hai

00:00:02.500 --> 00:00:04.000
Chồng lấn
`);
    expect(subs).toEqual([
      { start: 1, end: 3, text: "Xin chào & tạm biệt\ndòng hai" },
      { start: 2.5, end: 4, text: "Chồng lấn" },
    ]);
    expect(activeCues(subs, 2.7)).toHaveLength(2);
    expect(activeCues(subs, 3)).toHaveLength(1);
  });
});

describe("keymap", () => {
  it("maps keys", () => {
    expect(commandForKey({ key: " " })).toEqual({ type: "togglePlay" });
    expect(commandForKey({ key: "K" })).toEqual({ type: "togglePlay" });
    expect(commandForKey({ key: "ArrowLeft" })).toEqual({ type: "seekBy", seconds: -10 });
    expect(commandForKey({ key: "ArrowRight" })).toEqual({ type: "seekBy", seconds: 10 });
    expect(commandForKey({ key: "ArrowUp" })).toEqual({ type: "volumeBy", delta: 0.1 });
    expect(commandForKey({ key: "m" })).toEqual({ type: "toggleMute" });
    expect(commandForKey({ key: "f" })).toEqual({ type: "toggleFullscreen" });
    expect(commandForKey({ key: "Escape" })).toEqual({ type: "escape" });
    expect(commandForKey({ key: "5" })).toEqual({ type: "seekToFraction", fraction: 0.5 });
    expect(commandForKey({ key: "0" })).toEqual({ type: "seekToFraction", fraction: 0 });
  });
  it("ignores modifiers and unknown keys", () => {
    expect(commandForKey({ key: "f", ctrlKey: true })).toBeNull();
    expect(commandForKey({ key: "ArrowLeft", altKey: true })).toBeNull();
    expect(commandForKey({ key: "q" })).toBeNull();
  });
  it("detects editable targets", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: "BUTTON", isContentEditable: false } as unknown as EventTarget)).toBe(false);
  });
});

describe("prefs", () => {
  it("sanitizes stored prefs", () => {
    expect(sanitizePrefs({ volume: 3, muted: "x", rate: 7, qualityHeight: 720 })).toEqual({
      volume: 1, muted: false, rate: 1, qualityHeight: 720, subtitleLang: null, subtitlesOff: false, audioLang: null,
    });
    expect(sanitizePrefs(null).volume).toBe(1);
    expect(sanitizePrefs({ volume: 0.4, rate: 1.5, muted: true }).rate).toBe(1.5);
  });
  it("backs off exponentially with a cap", () => {
    expect([0, 1, 2, 3, 4, 10].map((a) => backoffDelay(a))).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
  });
  it("maps preferred heights to levels", () => {
    const levels = [{ index: 0, height: 360 }, { index: 1, height: 480 }, { index: 2, height: 720 }];
    expect(levelForHeight(levels, null)).toBe(-1);
    expect(levelForHeight(levels, 720)).toBe(2);
    expect(levelForHeight(levels, 1080)).toBe(2);
    expect(levelForHeight(levels, 240)).toBe(0);
  });
});

describe("player reducer", () => {
  const run = (actions: PlayerAction[], s: PlayerState = initialPlayerState()) => actions.reduce(playerReducer, s);

  it("goes loading → playing → paused → ended", () => {
    let s = run([{ type: "LOADED_METADATA", duration: 48 }, { type: "PLAY" }]);
    expect(s.phase).toBe("loading");
    s = run([{ type: "PLAYING" }], s);
    expect(s).toMatchObject({ phase: "playing", started: true, duration: 48 });
    s = run([{ type: "PAUSE" }], s);
    expect(s.phase).toBe("paused");
    expect(isPausedIdle(s)).toBe(true);
    s = run([{ type: "ENDED" }], s);
    expect(s).toMatchObject({ phase: "ended", currentTime: 48 });
  });

  it("tracks buffering but not while paused", () => {
    let s = run([{ type: "PLAYING" }, { type: "WAITING" }]);
    expect(s.buffering).toBe(true);
    s = run([{ type: "PLAYING" }], s);
    expect(s.buffering).toBe(false);
    s = run([{ type: "PAUSE" }, { type: "WAITING" }], s);
    expect(s.buffering).toBe(false);
  });

  it("handles autoplay block and seeking from ended", () => {
    let s = run([{ type: "AUTOPLAY_BLOCKED" }]);
    expect(s.phase).toBe("blocked");
    s = run([{ type: "PAUSE" }], s);
    expect(s.phase).toBe("blocked");
    s = run([{ type: "PLAY" }], s);
    expect(s.phase).toBe("playing");
    s = run([{ type: "ENDED" }, { type: "SEEKING" }], s);
    expect(s).toMatchObject({ phase: "paused", seeking: true });
  });

  it("freezes on fatal until recovered", () => {
    let s = run([{ type: "PLAYING" }, { type: "FATAL", reason: "network" }, { type: "PLAYING" }]);
    expect(s).toMatchObject({ phase: "error", fatal: "network" });
    s = run([{ type: "RECOVERED" }], s);
    expect(s).toMatchObject({ phase: "loading", fatal: null });
  });

  it("sorts levels and labels quality", () => {
    let s = run([
      { type: "LEVELS", levels: [{ index: 0, height: 360, width: 640, bitrate: 1 }, { index: 1, height: 1080, width: 1920, bitrate: 5 }] },
      { type: "LEVEL_SWITCHED", index: 0 },
    ]);
    expect(s.levels.map((l) => l.height)).toEqual([1080, 360]);
    expect(currentQualityLabel(s)).toBe("Tự động (360p)");
    s = run([{ type: "SELECT_LEVEL", index: 1 }], s);
    expect(currentQualityLabel(s)).toBe("1080p");
  });

  it("clamps volume", () => {
    expect(run([{ type: "VOLUME", volume: 4, muted: false }]).volume).toBe(1);
  });
});
