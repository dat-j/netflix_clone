"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { usePlayer } from "../controller";
import { clamp } from "../lib/format";
import { usePlayerStore } from "../store";
import { VolumeIcon } from "./icons";
import { ControlButton } from "./control-button";

/** Mute button with a vertical slider that expands on hover/focus (desktop only). */
export function VolumeControl() {
  const { toggleMute, setVolume, poke } = usePlayer();
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const effective = muted ? 0 : volume;
  const level = effective === 0 ? 0 : effective < 0.34 ? 1 : effective < 0.67 ? 2 : 3;

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 250);
  };

  return (
    <div className="relative flex items-center" onPointerEnter={(e) => e.pointerType === "mouse" && show()} onPointerLeave={hide} onFocus={show} onBlur={hide}>
      <ControlButton label={muted || volume === 0 ? "Bật tiếng (M)" : "Tắt tiếng (M)"} onClick={toggleMute} data-testid="mute-button">
        <VolumeIcon level={level as 0 | 1 | 2 | 3} />
      </ControlButton>
      <div
        className={cn(
          "absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 rounded-md bg-[#262626]/95 px-3.5 py-5 shadow-2xl ring-1 ring-white/10 transition-[opacity,translate] duration-150",
          open ? "visible translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0",
        )}
      >
        <VerticalSlider value={effective} onChange={(v) => { setVolume(v); poke(); }} />
      </div>
    </div>
  );
}

function VerticalSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const valueAt = (clientY: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return value;
    return clamp(1 - (clientY - r.top) / r.height, 0, 1);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(valueAt(e.clientY));
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => dragging.current && onChange(valueAt(e.clientY));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowUp" || e.key === "ArrowRight" ? 0.1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -0.1 : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(clamp(Math.round((value + step) * 10) / 10, 0, 1));
  };
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Âm lượng"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      data-testid="volume-slider"
      className="group/vol relative flex h-28 w-4 cursor-pointer touch-none justify-center outline-none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => (dragging.current = false)}
      onKeyDown={onKey}
    >
      <div className="relative h-full w-[5px] overflow-hidden rounded-full bg-white/30">
        <div className="absolute inset-x-0 bottom-0 bg-[var(--brand,#e50914)]" style={{ height: `${value * 100}%` }} />
      </div>
      <div
        className="pointer-events-none absolute left-1/2 size-3.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-[var(--brand,#e50914)] group-focus-visible/vol:ring-2 group-focus-visible/vol:ring-white"
        style={{ bottom: `${value * 100}%` }}
      />
    </div>
  );
}
