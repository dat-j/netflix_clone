"use client";

import type { HeartbeatBody } from "@app/shared";
import { useEffect, useRef } from "react";
import { api, ApiRequestError } from "@/lib/api/client";
import type { PlayerStore } from "../store";

/**
 * Keeps the concurrent-stream slot alive and records watch progress:
 * every `intervalSec` while the session is open, plus on pause and once a seek settles.
 * 410 SESSION_ENDED (slot taken by another device) → `onEnded`.
 */
export function useHeartbeat({
  sessionId,
  intervalSec,
  store,
  getBeat,
  onEnded,
}: {
  sessionId: string | null;
  intervalSec: number;
  store: PlayerStore;
  getBeat: () => HeartbeatBody | null;
  onEnded: () => void;
}) {
  const getBeatRef = useRef(getBeat);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    getBeatRef.current = getBeat;
    onEndedRef.current = onEnded;
  });

  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    let inFlight = false;
    let lastSent = 0;

    const send = async () => {
      if (stopped || inFlight) return;
      const body = getBeatRef.current();
      if (!body) return;
      inFlight = true;
      lastSent = Date.now();
      try {
        await api(`/playback/sessions/${sessionId}/heartbeat`, { method: "POST", body });
      } catch (e) {
        if (stopped) return;
        if (e instanceof ApiRequestError && (e.statusCode === 410 || e.code === "SESSION_ENDED")) {
          stopped = true;
          onEndedRef.current();
        }
        // Other failures (offline, 5xx) are retried on the next tick
      } finally {
        inFlight = false;
      }
    };

    const ms = Math.max(5, intervalSec || 10) * 1000;
    const timer = setInterval(() => {
      if (Date.now() - lastSent >= ms - 250) void send();
    }, 1000);

    let seekTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = store.subscribe((s, prev) => {
      if (s.phase === "paused" && prev.phase === "playing") void send();
      if (s.phase === "ended" && prev.phase !== "ended") void send();
      if (prev.seeking && !s.seeking) {
        if (seekTimer) clearTimeout(seekTimer);
        seekTimer = setTimeout(() => void send(), 1200);
      }
    });

    // First beat soon after start so "Xem tiếp" reflects the session immediately
    const first = setTimeout(() => void send(), 3000);

    return () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(first);
      if (seekTimer) clearTimeout(seekTimer);
      unsub();
    };
  }, [sessionId, intervalSec, store]);
}
