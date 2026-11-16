"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { usePlayer } from "../controller";
import { episodeLabel, formatClock, formatRemainingClock } from "../lib/format";
import { usePlayerStore } from "../store";
import { ControlButton } from "./control-button";
import {
  Back10Icon,
  BackArrowIcon,
  ExitFullscreenIcon,
  Forward10Icon,
  FullscreenIcon,
  NextEpisodeIcon,
  PauseIcon,
  PipIcon,
  PlayIcon,
} from "./icons";
import { AudioSubtitleMenu, QualityMenu, SpeedMenu } from "./menus";
import { Scrubber } from "./scrubber";
import { VolumeControl } from "./volume";

function useChromeVisible() {
  return usePlayerStore((s) => s.chromeVisible || s.menu !== null || s.phase === "blocked");
}

export function TopBar() {
  const { goBack } = usePlayer();
  const visible = useChromeVisible();
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start bg-gradient-to-b from-black/75 via-black/30 to-transparent px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-16 transition-opacity duration-300 md:px-6 md:pt-5",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <ControlButton
        label="Quay lại"
        onClick={goBack}
        data-testid="player-back"
        className={cn("size-12 [&>svg]:size-8 md:size-14 md:[&>svg]:size-10", visible ? "pointer-events-auto" : "pointer-events-none")}
        tabIndex={visible ? 0 : -1}
      >
        <BackArrowIcon />
      </ControlButton>
    </div>
  );
}

function PlayPauseButton({ size = "md" }: { size?: "md" | "lg" }) {
  const { togglePlay } = usePlayer();
  const playing = usePlayerStore((s) => s.phase === "playing" || (s.phase === "loading" && s.started));
  return (
    <ControlButton size={size} label={playing ? "Tạm dừng (Space)" : "Phát (Space)"} onClick={() => togglePlay(false)} data-testid="play-pause">
      {playing ? <PauseIcon /> : <PlayIcon />}
    </ControlButton>
  );
}

function TimeReadout() {
  const sec = usePlayerStore((s) => Math.floor(s.currentTime));
  const duration = usePlayerStore((s) => s.duration);
  const [showElapsed, setShowElapsed] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setShowElapsed((v) => !v)}
      title={showElapsed ? "Hiện thời gian còn lại" : "Hiện thời gian đã xem"}
      data-testid="time-readout"
      className="shrink-0 rounded px-1 text-sm font-medium tabular-nums text-white/90 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-white md:text-base"
    >
      {showElapsed ? `${formatClock(sec)} / ${formatClock(duration)}` : formatRemainingClock(sec, duration)}
    </button>
  );
}

function TitleLabel({ className }: { className?: string }) {
  const { session, detail } = usePlayer();
  const name = session?.title.name ?? detail?.name ?? "";
  const ep = episodeLabel(session?.episode ?? null);
  return (
    <p className={cn("min-w-0 truncate text-center text-white", className)} data-testid="player-title">
      <span className="font-bold">{name}</span>
      {ep && <span className="ml-3 font-normal text-white/80">{ep}</span>}
    </p>
  );
}

export function BottomBar() {
  const { seekBy, toggleFullscreen, togglePip, canPip, canFullscreen, touch, nextEpisodeHref } = usePlayer();
  const visible = useChromeVisible();
  const fullscreen = usePlayerStore((s) => s.fullscreen);
  const pip = usePlayerStore((s) => s.pip);

  return (
    <div
      data-testid="player-controls"
      data-visible={visible}
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pt-28 pb-[max(0.5rem,env(safe-area-inset-bottom))] transition-opacity duration-300 sm:px-5 md:px-8 md:pb-5",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <div
        className={cn(visible && "pointer-events-auto")}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
      <div className="flex items-center gap-3 md:gap-5">
        <Scrubber />
        <TimeReadout />
      </div>

      {touch ? (
        // Phones/tablets: centre transport lives in <TouchCenterControls/>; keep the bar light
        <div className="mt-1 flex items-center gap-1">
          <TitleLabel className="flex-1 px-1 text-left text-sm sm:text-base" />
          <SpeedMenu />
          <AudioSubtitleMenu />
          <QualityMenu />
          {nextEpisodeHref && (
            <Link href={nextEpisodeHref} aria-label="Tập tiếp theo" className="grid size-11 place-items-center text-white [&>svg]:size-7">
              <NextEpisodeIcon />
            </Link>
          )}
          {canFullscreen && (
            <ControlButton label={fullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"} onClick={toggleFullscreen}>
              {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
            </ControlButton>
          )}
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1 md:gap-3 lg:gap-4">
          <div className="flex items-center gap-1 md:gap-3 lg:gap-5">
            <PlayPauseButton />
            <ControlButton label="Tua lại 10 giây (←)" onClick={() => seekBy(-10, "left")} data-testid="seek-back">
              <Back10Icon />
            </ControlButton>
            <ControlButton label="Tua tới 10 giây (→)" onClick={() => seekBy(10, "right")} data-testid="seek-forward">
              <Forward10Icon />
            </ControlButton>
            <VolumeControl />
          </div>
          <TitleLabel className="flex-1 px-2 text-base md:px-4 md:text-lg lg:text-xl" />
          <div className="flex items-center gap-1 md:gap-3 lg:gap-5">
            {nextEpisodeHref && (
              <Link
                href={nextEpisodeHref}
                aria-label="Tập tiếp theo"
                title="Tập tiếp theo"
                className="grid size-11 place-items-center rounded-full text-white transition-transform hover:scale-[1.18] lg:size-12 [&>svg]:size-7 lg:[&>svg]:size-8"
              >
                <NextEpisodeIcon />
              </Link>
            )}
            <AudioSubtitleMenu />
            <SpeedMenu />
            <QualityMenu />
            {canPip && (
              <ControlButton label={pip ? "Thoát hình trong hình" : "Hình trong hình"} onClick={togglePip} active={pip}>
                <PipIcon />
              </ControlButton>
            )}
            {canFullscreen && (
              <ControlButton label={fullscreen ? "Thoát toàn màn hình (F)" : "Toàn màn hình (F)"} onClick={toggleFullscreen} data-testid="fullscreen">
                {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
              </ControlButton>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

/** Touch layout: big transport row in the middle of the screen (like mobile streaming apps). */
export function TouchCenterControls() {
  const { seekBy, touch } = usePlayer();
  const visible = useChromeVisible();
  const busy = usePlayerStore((s) => s.phase === "loading" || s.buffering || s.phase === "blocked" || s.phase === "ended");
  if (!touch) return null;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "absolute inset-0 z-10 m-auto flex h-24 w-fit items-center gap-10 transition-opacity duration-300 sm:gap-16",
        visible && !busy ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <ControlButton label="Tua lại 10 giây" onClick={() => seekBy(-10, "left")} size="lg">
        <Back10Icon />
      </ControlButton>
      <div className="grid size-20 place-items-center rounded-full bg-black/35">
        <PlayPauseButton size="lg" />
      </div>
      <ControlButton label="Tua tới 10 giây" onClick={() => seekBy(10, "right")} size="lg">
        <Forward10Icon />
      </ControlButton>
    </div>
  );
}
