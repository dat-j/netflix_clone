"use client";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { episodeCode, episodeName } from "@/lib/episodes";
import { usePlayer } from "./controller";
import { PlayIcon } from "./controls/icons";
import { inIntro, NEXT_UP_COUNTDOWN_SEC } from "./lib/series";
import { usePlayerStore } from "./store";

/** The chrome is up → overlays in the bottom-right corner sit above the control bar. */
function useLifted() {
  return usePlayerStore((s) => s.chromeVisible || s.menu !== null);
}

/** "Bỏ qua phần mở đầu" while the playhead is inside the intro markers (S key). */
export function SkipIntroButton() {
  const { session, skipIntro } = usePlayer();
  const show = usePlayerStore((s) => s.started && s.phase !== "ended" && s.phase !== "error" && inIntro(session?.markers, s.currentTime));
  const lifted = useLifted();
  return (
    <AnimatePresence>
      {show && (
        <motion.button
          key="skip-intro"
          type="button"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={(e) => {
            e.stopPropagation();
            skipIntro();
          }}
          onPointerUp={(e) => e.stopPropagation()}
          data-testid="skip-intro"
          title="Bỏ qua phần mở đầu (S)"
          className={cn(
            "absolute right-4 z-[22] inline-flex h-11 items-center gap-2 rounded-[4px] border-2 border-white/80 bg-black/55 px-4 text-[15px] font-bold text-white shadow-[0_6px_24px_rgb(0_0_0/0.45)] backdrop-blur-sm transition-[bottom,background-color] duration-300",
            "outline-none hover:bg-white hover:text-black focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black md:right-10 md:h-14 md:px-6 md:text-lg",
            lifted ? "bottom-[calc(8.5rem+env(safe-area-inset-bottom))] md:bottom-40" : "bottom-[calc(2rem+env(safe-area-inset-bottom))] md:bottom-12",
          )}
        >
          Bỏ qua phần mở đầu
        </motion.button>
      )}
    </AnimatePresence>
  );
}

/**
 * "Tập tiếp theo" card from the credits marker (or the last ~20 s): still, episode, countdown that
 * auto-advances, "Xem phần credit" to dismiss, the main button to play immediately (N key).
 */
export function NextUpCard() {
  const { nextEpisode, playNext, detail, touch } = usePlayer();
  const nextUp = usePlayerStore((s) => s.nextUp);
  const nextUpDispatch = usePlayerStore((s) => s.nextUpDispatch);
  const ended = usePlayerStore((s) => s.phase === "ended");
  const paused = usePlayerStore((s) => s.phase === "paused");
  const lifted = useLifted();
  const show = !!nextEpisode && nextUp.visible;
  const elapsed = NEXT_UP_COUNTDOWN_SEC - nextUp.remaining;
  const still = nextEpisode?.still?.url ?? detail?.backdrop?.url ?? null;

  return (
    <AnimatePresence>
      {show && nextEpisode && (
        <motion.div
          key="next-up"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className={cn("absolute inset-0 z-[24]", ended ? "bg-black/75" : "pointer-events-none")}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <section
            aria-label="Tập tiếp theo"
            data-testid="next-episode-card"
            data-remaining={nextUp.remaining}
            className={cn(
              "pointer-events-auto absolute overflow-hidden rounded-md bg-[#181818]/95 text-white shadow-[0_16px_60px_rgb(0_0_0/0.7)] ring-1 ring-white/10 backdrop-blur",
              "inset-x-3 sm:inset-x-auto sm:right-6 sm:w-[420px] md:right-10 md:w-[460px]",
              "transition-[bottom] duration-300",
              ended
                ? "bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2"
                : lifted
                  ? touch
                    ? "bottom-[calc(7.5rem+env(safe-area-inset-bottom))]"
                    : "bottom-[calc(8.5rem+env(safe-area-inset-bottom))] md:bottom-40"
                  : "bottom-[calc(1.5rem+env(safe-area-inset-bottom))] md:bottom-12",
            )}
          >
            <div className="flex gap-3 p-3 md:gap-4 md:p-4">
              <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-[3px] bg-[#2a2a2a] md:w-40">
                {still ? (
                  // eslint-disable-next-line @next/next/no-img-element -- CDN still, sized by CSS
                  <img src={still} alt="" className="size-full object-cover" />
                ) : null}
                <span className="absolute inset-0 grid place-items-center bg-black/25">
                  <PlayIcon className="size-8 drop-shadow-[0_2px_6px_rgb(0_0_0/0.7)]" />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold tracking-[0.12em] text-white/60 uppercase md:text-[13px]">Tập tiếp theo</p>
                <p className="mt-1 text-sm font-bold md:text-base" data-testid="next-episode-code">
                  {episodeCode(nextEpisode)}
                </p>
                <p className="line-clamp-2 text-sm leading-snug text-white/85 md:text-[15px]">{episodeName(nextEpisode)}</p>
                {nextEpisode.runtimeMinutes ? <p className="mt-1 text-xs text-white/55">{nextEpisode.runtimeMinutes} phút</p> : null}
              </div>
            </div>
            <div className="flex gap-2 border-t border-white/10 p-3 md:p-4">
              <button
                type="button"
                onClick={() => nextUpDispatch({ type: "CANCEL" })}
                data-testid="next-episode-cancel"
                className="h-10 flex-1 rounded-[4px] bg-white/15 px-3 text-sm font-semibold text-white transition-colors outline-none hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white md:h-11 md:text-[15px]"
              >
                {ended ? "Đóng" : "Xem phần credit"}
              </button>
              <button
                type="button"
                onClick={() => {
                  nextUpDispatch({ type: "PLAY_NOW" });
                  playNext();
                }}
                data-testid="next-episode-play"
                autoFocus={ended}
                className="relative h-10 flex-[1.4] overflow-hidden rounded-[4px] bg-white/55 text-sm font-bold text-black outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#181818] md:h-11 md:text-[15px]"
              >
                {/* Countdown fill: grows one step per second, frozen while paused */}
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-white transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
                  style={{ width: `${Math.min(100, ((elapsed + (paused && !ended ? 0 : 1)) / NEXT_UP_COUNTDOWN_SEC) * 100)}%` }}
                />
                <span className="relative inline-flex items-center gap-1.5">
                  <PlayIcon className="size-4" />
                  Tập tiếp theo
                  <span className="font-semibold tabular-nums text-black/70" aria-live="off">
                    {paused && !ended ? "· đã dừng" : `· ${nextUp.remaining}s`}
                  </span>
                </span>
              </button>
            </div>
          </section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
