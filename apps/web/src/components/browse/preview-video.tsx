"use client";

import type Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import { usePreviewSource } from "@/lib/queries";
import { useUI } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

interface PreviewVideoProps {
  titleId: string;
  /** Load + play only while true (hover settled, billboard in view, modal open…) */
  active: boolean;
  /** Pause without tearing down (scrolled away, modal on top) */
  paused?: boolean;
  className?: string;
  /** Called when playback actually starts / ends, so the parent can fade artwork */
  onPlayingChange?: (playing: boolean) => void;
  loop?: boolean;
}

/**
 * Muted autoplaying HLS preview (hls.js, or native HLS on Safari). Renders nothing visible
 * until frames are actually playing, so callers keep showing the backdrop as a fallback.
 */
export function PreviewVideo({ titleId, active, paused, className, onPlayingChange, loop = false }: PreviewVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const muted = useUI((s) => s.muted);
  const { data: source } = usePreviewSource(titleId, active);
  const [playing, setPlaying] = useState(false);
  const onPlayingRef = useRef(onPlayingChange);
  useEffect(() => {
    onPlayingRef.current = onPlayingChange;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source || !active) return;
    let hls: Hls | null = null;
    let cancelled = false;

    (async () => {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = source.manifestUrl;
      } else {
        const { default: HlsCtor } = await import("hls.js");
        if (cancelled || !HlsCtor.isSupported()) return;
        hls = new HlsCtor({ capLevelToPlayerSize: true, startLevel: -1, maxBufferLength: 20 });
        hls.loadSource(source.manifestUrl);
        hls.attachMedia(video);
        hls.on(HlsCtor.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            hls?.destroy();
            hls = null;
            setPlaying(false);
          }
        });
      }
      video.play().catch(() => undefined);
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
      setPlaying(false);
    };
  }, [source, active]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source || !active) return;
    if (paused) video.pause();
    else video.play().catch(() => undefined);
  }, [paused, source, active]);

  useEffect(() => {
    onPlayingRef.current?.(playing);
  }, [playing]);

  return (
    <video
      ref={videoRef}
      muted={muted}
      playsInline
      loop={loop}
      preload="none"
      aria-hidden
      tabIndex={-1}
      onPlaying={() => setPlaying(true)}
      onEnded={() => setPlaying(false)}
      className={cn(
        "pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-700",
        playing && active ? "opacity-100" : "opacity-0",
        className,
      )}
    />
  );
}
