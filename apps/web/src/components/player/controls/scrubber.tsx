"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { usePlayer } from "../controller";
import { clamp, formatClock, formatSpokenTime } from "../lib/format";
import { findCueAt } from "../lib/vtt";
import { usePlayerStore } from "../store";

/**
 * Progress bar: played + buffered ranges, hover preview (sprite frame + time), drag to seek,
 * full keyboard support. Seeks on release so dragging stays smooth on slow networks.
 */
export function Scrubber() {
  const { seek, seekBy, thumbnails, poke, touch } = usePlayer();
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const bufferedEnd = usePlayerStore((s) => s.bufferedEnd);
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; width: number } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const timeAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || !duration) return { time: 0, x: 0, width: rect?.width ?? 0 };
    const x = clamp(clientX - rect.left, 0, rect.width);
    return { time: (x / rect.width) * duration, x, width: rect.width };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!duration || e.button > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { time, x, width } = timeAt(e.clientX);
    setDrag(time);
    setHover({ x, width });
    poke();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const { time, x, width } = timeAt(e.clientX);
    if (drag !== null) {
      setDrag(time);
      poke();
    }
    if (e.pointerType === "mouse" || drag !== null) setHover({ x, width });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const { time } = timeAt(e.clientX);
    seek(time);
    setDrag(null);
    if (e.pointerType !== "mouse") setHover(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const map: Record<string, () => void> = {
      ArrowLeft: () => seekBy(-10, false),
      ArrowRight: () => seekBy(10, false),
      ArrowDown: () => seekBy(-10, false),
      ArrowUp: () => seekBy(10, false),
      PageDown: () => seekBy(-60, false),
      PageUp: () => seekBy(60, false),
      Home: () => seek(0),
      End: () => seek(Math.max(0, duration - 1)),
    };
    const fn = map[e.key];
    if (fn) {
      e.preventDefault();
      e.stopPropagation();
      fn();
      poke();
    }
  };

  const shown = drag ?? currentTime;
  const pct = duration ? clamp((shown / duration) * 100, 0, 100) : 0;
  const bufPct = duration ? clamp((bufferedEnd / duration) * 100, 0, 100) : 0;
  const previewTime = hover && duration ? (hover.x / Math.max(1, hover.width)) * duration : null;
  const active = hover !== null || drag !== null;

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Thanh tua"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={`${formatSpokenTime(shown)} trên ${formatSpokenTime(duration)}`}
      data-testid="scrubber"
      className={cn(
        "group/scrub relative flex w-full cursor-pointer touch-none items-center outline-none",
        touch ? "h-10" : "h-7",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => drag === null && setHover(null)}
      onKeyDown={onKeyDown}
    >
      <div
        className={cn(
          "relative h-[5px] w-full overflow-hidden rounded-full bg-white/25 transition-[height] duration-150 ease-out",
          (active || touch) && "h-[7px]",
          "group-hover/scrub:h-[9px] group-focus-visible/scrub:h-[9px]",
        )}
      >
        <div className="absolute inset-y-0 left-0 bg-white/40" style={{ width: `${bufPct}%` }} />
        {hover && !touch && (
          <div className="absolute inset-y-0 left-0 bg-white/25" style={{ width: `${(hover.x / Math.max(1, hover.width)) * 100}%` }} />
        )}
        <div className="absolute inset-y-0 left-0 bg-[var(--brand,#e50914)]" style={{ width: `${pct}%` }} />
      </div>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--brand,#e50914)] shadow-[0_0_0_4px_rgb(0_0_0/0.15)] transition-transform duration-150",
          active ? "scale-125" : touch ? "scale-100" : "scale-90 group-hover/scrub:scale-125",
          "group-focus-visible/scrub:ring-2 group-focus-visible/scrub:ring-white",
        )}
        style={{ left: `${pct}%` }}
      />
      {previewTime !== null && hover && <ScrubPreview time={previewTime} x={hover.x} width={hover.width} cues={thumbnails} />}
    </div>
  );
}

function ScrubPreview({ time, x, width, cues }: { time: number; x: number; width: number; cues: ReturnType<typeof usePlayer>["thumbnails"] }) {
  const cue = findCueAt(cues, time);
  // Sprite frames are small (≈160×90): scale up to a comfortable preview size
  const targetW = width < 500 ? 176 : 272;
  const scale = cue && cue.w ? targetW / cue.w : 1;
  const boxW = cue && cue.w ? cue.w * scale : 0;
  const boxH = cue && cue.h ? cue.h * scale : 0;
  const bubbleW = Math.max(boxW, 64);
  const left = clamp(x - bubbleW / 2, 0, Math.max(0, width - bubbleW));

  return (
    <div
      data-testid="scrub-preview"
      className="pointer-events-none absolute bottom-full mb-4 flex flex-col items-center gap-1.5"
      style={{ left, width: bubbleW }}
    >
      {cue && cue.w > 0 && (
        <div
          className="relative overflow-hidden rounded-md bg-black shadow-[0_8px_30px_rgb(0_0_0/0.6)] ring-2 ring-white/90"
          style={{ width: boxW, height: boxH }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- sprite sheet cropped via transform */}
          <img
            src={cue.url}
            alt=""
            draggable={false}
            className="absolute top-0 left-0 max-w-none origin-top-left"
            style={{ transform: `translate(${-cue.x * scale}px, ${-cue.y * scale}px) scale(${scale})` }}
          />
        </div>
      )}
      <span className="rounded bg-black/70 px-2 py-0.5 text-sm font-semibold tabular-nums text-white shadow">{formatClock(time)}</span>
    </div>
  );
}
