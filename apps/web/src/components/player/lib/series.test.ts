import { describe, expect, it } from "vitest";
import { commandForKey } from "./keymap";
import {
  audioTrackLabel,
  effectiveSubtitle,
  inIntro,
  initialNextUp,
  initialSubtitleId,
  introWindow,
  langKey,
  NEXT_UP_COUNTDOWN_SEC,
  nextUpReducer,
  nextUpStart,
  pickAudioTrack,
  selectableSubtitles,
  type Markers,
  type NextUpAction,
  type NextUpState,
  type SessionSubtitle,
} from "./series";
import { initialPlayerState, playerReducer } from "./state";

const M: Markers = { introStartSec: 30, introEndSec: 90, creditsStartSec: 1200 };

describe("marker windows", () => {
  it("intro window", () => {
    expect(introWindow(M)).toEqual({ start: 30, end: 90 });
    expect(introWindow({ introStartSec: null, introEndSec: 60, creditsStartSec: null })).toEqual({ start: 0, end: 60 });
    expect(introWindow({ introStartSec: 50, introEndSec: 40, creditsStartSec: null })).toBeNull();
    expect(introWindow({ introStartSec: 10, introEndSec: null, creditsStartSec: null })).toBeNull();
    expect(introWindow(null)).toBeNull();
  });
  it("skip-intro visibility", () => {
    expect(inIntro(M, 29.9)).toBe(false);
    expect(inIntro(M, 30)).toBe(true);
    expect(inIntro(M, 88.9)).toBe(true);
    expect(inIntro(M, 89.5)).toBe(false); // last second: pointless to offer
    expect(inIntro(M, 95)).toBe(false);
    expect(inIntro(undefined, 40)).toBe(false);
  });
  it("next-up start: credits marker, else last 20 s", () => {
    expect(nextUpStart(M, 1300)).toBe(1200);
    expect(nextUpStart({ ...M, creditsStartSec: null }, 1300)).toBe(1280);
    expect(nextUpStart({ ...M, creditsStartSec: 5000 }, 1300)).toBe(1280); // marker past the end → fallback
    expect(nextUpStart(M, 0)).toBeNull();
    expect(nextUpStart(null, 12)).toBe(0);
  });
});

describe("next-episode countdown", () => {
  const run = (actions: NextUpAction[], from: NextUpState = initialNextUp) => actions.reduce(nextUpReducer, from);
  const time = (t: number, hasNext = true): NextUpAction => ({ type: "TIME", time: t, duration: 1300, markers: M, hasNext });
  const tick: NextUpAction = { type: "TICK", running: true };

  it("appears at the credits and counts down to an auto-advance", () => {
    expect(run([time(1100)]).visible).toBe(false);
    let s = run([time(1200)]);
    expect(s).toMatchObject({ visible: true, remaining: NEXT_UP_COUNTDOWN_SEC, advance: false });
    s = run(Array(NEXT_UP_COUNTDOWN_SEC - 1).fill(tick), s);
    expect(s).toMatchObject({ remaining: 1, advance: false });
    s = run([tick], s);
    expect(s).toMatchObject({ remaining: 0, advance: true });
    // Further ticks / positions don't re-trigger
    expect(run([tick, time(1250)], s)).toBe(s);
  });
  it("does not count while paused", () => {
    const s = run([time(1200), { type: "TICK", running: false }, { type: "TICK", running: false }]);
    expect(s.remaining).toBe(NEXT_UP_COUNTDOWN_SEC);
  });
  it("cancel hides it until the viewer leaves the window", () => {
    let s = run([time(1200), tick, { type: "CANCEL" }]);
    expect(s).toMatchObject({ visible: false, dismissed: true });
    s = run([time(1250), tick], s);
    expect(s.visible).toBe(false);
    s = run([time(600)], s); // seek back before the credits → re-armed
    expect(s).toEqual(initialNextUp);
    expect(run([time(1210)], s).visible).toBe(true);
  });
  it("ENDED shows it if it was skipped over; PLAY_NOW advances; RESET clears", () => {
    expect(run([{ type: "ENDED", hasNext: true }]).visible).toBe(true);
    expect(run([{ type: "ENDED", hasNext: false }]).visible).toBe(false);
    expect(run([time(1200), { type: "CANCEL" }, { type: "ENDED", hasNext: true }]).visible).toBe(false);
    expect(run([time(1200), { type: "PLAY_NOW" }]).advance).toBe(true);
    expect(run([time(1200), { type: "RESET" }])).toEqual(initialNextUp);
  });
  it("never shows without a next episode", () => {
    expect(run([time(1290, false), tick]).visible).toBe(false);
  });
});

describe("audio + subtitle preferences", () => {
  const tracks = [
    { id: 0, name: "Tiếng Việt", lang: "vi" },
    { id: 1, name: "English", lang: "en" },
  ];
  it("normalises languages", () => {
    expect(langKey("vi-VN")).toBe("vi");
    expect(langKey("VIE")).toBe("vi");
    expect(langKey("eng")).toBe("en");
    expect(langKey(null)).toBeNull();
  });
  it("picks the preferred audio language", () => {
    expect(pickAudioTrack(tracks, "en", 0)).toBe(1);
    expect(pickAudioTrack(tracks, "eng", 0)).toBe(1);
    expect(pickAudioTrack(tracks, "vi", 0)).toBeNull(); // already active
    expect(pickAudioTrack(tracks, "ja", 0)).toBeNull(); // not available
    expect(pickAudioTrack(tracks, null, 0)).toBeNull();
    expect(pickAudioTrack([tracks[0]], "en", 0)).toBeNull();
  });
  it("labels audio tracks from session metadata", () => {
    const meta = [
      { id: "a1", language: "vi", label: "Tiếng Việt (lồng tiếng)", channels: 2, isDefault: true },
      { id: "a2", language: "en", label: "English", channels: 6, isDefault: false },
    ];
    expect(audioTrackLabel(tracks[0], meta, 0)).toBe("Tiếng Việt (lồng tiếng)");
    expect(audioTrackLabel(tracks[1], meta, 1)).toBe("English (5.1)");
    expect(audioTrackLabel({ id: 2, name: "", lang: "ja" }, [], 2)).toBe("ja");
  });

  const subs: SessionSubtitle[] = [
    { id: "s-vi", language: "vi", label: "Tiếng Việt", url: "https://cdn/vi.vtt", isDefault: true, isForced: false },
    { id: "s-en", language: "en", label: "English", url: "https://cdn/en.vtt", isDefault: false, isForced: false },
    { id: "f-vi", language: "vi", label: "Tiếng Việt (bắt buộc)", url: "https://cdn/vi-forced.vtt", isDefault: false, isForced: true },
  ];
  it("menu hides forced tracks", () => {
    expect(selectableSubtitles(subs).map((s) => s.id)).toEqual(["s-vi", "s-en"]);
  });
  it("initial subtitle: saved language → off → default", () => {
    expect(initialSubtitleId(subs, { lang: "en", off: false })).toBe("s-en");
    expect(initialSubtitleId(subs, { lang: "en-US", off: false })).toBe("s-en");
    expect(initialSubtitleId(subs, { lang: "en", off: true })).toBeNull();
    expect(initialSubtitleId(subs, { lang: null, off: false })).toBe("s-vi");
    expect(initialSubtitleId(subs, { lang: "fr", off: false })).toBe("s-vi");
    expect(initialSubtitleId([subs[1]], { lang: null, off: false })).toBeNull();
  });
  it("forced track renders when subtitles are off and the audio language matches", () => {
    expect(effectiveSubtitle(subs, "s-en", "vi")?.id).toBe("s-en");
    expect(effectiveSubtitle(subs, null, "vi")?.id).toBe("f-vi");
    expect(effectiveSubtitle(subs, null, "vie")?.id).toBe("f-vi");
    expect(effectiveSubtitle(subs, null, "en")).toBeNull();
    expect(effectiveSubtitle(subs.slice(0, 2), null, "vi")).toBeNull();
    expect(effectiveSubtitle(subs, "gone", "vi")?.id).toBe("f-vi");
  });
});

describe("series keys + state", () => {
  it("N / S", () => {
    expect(commandForKey({ key: "n" })).toEqual({ type: "nextEpisode" });
    expect(commandForKey({ key: "N" })).toEqual({ type: "nextEpisode" });
    expect(commandForKey({ key: "s" })).toEqual({ type: "skipIntro" });
    expect(commandForKey({ key: "s", ctrlKey: true })).toBeNull();
  });
  it("RESET_MEDIA keeps volume/rate, drops media state", () => {
    let s = initialPlayerState({ volume: 0.4, rate: 1.5 });
    s = playerReducer(s, { type: "PLAYING" });
    s = playerReducer(s, { type: "TIME", currentTime: 300 });
    s = playerReducer(s, { type: "AUDIO_TRACKS", tracks: [{ id: 0, name: "vi", lang: "vi" }], active: 0 });
    s = playerReducer(s, { type: "FATAL", reason: "network" });
    const r = playerReducer(s, { type: "RESET_MEDIA" });
    expect(r).toMatchObject({ phase: "loading", currentTime: 0, started: false, audioTracks: [], fatal: null, volume: 0.4, rate: 1.5 });
  });
});
