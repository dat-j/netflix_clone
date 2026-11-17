"use client";

import type { EpisodeRef, HeartbeatBody, TitleDetail } from "@app/shared";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { api } from "@/lib/api/client";
import { canTelegramFullscreen, getTelegram, reauthUrl } from "@/lib/telegram";
import { cn } from "@/lib/utils";
import { PlayerControllerContext, type PlayerController } from "./controller";
import { BottomBar, TopBar, TouchCenterControls } from "./controls/chrome";
import { PlayerEngine } from "./engine";
import { useHeartbeat } from "./hooks/use-heartbeat";
import { usePlaybackSession, type SessionError } from "./hooks/use-playback-session";
import { useSubtitleCues, useThumbnails } from "./hooks/use-vtt";
import { clamp, episodeLabel } from "./lib/format";
import { commandForKey, isEditableTarget } from "./lib/keymap";
import { loadPrefs, savePrefs } from "./lib/prefs";
import { effectiveSubtitle, inIntro, initialSubtitleId, introWindow, pickAudioTrack, sameLang, selectableSubtitles } from "./lib/series";
import { NextUpCard, SkipIntroButton } from "./series-overlays";
import { BlockedOverlay, BufferingSpinner, CenterFeedback, EndScreen, IntroOverlay, PausedOverlay, SubtitleOverlay } from "./overlays";
import { PlayerScreen, type ScreenKind } from "./screens";
import { createPlayerStore, PlayerStoreContext, usePlayerStore, type MenuId, type PlayerStore } from "./store";

const HIDE_AFTER_PLAYING_MS = 3000;
const HIDE_AFTER_PAUSED_MS = 5000;
const DOUBLE_TAP_MS = 280;
const MAX_RENEWALS_PER_MIN = 3;

type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
type FsVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitSupportsFullscreen?: boolean };

function subscribeCoarse(cb: () => void) {
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useCoarsePointer = () =>
  useSyncExternalStore(subscribeCoarse, () => window.matchMedia("(pointer: coarse)").matches, () => false);

function sessionErrorKind(e: SessionError): ScreenKind {
  switch (e.code) {
    case "NO_SUBSCRIPTION":
    case "TOO_MANY_STREAMS":
    case "NOT_PLAYABLE":
    case "SESSION_ENDED":
      return e.code;
    case "NOT_FOUND":
      return "NOT_PLAYABLE";
    case "NETWORK":
      return "NETWORK";
    default:
      return e.status === 402 ? "NO_SUBSCRIPTION" : e.status === 409 ? "TOO_MANY_STREAMS" : "GENERIC";
  }
}

export function Player({ titleId, episodeId }: { titleId: string; episodeId: string | null }) {
  const [store] = useState(() => createPlayerStore());
  return (
    <PlayerStoreContext.Provider value={store}>
      <PlayerInner titleId={titleId} episodeId={episodeId} store={store} />
    </PlayerStoreContext.Provider>
  );
}

function PlayerInner({ titleId, episodeId, store }: { titleId: string; episodeId: string | null; store: PlayerStore }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  const resumeAt = useRef<number | null>(null);
  /** Whether the next manifest load should start playing (false when re-attaching a paused video) */
  const autoplayNext = useRef(true);
  const renewals = useRef<number[]>([]);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ t: number; x: number } | null>(null);
  const streakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = useCoarsePointer();
  const [sessionEnded, setSessionEnded] = useState(false);
  const [caps, setCaps] = useState({ pip: false, fullscreen: false });

  const phase = usePlayerStore((s) => s.phase);
  const fatal = usePlayerStore((s) => s.fatal);
  const chromeVisible = usePlayerStore((s) => s.chromeVisible || s.menu !== null);
  const started = usePlayerStore((s) => s.started);
  const subtitleId = usePlayerStore((s) => s.subtitleId);
  const audioLang = usePlayerStore((s) => s.audioTracks.find((t) => t.id === s.activeAudioTrack)?.lang ?? null);

  const getBeat = useCallback((): HeartbeatBody | null => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return null;
    return { positionSec: Math.floor(v.currentTime), durationSec: Math.round(v.duration), paused: v.paused };
  }, []);

  const sess = usePlaybackSession(titleId, episodeId, getBeat);
  const session = sess.session;
  /** Episode whose media is currently loaded in the <video> (undefined = nothing loaded yet) */
  const loadedEpisode = useRef<string | null | undefined>(undefined);

  const detailQuery = useQuery({
    queryKey: ["player", "title", titleId],
    queryFn: () => api<TitleDetail>(`/titles/${encodeURIComponent(titleId)}`),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const detail = detailQuery.data ?? null;
  const thumbnails = useThumbnails(session?.thumbnailsVttUrl);
  const subtitleUrl = useMemo(() => {
    if (!session) return null;
    // With a single manifest audio track hls.js reports none: fall back to the session's audio metadata
    const lang = audioLang ?? session.audioTracks.find((t) => t.isDefault)?.language ?? session.audioTracks[0]?.language ?? null;
    return effectiveSubtitle(session.subtitles, subtitleId, lang)?.url ?? null;
  }, [session, subtitleId, audioLang]);
  const { cues: subtitleCues } = useSubtitleCues(subtitleUrl);

  // ───────── chrome auto-hide ─────────
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const s = store.getState();
    const delay = s.phase === "paused" ? HIDE_AFTER_PAUSED_MS : HIDE_AFTER_PLAYING_MS;
    const check = () => {
      const st = store.getState();
      const overControls = rootRef.current?.querySelector('[data-testid="player-controls"]')?.matches(":hover");
      const focusInChrome = rootRef.current?.querySelector('[data-testid="player-controls"]')?.contains(document.activeElement) &&
        document.activeElement?.matches(":focus-visible");
      const keep = st.menu !== null || st.phase === "blocked" || st.phase === "ended" || !st.started || overControls || focusInChrome;
      if (keep) hideTimer.current = setTimeout(check, 1000);
      else store.getState().setUi({ chromeVisible: false });
    };
    hideTimer.current = setTimeout(check, delay);
  }, [store]);

  const poke = useCallback(() => {
    if (!store.getState().chromeVisible) store.getState().setUi({ chromeVisible: true });
    scheduleHide();
  }, [store, scheduleHide]);

  useEffect(() => {
    // Phase transitions show the chrome (pause → controls, then paused overlay after a while)
    return store.subscribe((s, prev) => {
      if (s.phase !== prev.phase && (s.phase === "paused" || s.phase === "playing")) poke();
    });
  }, [store, poke]);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (tapTimer.current) clearTimeout(tapTimer.current);
    if (streakTimer.current) clearTimeout(streakTimer.current);
  }, []);

  // ───────── engine lifecycle ─────────
  const renewRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const prefs = loadPrefs();
    video.volume = prefs.volume;
    video.muted = prefs.muted;
    video.defaultPlaybackRate = prefs.rate;
    video.playbackRate = prefs.rate;
    store.getState().dispatch({ type: "VOLUME", volume: prefs.volume, muted: prefs.muted });
    store.getState().dispatch({ type: "RATE", rate: prefs.rate });
    const engine = new PlayerEngine(video, {
      dispatch: (a) => store.getState().dispatch(a),
      onAuthExpired: () => renewRef.current(),
      preferredHeight: () => loadPrefs().qualityHeight,
    });
    engineRef.current = engine;
    const fsv = video as FsVideo;
    setCaps({
      pip: typeof document !== "undefined" && !!document.pictureInPictureEnabled && !video.disablePictureInPicture,
      fullscreen: canTelegramFullscreen() || !!document.fullscreenEnabled || !!(document as FsDocument & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled || !!fsv.webkitSupportsFullscreen,
    });

    // Persist volume / mute / speed
    const unsub = store.subscribe((s, prev) => {
      if (s.volume !== prev.volume || s.muted !== prev.muted) savePrefs({ volume: s.volume, muted: s.muted });
      if (s.rate !== prev.rate) savePrefs({ rate: s.rate });
    });
    return () => {
      unsub();
      engine.destroy();
      engineRef.current = null;
    };
  }, [store]);

  // Load the manifest whenever a (new) session arrives
  useEffect(() => {
    const engine = engineRef.current;
    if (!session || !engine) return;
    let start = resumeAt.current;
    if (start == null) {
      const resume = session.resumePositionSec || 0;
      // Finished (or nearly) last time → start over
      start = resume > 0 && (!session.durationSec || resume < session.durationSec - 10) ? resume : 0;
    }
    resumeAt.current = null;
    const autoplay = autoplayNext.current;
    autoplayNext.current = true;
    setSessionEnded(false);
    const epId = session.episode?.id ?? null;
    const st = store.getState();
    if (loadedEpisode.current !== undefined && loadedEpisode.current !== epId) {
      // Another episode in the same player: fresh media state, keep volume / speed / fullscreen
      st.dispatch({ type: "RESET_MEDIA" });
      st.setUi({ menu: null });
    }
    if (loadedEpisode.current !== epId) st.nextUpDispatch({ type: "RESET" });
    loadedEpisode.current = epId;
    void engine.load(session.manifestUrl, start, autoplay);

    // Subtitle choice: keep the viewer's language across episodes / renewals, else saved preference → default track
    const subs = selectableSubtitles(session.subtitles);
    const prev = st.subtitleId;
    if (!prev || !subs.some((x) => x.id === prev)) {
      const prefs = loadPrefs();
      st.setUi({ subtitleId: initialSubtitleId(session.subtitles, { lang: prefs.subtitleLang, off: prefs.subtitlesOff }) });
    }

    // API picked the episode (plain /watch/<id>): pin it in the URL so a reload resumes the same one
    if (epId) {
      const url = new URL(window.location.href);
      if (url.searchParams.get("episode") !== epId) {
        url.searchParams.set("episode", epId);
        window.history.replaceState(window.history.state, "", url.pathname + url.search);
      }
    }
  }, [session, store]);

  // Multi-audio: follow the saved audio language whenever a manifest exposes its tracks
  useEffect(() => {
    return store.subscribe((s, prev) => {
      if (s.audioTracks === prev.audioTracks || s.audioTracks.length < 2) return;
      const pick = pickAudioTrack(s.audioTracks, loadPrefs().audioLang, s.activeAudioTrack);
      if (pick != null) engineRef.current?.setAudioTrack(pick);
    });
  }, [store]);

  // Expired signed URLs / access token → silently mint a new session and continue
  useEffect(() => {
    renewRef.current = () => {
      const now = Date.now();
      renewals.current = renewals.current.filter((t) => now - t < 60_000);
      if (renewals.current.length >= MAX_RENEWALS_PER_MIN) {
        store.getState().dispatch({ type: "FATAL", reason: "network" });
        return;
      }
      renewals.current.push(now);
      const v = videoRef.current;
      resumeAt.current = v ? v.currentTime : null;
      autoplayNext.current = !!v && !v.paused;
      sess.renew().catch(() => undefined);
    };
  });

  useHeartbeat({
    sessionId: sessionEnded ? null : (session?.sessionId ?? null),
    intervalSec: session?.heartbeatIntervalSec ?? 10,
    store,
    getBeat,
    onEnded: () => {
      const v = videoRef.current;
      if (v && v.paused && !v.ended && store.getState().started) {
        // Slot expired while paused (e.g. background tab throttled the heartbeat): quietly re-attach
        resumeAt.current = v.currentTime;
        autoplayNext.current = false;
        void sess.renew().catch(() => undefined);
        return;
      }
      engineRef.current?.stop();
      setSessionEnded(true);
    },
  });

  // ───────── session / auth redirects ─────────
  useEffect(() => {
    const e = sess.error;
    if (!e) return;
    const here = window.location.pathname + window.location.search;
    if (e.status === 401 || e.code === "UNAUTHENTICATED") router.replace(reauthUrl(here) ?? `/login?next=${encodeURIComponent(here)}&expired=1`);
    else if (e.code === "PROFILE_REQUIRED") router.replace(`/profiles?next=${encodeURIComponent(here)}`);
  }, [sess.error, router]);

  /** New session, continuing from where the video currently is. */
  const { retry: retrySession } = sess;
  const retryFromHere = useCallback(() => {
    resumeAt.current = videoRef.current?.currentTime ?? null;
    renewals.current = [];
    store.getState().dispatch({ type: "RECOVERED" });
    retrySession();
  }, [retrySession, store]);

  // ───────── series: switch episode in place ─────────
  const { switchEpisode } = sess;
  const playEpisode = useCallback(
    (ep: string | Pick<EpisodeRef, "id">) => {
      const id = typeof ep === "string" ? ep : ep.id;
      const st = store.getState();
      st.setUi({ menu: null });
      if (id === sess.session?.episode?.id) return;
      // Keep the <video> (and fullscreen) — only the source changes
      engineRef.current?.stop();
      st.dispatch({ type: "RESET_MEDIA" });
      st.nextUpDispatch({ type: "RESET" });
      resumeAt.current = null;
      autoplayNext.current = true;
      const url = new URL(window.location.href);
      url.searchParams.set("episode", id);
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
      void switchEpisode(id);
    },
    [store, switchEpisode, sess.session],
  );
  const nextEpisode = session?.nextEpisode ?? null;
  const playNext = useCallback(() => {
    if (nextEpisode) playEpisode(nextEpisode);
  }, [nextEpisode, playEpisode]);
  const skipIntro = useCallback(() => {
    const w = introWindow(session?.markers);
    if (!w) return;
    engineRef.current?.seek(w.end);
    poke();
  }, [session, poke]);

  // Next-episode countdown: feed positions, tick once a second, advance when it hits 0
  useEffect(() => {
    if (!nextEpisode) return;
    const feed = (s: ReturnType<typeof store.getState>) =>
      s.nextUpDispatch({ type: "TIME", time: s.currentTime, duration: s.duration, markers: session?.markers, hasNext: true });
    feed(store.getState());
    const unsub = store.subscribe((s, prev) => {
      if (s.currentTime !== prev.currentTime || s.duration !== prev.duration) feed(s);
      if (s.phase === "ended" && prev.phase !== "ended") s.nextUpDispatch({ type: "ENDED", hasNext: true });
      if (s.nextUp.advance && !prev.nextUp.advance) playNext();
    });
    const tick = setInterval(() => {
      const s = store.getState();
      s.nextUpDispatch({ type: "TICK", running: (s.phase === "playing" && !s.seeking) || s.phase === "ended" });
    }, 1000);
    return () => {
      unsub();
      clearInterval(tick);
    };
  }, [store, nextEpisode, session, playNext]);

  // ───────── commands ─────────
  const goBack = useCallback(() => {
    const doc = document as FsDocument;
    if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => undefined);
    const tg = getTelegram();
    if (tg?.isFullscreen) tg.exitFullscreen?.();
    const nav = (window as Window & { navigation?: { canGoBack?: boolean } }).navigation;
    const canGoBack =
      nav?.canGoBack ?? (window.history.length > 1 && !!document.referrer && document.referrer.startsWith(window.location.origin));
    if (canGoBack) router.back();
    else router.replace("/browse");
  }, [router]);

  /** Browser Fullscreen API on the player root (iOS: native <video> fullscreen). */
  const toggleDomFullscreen = useCallback(() => {
    const doc = document as FsDocument;
    const root = rootRef.current;
    const video = videoRef.current as FsVideo | null;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())?.catch?.(() => undefined);
      return;
    }
    if (root?.requestFullscreen) {
      root
        .requestFullscreen({ navigationUI: "hide" })
        .then(() => {
          const orientation = window.screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
          if (touch) orientation.lock?.("landscape").catch(() => undefined);
        })
        .catch(() => undefined);
    } else video?.webkitEnterFullscreen?.(); // iOS Safari: only the <video> can go fullscreen
  }, [touch]);

  /**
   * Inside the Telegram Mini App (Bot API 8.0+) the whole Mini App goes fullscreen through Telegram — the webview's
   * own Fullscreen API is often unavailable there. The player is `fixed inset-0`, so it fills the screen.
   * `fullscreenFailed` (e.g. unsupported client) falls back to the browser API.
   */
  const toggleFullscreen = useCallback(() => {
    const tg = getTelegram();
    if (!canTelegramFullscreen(tg)) return toggleDomFullscreen();
    if (tg.isFullscreen) tg.exitFullscreen();
    else tg.requestFullscreen();
  }, [toggleDomFullscreen]);

  const togglePip = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    else void v.requestPictureInPicture().catch(() => undefined);
  }, []);

  const controller = useMemo<PlayerController>(() => {
    const st = () => store.getState();
    const engine = () => engineRef.current;
    const seekBy: PlayerController["seekBy"] = (delta, feedback = "center") => {
      engine()?.seekBy(delta);
      if (feedback !== false) {
        const prev = st();
        const streak = prev.feedback && (prev.feedback.kind === "back") === delta < 0 && streakTimer.current ? prev.seekStreak + Math.abs(delta) : Math.abs(delta);
        if (streakTimer.current) clearTimeout(streakTimer.current);
        streakTimer.current = setTimeout(() => {
          streakTimer.current = null;
          st().setUi({ seekStreak: 0 });
        }, 900);
        st().setUi({ seekStreak: streak });
        st().pushFeedback({ kind: delta < 0 ? "back" : "forward", side: feedback });
      }
    };
    return {
      engine,
      togglePlay: (withFeedback = true) => {
        const e = engine();
        if (!e) return;
        const willPlay = e.video.paused || e.video.ended;
        e.toggle();
        if (withFeedback) st().pushFeedback({ kind: willPlay ? "play" : "pause" });
      },
      play: () => void engine()?.play(),
      seek: (t) => engine()?.seek(t),
      seekBy,
      setVolume: (v) => engine()?.setVolume(v),
      toggleMute: () => {
        const e = engine();
        if (e) e.setMuted(!e.video.muted);
      },
      setRate: (r) => {
        const e = engine();
        if (!e) return;
        e.video.defaultPlaybackRate = r;
        e.setRate(r);
      },
      setLevel: (index) => {
        engine()?.setLevel(index);
        const level = st().levels.find((l) => l.index === index);
        savePrefs({ qualityHeight: index === -1 ? null : (level?.height ?? null) });
      },
      setAudioTrack: (id) => {
        engine()?.setAudioTrack(id);
        const lang = st().audioTracks.find((t) => t.id === id)?.lang;
        if (lang) savePrefs({ audioLang: lang });
      },
      setSubtitle: (id) => {
        st().setUi({ subtitleId: id });
        const track = session?.subtitles.find((x) => x.id === id);
        savePrefs(track ? { subtitleLang: track.language, subtitlesOff: false } : { subtitlesOff: true });
      },
      toggleFullscreen,
      togglePip,
      goBack,
      replay: () => {
        const e = engine();
        if (!e) return;
        e.seek(0);
        void e.play();
      },
      poke,
      setMenu: (m: MenuId) => {
        st().setUi({ menu: m });
        poke();
      },
      session,
      detail,
      thumbnails,
      canPip: caps.pip,
      canFullscreen: caps.fullscreen,
      touch,
      titleId,
      nextEpisode,
      playEpisode,
      playNext,
      skipIntro,
    };
  }, [store, session, detail, thumbnails, caps, touch, toggleFullscreen, togglePip, goBack, poke, titleId, nextEpisode, playEpisode, playNext, skipIntro]);
  const ctx = controller;

  // ───────── keyboard ─────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || e.defaultPrevented) return;
      const cmd = commandForKey(e);
      const target = e.target as HTMLElement | null;
      const st = store.getState();
      if (!cmd) {
        if (e.key === "Tab") poke();
        return;
      }
      // Keyboard users activating a focused control keep native button behaviour
      if ((e.key === " " || e.key === "Enter") && target?.closest("button, a, [role='slider']") && target.matches(":focus-visible")) {
        poke();
        return;
      }
      e.preventDefault();
      if (target instanceof HTMLElement && target.closest("button")) target.blur();
      switch (cmd.type) {
        case "togglePlay":
          if (st.phase === "ended") ctx.replay();
          else ctx.togglePlay(true);
          break;
        case "seekBy":
          ctx.seekBy(cmd.seconds, cmd.seconds < 0 ? "left" : "right");
          poke();
          break;
        case "seekToFraction":
          if (st.duration) ctx.seek(st.duration * cmd.fraction);
          poke();
          break;
        case "volumeBy": {
          const e2 = engineRef.current;
          if (!e2) break;
          const base = e2.video.muted ? 0 : e2.video.volume;
          const v = clamp(Math.round((base + cmd.delta) * 10) / 10, 0, 1);
          e2.setVolume(v);
          st.pushFeedback({ kind: v === 0 ? "mute" : "volume", value: Math.round(v * 100) });
          break;
        }
        case "toggleMute": {
          const e2 = engineRef.current;
          if (!e2) break;
          const muting = !e2.video.muted;
          e2.setMuted(muting);
          st.pushFeedback({ kind: muting ? "mute" : "volume", value: Math.round(e2.video.volume * 100) });
          break;
        }
        case "toggleFullscreen":
          toggleFullscreen();
          break;
        case "toggleCaptions": {
          const subs = selectableSubtitles(session?.subtitles ?? []);
          if (!subs.length) break;
          const lang = loadPrefs().subtitleLang;
          ctx.setSubtitle(st.subtitleId ? null : (subs.find((s) => sameLang(s.language, lang)) ?? subs.find((s) => s.isDefault) ?? subs[0]).id);
          poke();
          break;
        }
        case "nextEpisode":
          if (ctx.nextEpisode) ctx.playNext();
          break;
        case "skipIntro":
          if (inIntro(session?.markers, st.currentTime)) ctx.skipIntro();
          break;
        case "escape":
          if (st.menu) st.setUi({ menu: null });
          else if ((document as FsDocument).fullscreenElement) void document.exitFullscreen().catch(() => undefined);
          else if (getTelegram()?.isFullscreen) getTelegram()?.exitFullscreen?.();
          else goBack();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, ctx, poke, toggleFullscreen, goBack, session]);

  // ───────── fullscreen / PiP state ─────────
  useEffect(() => {
    const video = videoRef.current;
    const onFs = () => {
      const doc = document as FsDocument;
      store.getState().setUi({ fullscreen: !!(doc.fullscreenElement || doc.webkitFullscreenElement) });
    };
    const onPipIn = () => store.getState().setUi({ pip: true });
    const onPipOut = () => store.getState().setUi({ pip: false });
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    const tg = getTelegram();
    const onTgFs = () => store.getState().setUi({ fullscreen: !!tg?.isFullscreen });
    const onTgFsFailed = (e: unknown) => {
      // Already fullscreen is fine; anything else → try the browser API instead
      if ((e as { error?: string } | undefined)?.error !== "ALREADY_FULLSCREEN") toggleDomFullscreen();
    };
    tg?.onEvent("fullscreenChanged", onTgFs);
    tg?.onEvent("fullscreenFailed", onTgFsFailed);
    video?.addEventListener("enterpictureinpicture", onPipIn);
    video?.addEventListener("leavepictureinpicture", onPipOut);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
      tg?.offEvent("fullscreenChanged", onTgFs);
      tg?.offEvent("fullscreenFailed", onTgFsFailed);
      video?.removeEventListener("enterpictureinpicture", onPipIn);
      video?.removeEventListener("leavepictureinpicture", onPipOut);
    };
  }, [store, toggleDomFullscreen]);

  // ───────── Media Session (lock screen, hardware keys) ─────────
  useEffect(() => {
    if (!("mediaSession" in navigator) || !session) return;
    const ms = navigator.mediaSession;
    const art = session.title.backdrop?.url ?? detail?.backdrop?.url ?? detail?.poster?.url;
    try {
      ms.metadata = new MediaMetadata({
        title: session.episode ? `${session.title.name} – ${episodeLabel(session.episode)}` : session.title.name,
        artist: "Lumio",
        artwork: art ? [{ src: art, sizes: "1280x720" }] : [],
      });
    } catch {
      /* MediaMetadata unsupported */
    }
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action unsupported */
      }
    };
    set("play", () => void engineRef.current?.play());
    set("pause", () => engineRef.current?.pause());
    set("seekbackward", (d) => engineRef.current?.seekBy(-(d.seekOffset ?? 10)));
    set("seekforward", (d) => engineRef.current?.seekBy(d.seekOffset ?? 10));
    set("seekto", (d) => d.seekTime != null && engineRef.current?.seek(d.seekTime));
    set("nexttrack", session.nextEpisode ? () => playNext() : null);
    const updatePosition = () => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
      try {
        ms.setPositionState({ duration: v.duration, position: Math.min(v.currentTime, v.duration), playbackRate: v.playbackRate || 1 });
      } catch {
        /* ignore */
      }
    };
    const unsub = store.subscribe((s, prev) => {
      if (s.phase !== prev.phase || s.seeking !== prev.seeking || s.rate !== prev.rate || s.duration !== prev.duration) {
        updatePosition();
        ms.playbackState = s.phase === "playing" ? "playing" : s.phase === "paused" || s.phase === "ended" ? "paused" : "none";
      }
    });
    return () => {
      unsub();
      for (const a of ["play", "pause", "seekbackward", "seekforward", "seekto", "nexttrack"] as MediaSessionAction[]) set(a, null);
      ms.metadata = null;
    };
  }, [session, detail, store, playNext]);

  // ───────── pointer / touch gestures on the stage ─────────
  const onStagePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const st = store.getState();
    if (st.menu) {
      st.setUi({ menu: null });
      return;
    }
    if (st.phase === "blocked" || st.phase === "ended") return;
    const now = performance.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;

    if (e.pointerType === "mouse") {
      if (e.button !== 0) return;
      if (tapTimer.current) {
        // Double click → fullscreen (cancel the pending play/pause)
        clearTimeout(tapTimer.current);
        tapTimer.current = null;
        toggleFullscreen();
        return;
      }
      tapTimer.current = setTimeout(() => {
        tapTimer.current = null;
        ctx.togglePlay(true);
      }, 220);
      poke();
      return;
    }

    // Touch / pen
    const last = lastTap.current;
    const isDouble = last && now - last.t < DOUBLE_TAP_MS * 1.3 && Math.abs(e.clientX - last.x) < 80;
    lastTap.current = { t: now, x: e.clientX };
    const side = rel < 0.35 ? "left" : rel > 0.65 ? "right" : null;
    if ((isDouble || (streakTimer.current && side)) && side) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = null;
      ctx.seekBy(side === "left" ? -10 : 10, side);
      return;
    }
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      const s2 = store.getState();
      if (s2.chromeVisible) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        s2.setUi({ chromeVisible: false });
      } else poke();
    }, DOUBLE_TAP_MS);
  };

  // ───────── render ─────────
  const backdropUrl = session?.title.backdrop?.url ?? detail?.backdrop?.url ?? null;
  const titleName = session?.title.name ?? detail?.name ?? null;

  let screenKind: ScreenKind | null = null;
  let resumeOnRetry = true;
  if (sess.status === "error" && sess.error.code !== "UNAUTHENTICATED" && sess.error.code !== "PROFILE_REQUIRED") {
    screenKind = sessionErrorKind(sess.error);
    resumeOnRetry = false;
  } else if (sessionEnded) {
    screenKind = "SESSION_ENDED";
  } else if (phase === "error") {
    screenKind = fatal === "network" ? "NETWORK" : fatal === "unsupported" ? "UNSUPPORTED" : fatal === "media" ? "MEDIA" : "GENERIC";
  }

  const hideCursor = !chromeVisible && started && !screenKind && phase !== "ended";

  return (
    <PlayerControllerContext.Provider value={ctx}>
      {titleName && <title>{`${titleName} | Lumio`}</title>}
      <div
        ref={rootRef}
        data-testid="player"
        data-phase={phase}
        className={cn(
          "fixed inset-0 z-[60] overflow-hidden bg-black text-white select-none [-webkit-touch-callout:none]",
          hideCursor && "cursor-none",
        )}
        onPointerMove={(e) => e.pointerType === "mouse" && poke()}
        onFocusCapture={() => poke()}
      >
        <video
          ref={videoRef}
          className="absolute inset-0 size-full bg-black object-contain"
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          disableRemotePlayback={false}
          aria-label={titleName ?? "Video"}
          data-testid="player-video"
        />

        {/* Gesture layer (click / tap / double-tap) */}
        <div className="absolute inset-0 z-[1]" onPointerUp={onStagePointerUp} data-testid="player-stage" />

        <IntroOverlay />
        <SubtitleOverlay cues={subtitleCues} />
        <BufferingSpinner />
        <CenterFeedback />
        <TouchCenterControls />
        <PausedOverlay />
        <TopBar />
        <BottomBar />
        <SkipIntroButton />
        <NextUpCard />
        <BlockedOverlay />
        <EndScreen />

        {screenKind && (
          <PlayerScreen
            kind={screenKind}
            backdropUrl={backdropUrl}
            titleName={titleName ?? detail?.name}
            onRetry={resumeOnRetry ? retryFromHere : retrySession}
            onBack={goBack}
            retrying={sess.status === "loading"}
          />
        )}
      </div>
    </PlayerControllerContext.Provider>
  );
}
