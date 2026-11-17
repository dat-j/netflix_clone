"use client";

import type { ApiErrorCode, HeartbeatBody, PlaybackSession, StartPlaybackBody } from "@app/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiRequestError, buildUrl } from "@/lib/api/client";

export type SessionError = { code: ApiErrorCode | "NETWORK"; status: number; message: string };

export type SessionState =
  | { status: "loading"; session: null; error: null }
  | { status: "ready"; session: PlaybackSession; error: null }
  | { status: "error"; session: null; error: SessionError };

/**
 * React StrictMode (dev) mounts → unmounts → re-mounts effects. Without care that would mint two
 * sessions and burn a concurrent-stream slot. In-flight starts are shared per key and the
 * DELETE on unmount is deferred so an immediate re-mount can cancel it.
 */
const inflight = new Map<string, Promise<PlaybackSession>>();
const pendingEnds = new Map<string, ReturnType<typeof setTimeout>>();

function startSession(key: string, body: StartPlaybackBody): Promise<PlaybackSession> {
  let p = inflight.get(key);
  if (!p) {
    p = api<PlaybackSession>("/playback/sessions", { method: "POST", body });
    inflight.set(key, p);
    const drop = () => setTimeout(() => inflight.get(key) === p && inflight.delete(key), 1500);
    p.then(drop, drop);
  }
  return p;
}

/** Fire-and-forget that survives page unload (keepalive). */
export function beacon(path: string, method: "POST" | "DELETE", body?: unknown) {
  try {
    void fetch(buildUrl(path), {
      method,
      keepalive: true,
      credentials: "include",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

export function endSessionNow(sessionId: string, finalBeat?: HeartbeatBody | null) {
  if (finalBeat) beacon(`/playback/sessions/${sessionId}/heartbeat`, "POST", finalBeat);
  beacon(`/playback/sessions/${sessionId}`, "DELETE");
}

function scheduleEnd(sessionId: string, finalBeat: HeartbeatBody | null) {
  clearTimeout(pendingEnds.get(sessionId));
  pendingEnds.set(
    sessionId,
    setTimeout(() => {
      pendingEnds.delete(sessionId);
      endSessionNow(sessionId, finalBeat);
    }, 400),
  );
}

function cancelEnd(sessionId: string) {
  const t = pendingEnds.get(sessionId);
  if (t) {
    clearTimeout(t);
    pendingEnds.delete(sessionId);
  }
}

function toSessionError(e: unknown): SessionError {
  if (e instanceof ApiRequestError) return { code: e.code, status: e.statusCode, message: e.message };
  return { code: "NETWORK", status: 0, message: "Không thể kết nối máy chủ." };
}

export function usePlaybackSession(
  titleId: string,
  initialEpisodeId: string | null,
  /** Snapshot for the final heartbeat when the player goes away */
  getFinalBeat: () => HeartbeatBody | null,
) {
  const [attempt, setAttempt] = useState(0);
  /** Episode being played; changes in place when the player moves to another episode (no remount) */
  const [episodeId, setEpisodeId] = useState(initialEpisodeId);
  const [state, setState] = useState<SessionState>({ status: "loading", session: null, error: null });
  const current = useRef<PlaybackSession | null>(null);
  /** Sessions already ended explicitly (episode switch) — the effect cleanup must not end them again */
  const endedExplicitly = useRef(new Set<string>());
  const finalBeat = useRef(getFinalBeat);
  useEffect(() => {
    finalBeat.current = getFinalBeat;
  });

  useEffect(() => {
    let cancelled = false;
    const explicit = endedExplicitly.current;
    const key = `${titleId}|${episodeId ?? ""}|${attempt}`;
    const p = startSession(key, { titleId, ...(episodeId ? { episodeId } : {}) });
    p.then(
      (s) => {
        cancelEnd(s.sessionId);
        if (cancelled) return;
        current.current = s;
        setState({ status: "ready", session: s, error: null });
      },
      (e: unknown) => {
        if (!cancelled) setState({ status: "error", session: null, error: toSessionError(e) });
      },
    );
    return () => {
      cancelled = true;
      p.then(
        (s) => {
          if (explicit.has(s.sessionId)) return;
          scheduleEnd(s.sessionId, current.current?.sessionId === s.sessionId ? finalBeat.current() : null);
        },
        () => undefined,
      );
    };
  }, [titleId, episodeId, attempt]);

  // Leaving the page (tab close / reload / bfcache) — React cleanup doesn't run reliably here
  useEffect(() => {
    const onHide = () => {
      const s = current.current;
      if (s) endSessionNow(s.sessionId, finalBeat.current());
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  /** Start over with a brand new session (retry after an error screen). */
  const retry = useCallback(() => {
    const s = current.current;
    if (s) endSessionNow(s.sessionId, null);
    current.current = null;
    setState({ status: "loading", session: null, error: null });
    setAttempt((a) => a + 1);
  }, []);

  /**
   * Move to another episode without unmounting the player: report the final position of the current
   * session and END it first (frees the concurrent-stream slot), then mint the next session.
   */
  const switchEpisode = useCallback(async (nextEpisodeId: string) => {
    const old = current.current;
    current.current = null;
    if (old) {
      endedExplicitly.current.add(old.sessionId);
      const beat = finalBeat.current();
      if (beat) {
        await fetch(buildUrl(`/playback/sessions/${old.sessionId}/heartbeat`), {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(beat),
        }).catch(() => undefined);
      }
      await fetch(buildUrl(`/playback/sessions/${old.sessionId}`), { method: "DELETE", credentials: "include" }).catch(() => undefined);
    }
    setState({ status: "loading", session: null, error: null });
    setEpisodeId(nextEpisodeId);
  }, []);

  /**
   * Mint a replacement session without unmounting the player (token expiry). Ends the old one
   * first so we don't need a spare concurrent-stream slot.
   */
  const renew = useCallback(async (): Promise<PlaybackSession> => {
    const old = current.current;
    if (old) {
      endedExplicitly.current.add(old.sessionId);
      await fetch(buildUrl(`/playback/sessions/${old.sessionId}`), { method: "DELETE", credentials: "include" }).catch(() => undefined);
    }
    // Keep playing the same episode even when the URL had none (API-picked "xem tiếp" episode)
    const ep = episodeId ?? old?.episode?.id ?? null;
    try {
      const s = await api<PlaybackSession>("/playback/sessions", { method: "POST", body: { titleId, ...(ep ? { episodeId: ep } : {}) } });
      current.current = s;
      setState({ status: "ready", session: s, error: null });
      return s;
    } catch (e) {
      current.current = null;
      setState({ status: "error", session: null, error: toSessionError(e) });
      throw e;
    }
  }, [titleId, episodeId]);

  return { ...state, episodeId, retry, renew, switchEpisode };
}
