"use client";

import { useEffect, useState } from "react";
import { parseSubtitleVtt, parseThumbnailVtt, type TextCue, type ThumbnailCue } from "../lib/vtt";

/** CDN files: plain CORS GET, never with credentials. */
async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, { credentials: "omit", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function useThumbnails(vttUrl: string | null | undefined): ThumbnailCue[] {
  const [cues, setCues] = useState<ThumbnailCue[]>([]);
  useEffect(() => {
    if (!vttUrl) return;
    const ctrl = new AbortController();
    fetchText(vttUrl, ctrl.signal)
      .then((text) => {
        const parsed = parseThumbnailVtt(text, vttUrl);
        setCues(parsed);
        // Warm the sprite sheets so the first hover is instant
        for (const url of new Set(parsed.map((c) => c.url))) {
          const img = new Image();
          img.decoding = "async";
          img.src = url;
        }
      })
      .catch(() => undefined); // thumbnails are a nicety: fail silently
    return () => ctrl.abort();
  }, [vttUrl]);
  return vttUrl ? cues : [];
}

export function useSubtitleCues(url: string | null): { cues: TextCue[]; error: boolean } {
  const [state, setState] = useState<{ url: string | null; cues: TextCue[]; error: boolean }>({ url: null, cues: [], error: false });
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    fetchText(url, ctrl.signal)
      .then((text) => setState({ url, cues: parseSubtitleVtt(text), error: false }))
      .catch((e: unknown) => {
        if ((e as DOMException)?.name !== "AbortError") setState({ url, cues: [], error: true });
      });
    return () => ctrl.abort();
  }, [url]);
  return state.url === url && url ? { cues: state.cues, error: state.error } : { cues: [], error: false };
}
