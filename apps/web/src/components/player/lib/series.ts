/**
 * Series playback logic: intro / credits marker windows, the "Tập tiếp theo" countdown state machine and
 * audio / subtitle track selection. Pure — unit-tested without a DOM.
 */

import type { PlaybackSession } from "@app/shared";

export type Markers = PlaybackSession["markers"];
export type SessionSubtitle = PlaybackSession["subtitles"][number];
export type SessionAudioTrack = PlaybackSession["audioTracks"][number];

/** When `creditsStartSec` is unknown, the next-episode card shows for the last N seconds. */
export const NEXT_UP_FALLBACK_SEC = 20;
/** Auto-advance countdown length. */
export const NEXT_UP_COUNTDOWN_SEC = 10;
/** Hide the skip-intro button this close to the end of the intro (the jump would be pointless). */
const INTRO_TAIL_SEC = 1;

// ───────── marker windows ─────────

/** Intro window [start, end) or null when the episode has no usable intro markers. */
export function introWindow(markers: Markers | null | undefined): { start: number; end: number } | null {
  if (!markers || markers.introEndSec == null) return null;
  const start = Math.max(0, markers.introStartSec ?? 0);
  const end = markers.introEndSec;
  if (!(end > start)) return null;
  return { start, end };
}

/** Whether "Bỏ qua phần mở đầu" should show at `time`. */
export function inIntro(markers: Markers | null | undefined, time: number): boolean {
  const w = introWindow(markers);
  return !!w && time >= w.start && time < w.end - INTRO_TAIL_SEC;
}

/**
 * Second from which the next-episode card shows: `creditsStartSec` when known (and inside the video),
 * otherwise the last {@link NEXT_UP_FALLBACK_SEC} seconds. null until the duration is known.
 */
export function nextUpStart(markers: Markers | null | undefined, duration: number): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const credits = markers?.creditsStartSec;
  if (credits != null && credits > 0 && credits < duration) return credits;
  return Math.max(0, duration - NEXT_UP_FALLBACK_SEC);
}

// ───────── next-episode countdown ─────────

export interface NextUpState {
  /** Card on screen */
  visible: boolean;
  /** Viewer dismissed it ("Xem phần credit") — stays hidden until they leave the window */
  dismissed: boolean;
  /** Seconds left before auto-advance */
  remaining: number;
  /** Countdown reached 0 (or "Phát ngay") → caller starts the next episode once */
  advance: boolean;
}

export type NextUpAction =
  /** Playback position update */
  | { type: "TIME"; time: number; duration: number; markers: Markers | null | undefined; hasNext: boolean }
  /** One second elapsed; only counts while `running` (playing or ended, not paused/seeking) */
  | { type: "TICK"; running: boolean }
  | { type: "ENDED"; hasNext: boolean }
  | { type: "CANCEL" }
  | { type: "PLAY_NOW" }
  /** New episode loaded */
  | { type: "RESET" };

export const initialNextUp: NextUpState = { visible: false, dismissed: false, remaining: NEXT_UP_COUNTDOWN_SEC, advance: false };

export function nextUpReducer(state: NextUpState, action: NextUpAction): NextUpState {
  switch (action.type) {
    case "TIME": {
      if (state.advance) return state;
      const start = action.hasNext ? nextUpStart(action.markers, action.duration) : null;
      const inside = start != null && action.time >= start;
      if (!inside) {
        // Seeked back before the credits: re-arm
        return state.visible || state.dismissed || state.remaining !== NEXT_UP_COUNTDOWN_SEC ? initialNextUp : state;
      }
      if (state.visible || state.dismissed) return state;
      return { ...state, visible: true, remaining: NEXT_UP_COUNTDOWN_SEC };
    }
    case "TICK": {
      if (!state.visible || state.advance || !action.running) return state;
      const remaining = Math.max(0, state.remaining - 1);
      return { ...state, remaining, advance: remaining === 0 };
    }
    case "ENDED":
      // Reached the very end without seeing the card (e.g. jumped straight there): show it now
      if (!action.hasNext || state.dismissed || state.advance) return state;
      return state.visible ? state : { ...state, visible: true, remaining: NEXT_UP_COUNTDOWN_SEC };
    case "CANCEL":
      return { ...state, visible: false, dismissed: true, remaining: NEXT_UP_COUNTDOWN_SEC };
    case "PLAY_NOW":
      return { ...state, advance: true, remaining: 0 };
    case "RESET":
      return initialNextUp;
    default:
      return state;
  }
}

// ───────── audio tracks ─────────

/** Normalised language code: "vi-VN" / "VIE" / "vie" → "vi". */
export function langKey(lang: string | null | undefined): string | null {
  if (!lang) return null;
  const base = lang.trim().toLowerCase().split(/[-_]/)[0];
  const iso3: Record<string, string> = { vie: "vi", eng: "en", jpn: "ja", kor: "ko", zho: "zh", chi: "zh", fra: "fr", fre: "fr", deu: "de", ger: "de", spa: "es", tha: "th" };
  return iso3[base] ?? (base || null);
}

export const sameLang = (a: string | null | undefined, b: string | null | undefined) => {
  const ka = langKey(a);
  return !!ka && ka === langKey(b);
};

export interface HlsAudioTrackLike {
  id: number;
  name: string;
  lang: string | null;
}

/** hls.js track to switch to for the saved language preference; null = keep the current one. */
export function pickAudioTrack(tracks: HlsAudioTrackLike[], preferredLang: string | null | undefined, activeId: number): number | null {
  if (!preferredLang || tracks.length < 2) return null;
  const active = tracks.find((t) => t.id === activeId);
  if (active && sameLang(active.lang, preferredLang)) return null;
  const match = tracks.find((t) => sameLang(t.lang, preferredLang));
  return match ? match.id : null;
}

/** Menu label for an hls.js audio track, enriched with the session's metadata (label, 5.1). */
export function audioTrackLabel(track: HlsAudioTrackLike, sessionTracks: SessionAudioTrack[], index: number): string {
  const meta =
    sessionTracks.find((s) => s.label === track.name) ??
    sessionTracks.find((s) => sameLang(s.language, track.lang) && sessionTracks.filter((x) => sameLang(x.language, track.lang)).length === 1) ??
    (sessionTracks.length > index ? sessionTracks[index] : undefined);
  const base = meta?.label || track.name || track.lang || `Âm thanh ${index + 1}`;
  const channels = meta?.channels ?? 0;
  return channels >= 6 && !/5\.1|7\.1/.test(base) ? `${base} (${channels >= 8 ? "7.1" : "5.1"})` : base;
}

// ───────── subtitles ─────────

/** Subtitle preference persisted per browser: a language, or explicitly off. */
export interface SubtitlePref {
  /** Preferred language when subtitles are on; null = never chosen */
  lang: string | null;
  /** Viewer explicitly picked "Tắt" */
  off: boolean;
}

/** Tracks shown in the menu (forced-narrative tracks are applied automatically, not listed). */
export function selectableSubtitles(subs: SessionSubtitle[]): SessionSubtitle[] {
  return subs.filter((s) => !s.isForced);
}

/**
 * Initial subtitle choice for a new session (a track id, or null = off):
 * saved language → (unless the viewer turned subtitles off) the track flagged default → off.
 */
export function initialSubtitleId(subs: SessionSubtitle[], pref: SubtitlePref): string | null {
  const list = selectableSubtitles(subs);
  if (pref.off) return null;
  if (pref.lang) {
    const saved = list.find((s) => sameLang(s.language, pref.lang));
    if (saved) return saved.id;
  }
  return list.find((s) => s.isDefault)?.id ?? null;
}

/**
 * Track actually rendered: the chosen one, else a forced track matching the audio language
 * (signs / foreign-language lines), else nothing.
 */
export function effectiveSubtitle(subs: SessionSubtitle[], selectedId: string | null, audioLang: string | null): SessionSubtitle | null {
  if (selectedId) {
    const chosen = subs.find((s) => s.id === selectedId);
    if (chosen) return chosen;
  }
  const forced = subs.filter((s) => s.isForced);
  if (!forced.length) return null;
  return forced.find((s) => sameLang(s.language, audioLang)) ?? (audioLang ? null : (forced.find((s) => s.isDefault) ?? null));
}
