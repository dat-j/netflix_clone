/**
 * Player state machine. The `usePlayer` hook translates <video>/hls.js events into these actions;
 * the UI only reads state. Pure reducer — unit-tested without a DOM.
 */

export type PlaybackPhase =
  /** Manifest/first frame loading */
  | "loading"
  /** Ready but autoplay was refused by the browser — show "Bấm để phát" */
  | "blocked"
  | "playing"
  | "paused"
  | "ended"
  /** Unrecoverable media error (after retries) */
  | "error";

export type FatalReason = "network" | "media" | "unsupported" | "session-ended" | "unknown";

export interface QualityLevel {
  /** hls.js level index (or -1 for native) */
  index: number;
  height: number;
  width: number;
  bitrate: number;
}

export interface AudioTrackInfo {
  id: number;
  name: string;
  lang: string | null;
}

export interface PlayerState {
  phase: PlaybackPhase;
  /** Waiting for data while play was requested */
  buffering: boolean;
  /** A seek is in flight */
  seeking: boolean;
  currentTime: number;
  duration: number;
  /** End of the buffered range that contains currentTime */
  bufferedEnd: number;
  volume: number;
  muted: boolean;
  rate: number;
  levels: QualityLevel[];
  /** -1 = Auto */
  selectedLevel: number;
  /** Level actually playing (for the "Auto (720p)" label) */
  activeLevel: number;
  audioTracks: AudioTrackInfo[];
  activeAudioTrack: number;
  fatal: FatalReason | null;
  /** True once the first frame played — used for the intro overlay & resume */
  started: boolean;
}

export type PlayerAction =
  | { type: "LOAD" }
  /** Another episode is about to load into the same <video>: forget everything media-specific, keep volume/rate */
  | { type: "RESET_MEDIA" }
  | { type: "LOADED_METADATA"; duration: number }
  | { type: "PLAY" }
  | { type: "PLAYING" }
  | { type: "PAUSE" }
  | { type: "WAITING" }
  | { type: "CAN_PLAY" }
  | { type: "SEEKING" }
  | { type: "SEEKED" }
  | { type: "TIME"; currentTime: number }
  | { type: "DURATION"; duration: number }
  | { type: "BUFFERED"; bufferedEnd: number }
  | { type: "ENDED" }
  | { type: "VOLUME"; volume: number; muted: boolean }
  | { type: "RATE"; rate: number }
  | { type: "LEVELS"; levels: QualityLevel[] }
  | { type: "SELECT_LEVEL"; index: number }
  | { type: "LEVEL_SWITCHED"; index: number }
  | { type: "AUDIO_TRACKS"; tracks: AudioTrackInfo[]; active: number }
  | { type: "AUDIO_SWITCHED"; id: number }
  | { type: "AUTOPLAY_BLOCKED" }
  | { type: "FATAL"; reason: FatalReason }
  | { type: "RECOVERED" };

export function initialPlayerState(prefs?: Partial<Pick<PlayerState, "volume" | "muted" | "rate">>): PlayerState {
  return {
    phase: "loading",
    buffering: false,
    seeking: false,
    currentTime: 0,
    duration: 0,
    bufferedEnd: 0,
    volume: prefs?.volume ?? 1,
    muted: prefs?.muted ?? false,
    rate: prefs?.rate ?? 1,
    levels: [],
    selectedLevel: -1,
    activeLevel: -1,
    audioTracks: [],
    activeAudioTrack: -1,
    fatal: null,
    started: false,
  };
}

const finite = (n: number, fallback = 0) => (Number.isFinite(n) && n >= 0 ? n : fallback);

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  // A fatal error freezes the machine until LOAD/RECOVERED
  if (state.phase === "error" && action.type !== "LOAD" && action.type !== "RECOVERED" && action.type !== "FATAL" && action.type !== "RESET_MEDIA") {
    return state;
  }
  switch (action.type) {
    case "LOAD":
      return { ...state, phase: "loading", buffering: false, fatal: null };
    case "RESET_MEDIA":
      return initialPlayerState({ volume: state.volume, muted: state.muted, rate: state.rate });
    case "LOADED_METADATA":
      return { ...state, duration: finite(action.duration, state.duration) };
    case "DURATION":
      return finite(action.duration) > 0 ? { ...state, duration: action.duration } : state;
    case "PLAY":
      // Optimistic: the icon flips immediately; "loading" waits for the first frame
      return { ...state, phase: state.phase === "loading" ? "loading" : "playing" };
    case "PLAYING":
      return { ...state, phase: "playing", buffering: false, started: true };
    case "PAUSE":
      if (state.phase === "ended" || state.phase === "loading" || state.phase === "blocked") return { ...state, buffering: false };
      return { ...state, phase: "paused", buffering: false };
    case "WAITING":
      return state.phase === "paused" ? state : { ...state, buffering: true };
    case "CAN_PLAY":
      return { ...state, buffering: false };
    case "SEEKING":
      return { ...state, seeking: true, phase: state.phase === "ended" ? "paused" : state.phase };
    case "SEEKED":
      return { ...state, seeking: false };
    case "TIME":
      if (Math.abs(action.currentTime - state.currentTime) < 0.01) return state;
      return { ...state, currentTime: finite(action.currentTime) };
    case "BUFFERED":
      return action.bufferedEnd === state.bufferedEnd ? state : { ...state, bufferedEnd: finite(action.bufferedEnd) };
    case "ENDED":
      return { ...state, phase: "ended", buffering: false, currentTime: state.duration || state.currentTime };
    case "VOLUME":
      return { ...state, volume: Math.min(1, Math.max(0, action.volume)), muted: action.muted };
    case "RATE":
      return { ...state, rate: action.rate };
    case "LEVELS": {
      const levels = [...action.levels].sort((a, b) => b.height - a.height);
      return { ...state, levels };
    }
    case "SELECT_LEVEL":
      return { ...state, selectedLevel: action.index };
    case "LEVEL_SWITCHED":
      return { ...state, activeLevel: action.index };
    case "AUDIO_TRACKS":
      return { ...state, audioTracks: action.tracks, activeAudioTrack: action.active };
    case "AUDIO_SWITCHED":
      return { ...state, activeAudioTrack: action.id };
    case "AUTOPLAY_BLOCKED":
      return { ...state, phase: "blocked", buffering: false };
    case "FATAL":
      return { ...state, phase: "error", fatal: action.reason, buffering: false };
    case "RECOVERED":
      return { ...state, phase: state.phase === "error" ? "loading" : state.phase, fatal: null };
    default:
      return state;
  }
}

/** Label for the quality button: "Tự động (720p)" or "1080p". */
export function currentQualityLabel(state: Pick<PlayerState, "levels" | "selectedLevel" | "activeLevel">): string {
  const find = (i: number) => state.levels.find((l) => l.index === i);
  if (state.selectedLevel === -1) {
    const active = find(state.activeLevel);
    return active ? `Tự động (${active.height}p)` : "Tự động";
  }
  const sel = find(state.selectedLevel);
  return sel ? `${sel.height}p` : "Tự động";
}

/** Whether the centre "paused" info overlay may show. */
export function isPausedIdle(state: Pick<PlayerState, "phase" | "seeking" | "started">): boolean {
  return state.phase === "paused" && !state.seeking && state.started;
}
