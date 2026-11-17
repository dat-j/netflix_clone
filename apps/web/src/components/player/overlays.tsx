"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { usePlayer } from "./controller";
import { Back10Icon, Forward10Icon, NextEpisodeIcon, PauseIcon, PlayIcon, ReplayIcon, VolumeIcon } from "./controls/icons";
import { activeCues, type TextCue } from "./lib/vtt";
import { episodeLabel } from "./lib/format";
import { isPausedIdle } from "./lib/state";
import { usePlayerStore } from "./store";

const RATING_TEXT: Record<string, string> = {
  P: "Phổ biến cho mọi đối tượng khán giả",
  K: "Khán giả dưới 13 tuổi cần có cha mẹ hướng dẫn",
  T13: "Khán giả từ đủ 13 tuổi trở lên",
  T16: "Khán giả từ đủ 16 tuổi trở lên",
  T18: "Khán giả từ đủ 18 tuổi trở lên",
  C: "Không được phép phổ biến",
};

/** Big centre icon after a click/keypress, plus the side ripple for ±10 s. */
export function CenterFeedback() {
  const feedback = usePlayerStore((s) => s.feedback);
  const streak = usePlayerStore((s) => s.seekStreak);
  const [expiredId, setExpiredId] = useState(0);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setExpiredId(feedback.id), feedback.kind === "back" || feedback.kind === "forward" ? 700 : 550);
    return () => clearTimeout(t);
  }, [feedback]);
  const visible = feedback && feedback.id !== expiredId ? feedback : null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      <AnimatePresence>
        {visible && (visible.kind === "back" || visible.kind === "forward") && visible.side !== "center" ? (
          <motion.div
            key={`seek-${visible.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className={cn(
              "absolute inset-y-0 flex w-[38%] items-center justify-center",
              visible.side === "left" ? "left-0 rounded-r-[50%_50%]" : "right-0 rounded-l-[50%_50%]",
              "bg-gradient-to-r",
              visible.side === "left" ? "from-white/15 to-transparent" : "from-transparent to-white/15",
            )}
          >
            <motion.div
              initial={{ scale: 0.7 }}
              animate={{ scale: 1 }}
              className="flex flex-col items-center gap-2 text-white drop-shadow-[0_2px_8px_rgb(0_0_0/0.6)]"
            >
              {visible.kind === "back" ? <Back10Icon className="size-14 md:size-16" /> : <Forward10Icon className="size-14 md:size-16" />}
              <span className="text-sm font-semibold md:text-base">{Math.max(10, streak)} giây</span>
            </motion.div>
          </motion.div>
        ) : visible ? (
          <motion.div
            key={`c-${visible.id}`}
            initial={{ opacity: 0.9, scale: 0.85 }}
            animate={{ opacity: 0, scale: 1.25 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
            className="absolute inset-0 m-auto grid size-24 place-items-center rounded-full bg-black/45 text-white md:size-28"
          >
            {visible.kind === "play" && <PlayIcon className="size-12 translate-x-0.5" />}
            {visible.kind === "pause" && <PauseIcon className="size-12" />}
            {visible.kind === "back" && <Back10Icon className="size-12" />}
            {visible.kind === "forward" && <Forward10Icon className="size-12" />}
            {(visible.kind === "volume" || visible.kind === "mute") && (
              <div className="flex flex-col items-center">
                <VolumeIcon level={visible.kind === "mute" || !visible.value ? 0 : visible.value < 34 ? 1 : visible.value < 67 ? 2 : 3} className="size-10" />
                <span className="text-sm font-bold tabular-nums">{visible.kind === "mute" ? "Tắt" : `${visible.value ?? 0}%`}</span>
              </div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Spinner shown only if buffering lasts > 250 ms (avoids flicker on fast seeks). */
export function BufferingSpinner() {
  const busy = usePlayerStore((s) => s.phase === "loading" || (s.buffering && s.phase === "playing") || (s.seeking && s.buffering));
  if (!busy) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.25, duration: 0.2 }}
      className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
      data-testid="player-buffering"
    >
      <div role="status" aria-label="Đang tải" className="relative size-16 md:size-20">
        <div className="absolute inset-0 rounded-full border-[5px] border-white/15" />
        <div className="absolute inset-0 animate-spin rounded-full border-[5px] border-transparent border-t-[var(--brand,#e50914)] [animation-duration:0.8s] motion-reduce:[animation-duration:2s]" />
      </div>
    </motion.div>
  );
}

/** Title logo + maturity rating at the start; fades after a few seconds of playback. */
export function IntroOverlay() {
  const { session, detail } = usePlayer();
  const playing = usePlayerStore((s) => s.phase === "playing");
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!playing || done) return;
    const t = setTimeout(() => setDone(true), 6000);
    return () => clearTimeout(t);
  }, [playing, done]);
  const rating = session?.title.maturityRating ?? detail?.maturityRating ?? null;
  const logo = session?.title.logo ?? detail?.logo ?? null;
  const name = session?.title.name ?? detail?.name ?? "";
  const show = playing && !done;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="intro"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 1.2 } }}
          transition={{ duration: 0.6 }}
          className="pointer-events-none absolute inset-0 z-[5]"
          data-testid="intro-overlay"
        >
          {rating && (
            <div className="absolute top-[18%] left-0 flex items-stretch gap-3 bg-gradient-to-r from-black/45 to-transparent py-2 pr-16 pl-4 md:top-[16%] md:pl-8">
              <span className="w-[3px] rounded-full bg-[var(--brand,#e50914)]" />
              <div className="leading-tight">
                <p className="text-xl font-bold text-white md:text-3xl">{rating}</p>
                {RATING_TEXT[rating] && <p className="mt-0.5 text-xs text-white/85 md:text-base">{RATING_TEXT[rating]}</p>}
              </div>
            </div>
          )}
          <div className="absolute bottom-[22%] left-4 max-w-[60vw] md:left-10 md:max-w-[34vw]">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote CDN logo, sized by CSS
              <img src={logo.url} alt={name} className="max-h-[18vh] w-auto max-w-full object-contain drop-shadow-[0_4px_16px_rgb(0_0_0/0.6)]" />
            ) : (
              <p className="text-3xl font-black tracking-tight text-white drop-shadow-lg md:text-6xl">{name}</p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** "Bạn đang xem" info card after the viewer has been paused for a while with the chrome hidden. */
export function PausedOverlay() {
  const { session, detail } = usePlayer();
  const pausedIdle = usePlayerStore((s) => isPausedIdle(s));
  const chromeVisible = usePlayerStore((s) => s.chromeVisible || s.menu !== null);
  // The chrome auto-hides ~5 s into a pause; the info card takes its place
  const show = pausedIdle && !chromeVisible;
  const name = session?.title.name ?? detail?.name ?? "";
  const ep = episodeLabel(session?.episode ?? null);
  const overview = detail?.fullOverview || detail?.overview;
  const meta = [detail?.year, detail?.maturityRating, detail?.genres?.slice(0, 3).join(" · ")].filter(Boolean).join("  •  ");

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="paused"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          className="pointer-events-none absolute inset-0 z-[15] flex items-center bg-gradient-to-r from-black/90 via-black/60 to-black/10"
          data-testid="paused-overlay"
        >
          <div className="max-w-[min(42rem,85vw)] px-6 md:px-16 lg:px-24">
            <p className="text-sm font-medium tracking-wide text-white/70 md:text-lg">Bạn đang xem</p>
            <h2 className="mt-2 text-3xl leading-tight font-black tracking-tight text-white md:text-5xl lg:text-6xl">{name}</h2>
            {ep && <p className="mt-3 text-lg font-semibold text-white/90 md:text-2xl">{ep}</p>}
            {meta && <p className="mt-3 text-sm text-white/70 md:text-base">{meta}</p>}
            {overview && <p className="mt-4 line-clamp-4 text-base leading-relaxed text-white/85 md:text-xl">{overview}</p>}
          </div>
          <p className="absolute right-6 bottom-8 text-base font-semibold text-white/60 md:right-12 md:bottom-12 md:text-lg">Đã tạm dừng</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Custom-rendered subtitles (no native caption box); rises above the control bar. */
export function SubtitleOverlay({ cues }: { cues: TextCue[] }) {
  const time = usePlayerStore((s) => s.currentTime);
  const lifted = usePlayerStore((s) => s.chromeVisible || s.menu !== null);
  if (!cues.length) return null;
  const active = activeCues(cues, time);
  return (
    <div
      aria-live="off"
      className={cn(
        "pointer-events-none absolute inset-x-0 z-[12] flex flex-col items-center gap-1 px-[6%] text-center transition-[bottom] duration-300",
        lifted ? "bottom-[22%] md:bottom-[20%]" : "bottom-[7%]",
      )}
      data-testid="subtitles"
    >
      {active.map((c, i) => (
        <p
          key={`${c.start}-${i}`}
          className="text-[clamp(16px,2.7vw,46px)] leading-snug font-semibold whitespace-pre-line text-white [text-shadow:0_0_4px_rgb(0_0_0),0_2px_6px_rgb(0_0_0/0.9),0_0_1px_rgb(0_0_0)]"
        >
          {c.text}
        </p>
      ))}
    </div>
  );
}

/** Autoplay refused by the browser: one clear call to action. */
export function BlockedOverlay() {
  const { play } = usePlayer();
  const blocked = usePlayerStore((s) => s.phase === "blocked");
  if (!blocked) return null;
  return (
    <div className="absolute inset-0 z-[18] grid place-items-center bg-black/45" data-testid="autoplay-blocked">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          play();
        }}
        className="group relative flex flex-col items-center gap-4 rounded-2xl p-6 text-white outline-none"
        autoFocus
      >
        <span className="grid size-24 place-items-center rounded-full bg-[var(--brand,#e50914)] shadow-[0_10px_40px_rgb(0_0_0/0.5)] transition-transform group-hover:scale-110 group-focus-visible:ring-4 group-focus-visible:ring-white/80 md:size-28">
          <PlayIcon className="size-12 translate-x-1 md:size-14" />
        </span>
        <span className="text-xl font-bold drop-shadow md:text-2xl">Bấm để phát</span>
      </button>
    </div>
  );
}

/** End of title: replay / back / next-episode hook. */
export function EndScreen() {
  const { replay, goBack, session, detail, nextEpisode, playNext } = usePlayer();
  const ended = usePlayerStore((s) => s.phase === "ended");
  // The "Tập tiếp theo" card owns the end of a series episode until the viewer dismisses it
  const nextUpShowing = usePlayerStore((s) => s.nextUp.visible || s.nextUp.advance);
  if (!ended || (nextEpisode && nextUpShowing)) return null;
  const ep = episodeLabel(session?.episode ?? null);
  const backdrop = session?.title.backdrop?.url ?? detail?.backdrop?.url;
  const name = session?.title.name ?? detail?.name ?? "";
  return (
    <div className="absolute inset-0 z-[25] flex items-end bg-black md:items-center" data-testid="end-screen" onClick={(e) => e.stopPropagation()}>
      {backdrop && (
        // eslint-disable-next-line @next/next/no-img-element -- full-bleed backdrop
        <img src={backdrop} alt="" className="absolute inset-0 size-full object-cover opacity-50 motion-safe:animate-[fade-in_0.8s_ease-out]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/20 md:bg-gradient-to-r md:from-black/95 md:via-black/60 md:to-transparent" />
      <div className="relative w-full px-6 pb-16 md:max-w-3xl md:px-16 md:pb-0 lg:px-24">
        <p className="text-sm font-semibold tracking-[0.2em] text-white/60 uppercase md:text-base">Đã xem xong</p>
        <h2 className="mt-2 text-3xl leading-tight font-black tracking-tight text-white md:text-6xl">{name}</h2>
        {ep && <p className="mt-2 text-lg font-semibold text-white/85 md:text-2xl">{ep}</p>}
        {!ep && detail?.tagline && <p className="mt-3 text-base text-white/75 italic md:text-xl">{detail.tagline}</p>}
        <div className="mt-8 flex flex-wrap gap-3">
          {nextEpisode && (
            <button
              type="button"
              onClick={playNext}
              data-testid="end-next-episode"
              className="inline-flex h-12 items-center gap-2.5 rounded-md bg-white px-6 text-lg font-bold text-black transition hover:bg-white/80 md:h-14 md:px-8 md:text-xl [&>svg]:size-6"
            >
              <NextEpisodeIcon /> Tập tiếp theo
            </button>
          )}
          <button
            type="button"
            onClick={replay}
            data-testid="replay"
            className={cn(
              "inline-flex h-12 items-center gap-2.5 rounded-md px-6 text-lg font-bold transition md:h-14 md:px-8 md:text-xl [&>svg]:size-6",
              nextEpisode ? "bg-white/20 text-white hover:bg-white/30" : "bg-white text-black hover:bg-white/80",
            )}
          >
            <ReplayIcon /> Xem lại
          </button>
          <button
            type="button"
            onClick={goBack}
            className="inline-flex h-12 items-center rounded-md bg-white/20 px-6 text-lg font-bold text-white transition hover:bg-white/30 md:h-14 md:px-8 md:text-xl"
          >
            Quay về trang duyệt
          </button>
        </div>
      </div>
    </div>
  );
}
