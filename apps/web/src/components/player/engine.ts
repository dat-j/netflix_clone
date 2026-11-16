"use client";

import type Hls from "hls.js";
import type { ErrorData, HlsConfig } from "hls.js";
import { clamp } from "./lib/format";
import { backoffDelay, levelForHeight } from "./lib/prefs";
import type { PlayerAction, QualityLevel } from "./lib/state";

/**
 * Imperative wrapper around <video> + hls.js. Owns all media side effects and reports
 * everything as reducer actions; React components never touch hls.js directly.
 */

export interface EngineOptions {
  dispatch: (a: PlayerAction) => void;
  /** Playlist/key/segment requests returned 401/403 → caller should mint a new session */
  onAuthExpired: () => void;
  /** Preferred manual quality (height), null = Auto */
  preferredHeight: () => number | null;
}

type HlsModule = typeof import("hls.js");

const MAX_NETWORK_RETRIES = 4;
const MAX_MEDIA_RECOVERIES = 2;

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return true;
  }
}

function authStatus(data: ErrorData): number | null {
  const code = data.response?.code;
  if (code === 401 || code === 403) return code;
  const xhr = data.networkDetails as XMLHttpRequest | undefined;
  if (xhr && typeof xhr === "object" && "status" in xhr && (xhr.status === 401 || xhr.status === 403)) return xhr.status;
  return null;
}

export class PlayerEngine {
  readonly video: HTMLVideoElement;
  private opts: EngineOptions;
  private hls: Hls | null = null;
  private HlsCtor: HlsModule["default"] | null = null;
  private native = false;
  private destroyed = false;
  private raf = 0;
  private networkRetries = 0;
  private mediaRecoveries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private autoplay = true;
  private pendingStart = 0;
  private authReported = false;
  private cleanup: (() => void)[] = [];
  /** Exposed for e2e/debug: `document.querySelector('video').__engine` */
  levels: QualityLevel[] = [];

  constructor(video: HTMLVideoElement, opts: EngineOptions) {
    this.video = video;
    this.opts = opts;
    this.bindVideo();
    (video as HTMLVideoElement & { __engine?: PlayerEngine }).__engine = this;
  }

  get usesHlsJs() {
    return !!this.hls;
  }

  get hlsInstance() {
    return this.hls;
  }

  // ───────── loading ─────────

  async load(manifestUrl: string, startAt: number, autoplay = true): Promise<void> {
    this.autoplay = autoplay;
    this.pendingStart = Math.max(0, startAt);
    this.networkRetries = 0;
    this.mediaRecoveries = 0;
    this.authReported = false;
    this.teardownHls();
    this.opts.dispatch({ type: "LOAD" });

    const mod = await import("hls.js");
    if (this.destroyed) return;
    const HlsCtor = mod.default;
    this.HlsCtor = HlsCtor;

    if (HlsCtor.isSupported()) {
      this.native = false;
      this.attachHls(HlsCtor, manifestUrl, this.pendingStart);
    } else if (this.video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari/iOS without MSE: the browser fetches playlists (same-origin, cookies) and the key itself
      this.native = true;
      this.video.src = manifestUrl;
      this.video.load();
    } else {
      this.opts.dispatch({ type: "FATAL", reason: "unsupported" });
    }
  }

  /** Swap to a fresh session manifest and continue where we were (token renewal / retry). */
  async reload(manifestUrl: string, at = this.video.currentTime, autoplay = !this.video.paused || this.autoplay) {
    await this.load(manifestUrl, at, autoplay);
  }

  private attachHls(HlsCtor: HlsModule["default"], manifestUrl: string, startAt: number) {
    const config: Partial<HlsConfig> = {
      startPosition: startAt,
      // Playlists + key are same-origin (cookie auth); CDN segments must not send credentials (CORS *)
      xhrSetup: (xhr, url) => {
        xhr.withCredentials = isSameOrigin(url);
      },
      fetchSetup: (context, init) => new Request(context.url, { ...init, credentials: isSameOrigin(context.url) ? "include" : "omit" }),
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      backBufferLength: 30,
      capLevelToPlayerSize: false,
      startFragPrefetch: true,
      testBandwidth: true,
      enableWorker: true,
    };
    const hls = new HlsCtor(config);
    this.hls = hls;
    const E = HlsCtor.Events;

    hls.on(E.MANIFEST_PARSED, (_e, data) => {
      const levels: QualityLevel[] = data.levels.map((l, index) => ({ index, height: l.height, width: l.width, bitrate: l.bitrate }));
      this.levels = levels;
      this.opts.dispatch({ type: "LEVELS", levels });
      const pref = levelForHeight(levels, this.opts.preferredHeight());
      if (pref !== -1) {
        hls.startLevel = pref;
        hls.currentLevel = pref;
        this.opts.dispatch({ type: "SELECT_LEVEL", index: pref });
      }
      this.tryAutoplay();
    });
    hls.on(E.LEVEL_SWITCHED, (_e, data) => this.opts.dispatch({ type: "LEVEL_SWITCHED", index: data.level }));
    hls.on(E.AUDIO_TRACKS_UPDATED, (_e, data) => {
      const tracks = data.audioTracks.map((t) => ({ id: t.id, name: t.name || t.lang || `Âm thanh ${t.id + 1}`, lang: t.lang ?? null }));
      this.opts.dispatch({ type: "AUDIO_TRACKS", tracks, active: hls.audioTrack });
    });
    hls.on(E.AUDIO_TRACK_SWITCHED, (_e, data) => this.opts.dispatch({ type: "AUDIO_SWITCHED", id: data.id }));
    hls.on(E.FRAG_BUFFERED, () => {
      this.networkRetries = 0;
      if (this.mediaRecoveries) this.opts.dispatch({ type: "RECOVERED" });
    });
    hls.on(E.ERROR, (_e, data) => this.onHlsError(data));

    hls.loadSource(manifestUrl);
    hls.attachMedia(this.video);
  }

  private onHlsError(data: ErrorData) {
    const HlsCtor = this.HlsCtor;
    const hls = this.hls;
    if (!HlsCtor || !hls) return;
    const T = HlsCtor.ErrorTypes;

    // Expired signed URLs / access token: transparent session renewal (fatal or not — retries won't help)
    if (authStatus(data) && (data.type === T.NETWORK_ERROR || data.type === T.KEY_SYSTEM_ERROR)) {
      if (!this.authReported) {
        this.authReported = true;
        this.opts.onAuthExpired();
      }
      return;
    }
    if (!data.fatal) return;

    if (data.type === T.NETWORK_ERROR) {
      if (this.networkRetries >= MAX_NETWORK_RETRIES) {
        this.opts.dispatch({ type: "FATAL", reason: "network" });
        return;
      }
      const delay = backoffDelay(this.networkRetries++);
      this.opts.dispatch({ type: "WAITING" });
      this.clearRetry();
      this.retryTimer = setTimeout(() => {
        if (!this.hls) return;
        // Manifest never loaded → reload it; otherwise resume fragment loading
        if (!this.levels.length) this.hls.loadSource(this.hls.url ?? "");
        else this.hls.startLoad(this.video.currentTime || this.pendingStart);
      }, delay);
      return;
    }
    if (data.type === T.MEDIA_ERROR) {
      if (this.mediaRecoveries === 0) hls.recoverMediaError();
      else if (this.mediaRecoveries === 1) {
        hls.swapAudioCodec();
        hls.recoverMediaError();
      } else {
        this.opts.dispatch({ type: "FATAL", reason: "media" });
        return;
      }
      this.mediaRecoveries = Math.min(MAX_MEDIA_RECOVERIES, this.mediaRecoveries + 1);
      return;
    }
    this.opts.dispatch({ type: "FATAL", reason: "unknown" });
  }

  private async tryAutoplay() {
    if (!this.autoplay) {
      this.opts.dispatch({ type: "AUTOPLAY_BLOCKED" });
      return;
    }
    try {
      await this.video.play();
    } catch (err) {
      if (this.destroyed) return;
      const name = (err as DOMException)?.name;
      if (name === "NotAllowedError") this.opts.dispatch({ type: "AUTOPLAY_BLOCKED" });
      // AbortError: superseded by a newer load/pause — ignore
    }
  }

  // ───────── video events ─────────

  private bindVideo() {
    const v = this.video;
    const d = this.opts.dispatch;
    const on = <K extends keyof HTMLVideoElementEventMap>(type: K, fn: (e: HTMLVideoElementEventMap[K]) => void) => {
      v.addEventListener(type, fn);
      this.cleanup.push(() => v.removeEventListener(type, fn));
    };
    on("loadedmetadata", () => {
      d({ type: "LOADED_METADATA", duration: v.duration });
      if (this.native) {
        if (this.pendingStart > 0 && this.pendingStart < v.duration - 1) v.currentTime = this.pendingStart;
        this.tryAutoplay();
      }
    });
    on("durationchange", () => d({ type: "DURATION", duration: v.duration }));
    on("play", () => d({ type: "PLAY" }));
    on("playing", () => {
      d({ type: "PLAYING" });
      this.startTicker();
    });
    on("pause", () => {
      d({ type: "PAUSE" });
      this.stopTicker();
      d({ type: "TIME", currentTime: v.currentTime });
    });
    on("waiting", () => d({ type: "WAITING" }));
    on("canplay", () => d({ type: "CAN_PLAY" }));
    on("seeking", () => {
      d({ type: "SEEKING" });
      d({ type: "TIME", currentTime: v.currentTime });
    });
    on("seeked", () => {
      d({ type: "SEEKED" });
      d({ type: "TIME", currentTime: v.currentTime });
    });
    on("timeupdate", () => {
      if (v.paused) d({ type: "TIME", currentTime: v.currentTime });
    });
    on("progress", () => d({ type: "BUFFERED", bufferedEnd: this.bufferedEnd() }));
    on("ended", () => {
      this.stopTicker();
      d({ type: "ENDED" });
    });
    on("volumechange", () => d({ type: "VOLUME", volume: v.volume, muted: v.muted }));
    on("ratechange", () => d({ type: "RATE", rate: v.playbackRate }));
    on("error", () => {
      if (!this.native) return; // hls.js reports its own errors
      // Native HLS hides HTTP status; the most likely cause mid-stream is an expired token
      if (!this.authReported && v.error?.code === MediaError.MEDIA_ERR_NETWORK) {
        this.authReported = true;
        this.opts.onAuthExpired();
        return;
      }
      d({ type: "FATAL", reason: v.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? "unsupported" : "media" });
    });
  }

  private bufferedEnd(): number {
    const v = this.video;
    const t = v.currentTime;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= t + 0.5 && v.buffered.end(i) >= t) return v.buffered.end(i);
    }
    return t;
  }

  /** Smooth progress while playing (timeupdate is only ~4 Hz) */
  private startTicker() {
    this.stopTicker();
    let last = 0;
    let lastBuffered = 0;
    const tick = (now: number) => {
      if (now - last > 50) {
        last = now;
        this.opts.dispatch({ type: "TIME", currentTime: this.video.currentTime });
      }
      if (now - lastBuffered > 1000) {
        lastBuffered = now;
        this.opts.dispatch({ type: "BUFFERED", bufferedEnd: this.bufferedEnd() });
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopTicker() {
    cancelAnimationFrame(this.raf);
  }

  // ───────── commands ─────────

  play() {
    if (this.video.ended) this.video.currentTime = 0;
    this.autoplay = true;
    return this.video.play().catch((err: DOMException) => {
      if (err?.name === "NotAllowedError") this.opts.dispatch({ type: "AUTOPLAY_BLOCKED" });
    });
  }

  pause() {
    this.video.pause();
  }

  toggle() {
    if (this.video.paused || this.video.ended) void this.play();
    else this.pause();
  }

  seek(time: number) {
    const dur = this.video.duration;
    const max = Number.isFinite(dur) ? Math.max(0, dur - 0.1) : time;
    const t = clamp(time, 0, max);
    this.video.currentTime = t;
    this.opts.dispatch({ type: "TIME", currentTime: t });
  }

  seekBy(delta: number) {
    this.seek(this.video.currentTime + delta);
  }

  setVolume(volume: number) {
    this.video.volume = clamp(volume, 0, 1);
    if (volume > 0 && this.video.muted) this.video.muted = false;
    if (volume <= 0) this.video.muted = true;
  }

  setMuted(muted: boolean) {
    this.video.muted = muted;
    if (!muted && this.video.volume === 0) this.video.volume = 0.5;
  }

  setRate(rate: number) {
    this.video.playbackRate = rate;
  }

  /** -1 = Auto */
  setLevel(index: number) {
    const hls = this.hls;
    if (!hls) return;
    // currentLevel flushes the buffer so the change is visible immediately (like Netflix's manual pick)
    if (index === -1) hls.nextLevel = -1;
    else hls.currentLevel = index;
    this.opts.dispatch({ type: "SELECT_LEVEL", index });
  }

  setAudioTrack(id: number) {
    if (this.hls) this.hls.audioTrack = id;
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private teardownHls() {
    this.clearRetry();
    this.stopTicker();
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.levels = [];
  }

  /** Stop all network activity but keep the last frame (session ended / leaving). */
  stop() {
    this.teardownHls();
    this.video.pause();
  }

  destroy() {
    this.destroyed = true;
    this.teardownHls();
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    this.video.removeAttribute("src");
    try {
      this.video.load();
    } catch {
      /* ignore */
    }
  }
}
