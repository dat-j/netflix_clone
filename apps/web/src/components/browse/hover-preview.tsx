"use client";

import { ChevronDown, Play, Volume2, VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MatchScore, MaturityBadge, MyListButton, RateButton, watchHref } from "@/components/title/title-actions";
import { Artwork } from "@/components/ui/artwork";
import { Tooltip } from "@/components/ui/tooltip";
import { rememberCard, titleHref } from "@/lib/card-cache";
import { useCardEpisodeLabel } from "@/lib/hooks/use-episode-label";
import { useIsClient } from "@/lib/hooks/use-media";
import { useUI, type HoverTarget } from "@/lib/ui-store";
import { cn, formatRemaining, formatRuntime } from "@/lib/utils";
import { PreviewVideo } from "./preview-video";

const SCALE = 1.5;
const MIN_WIDTH = 300;
const EDGE = 8;

/** Singleton layer rendering the floating mini-card for whichever card is hovered. */
export function HoverPreviewLayer() {
  const hover = useUI((s) => s.hover);
  const closeHover = useUI((s) => s.closeHover);
  const pathname = usePathname();
  const mounted = useIsClient();

  // Close on scroll / resize / route change — the anchor rect is no longer valid
  useEffect(() => {
    if (!hover) return;
    const close = () => closeHover();
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [hover, closeHover]);
  useEffect(() => closeHover(), [pathname, closeHover]);

  if (!mounted) return null;
  return createPortal(<AnimatePresence>{hover && <MiniCard key={hover.key} target={hover} />}</AnimatePresence>, document.body);
}

function geometry(t: HoverTarget) {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const width = Math.max(t.rect.width * SCALE, MIN_WIDTH);
  const imgH = (width * 9) / 16;
  let left =
    t.align === "left" ? t.rect.left : t.align === "right" ? t.rect.left + t.rect.width - width : t.rect.left - (width - t.rect.width) / 2;
  left = Math.min(Math.max(left, EDGE), vw - width - EDGE);
  let top = t.rect.top - (imgH - t.rect.height) / 2;
  const estimatedH = imgH + 150;
  top = Math.min(Math.max(top, EDGE), vh - estimatedH - EDGE);
  const scale = t.rect.width / width;
  return { width, left, top, from: { x: t.rect.left - left, y: t.rect.top - top + (t.rect.height - imgH * scale) / 2, scale } };
}

function MiniCard({ target }: { target: HoverTarget }) {
  const { card, variant } = target;
  const router = useRouter();
  const closeHover = useUI((s) => s.closeHover);
  const muted = useUI((s) => s.muted);
  const setMuted = useUI((s) => s.setMuted);
  const setPreviewOwner = useUI((s) => s.setPreviewOwner);
  const [geo] = useState(() => geometry(target));
  const [videoReady, setVideoReady] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    rememberCard(card);
    const t = setTimeout(() => setSettled(true), 700);
    return () => clearTimeout(t);
  }, [card]);

  useEffect(() => {
    if (!videoReady) return;
    setPreviewOwner(target.key);
    return () => setPreviewOwner(null);
  }, [videoReady, target.key, setPreviewOwner]);

  const openDetails = () => {
    rememberCard(card);
    closeHover();
    router.push(titleHref(card), { scroll: false });
  };

  const progress = card.progress && !card.progress.completed ? card.progress : null;
  const runtime = card.type === "SERIES" ? "Phim bộ" : formatRuntime(card.runtimeMinutes);
  const episode = useCardEpisodeLabel(card);

  return (
    <motion.div
      role="dialog"
      aria-label={card.name}
      data-testid="hover-card"
      onMouseLeave={() => closeHover(target.key)}
      initial={{ opacity: 0.6, x: geo.from.x, y: geo.from.y, scale: geo.from.scale }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: geo.from.x, y: geo.from.y, scale: geo.from.scale, transition: { duration: 0.2, ease: [0.4, 0, 0.2, 1] } }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      style={{ position: "fixed", top: geo.top, left: geo.left, width: geo.width, transformOrigin: "0 0", zIndex: 50 }}
      className="overflow-hidden rounded-md bg-elevated shadow-[0_3px_10px_rgba(0,0,0,0.75)]"
    >
      <button type="button" onClick={openDetails} className="relative block aspect-video w-full overflow-hidden text-left" tabIndex={-1} aria-label={`Xem chi tiết ${card.name}`}>
        <Artwork image={card.backdrop ?? card.poster} alt="" sizes="(min-width: 1400px) 26vw, 40vw" fallbackLabel={card.name} />
        {card.hasPreview && (
          <PreviewVideo titleId={card.id} active={settled} onPlayingChange={setVideoReady} />
        )}
        <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 flex items-end bg-gradient-to-t from-black/60 to-transparent p-4 pt-10 transition-opacity", videoReady && "opacity-0 delay-[2500ms] duration-700")}>
          {card.logo ? (
            <div className="relative h-12 w-1/2">
              <Image src={card.logo.url} alt="" fill sizes="240px" className="object-contain object-left-bottom" />
            </div>
          ) : (
            <span className="line-clamp-2 text-lg leading-tight font-extrabold text-white text-shadow">{card.name}</span>
          )}
        </div>
      </button>
      {videoReady && (
        <button
          type="button"
          onClick={() => setMuted(!muted)}
          aria-label={muted ? "Bật tiếng" : "Tắt tiếng"}
          className="absolute top-[calc(var(--img-h)-3rem)] right-3 flex size-8 items-center justify-center rounded-full border border-white/50 bg-black/30 text-white hover:border-white"
          style={{ ["--img-h" as string]: `${(geo.width * 9) / 16}px` }}
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08, duration: 0.25 }}
        className="space-y-3 p-4 text-[0.8rem] shadow-[0_-1px_0_rgba(255,255,255,0.04)]"
      >
        <div className="flex items-center gap-2">
          <Tooltip content={progress ? (episode ? `Tiếp tục ${episode.split(" · ")[0]}` : "Tiếp tục xem") : "Phát"}>
            <Link
              href={watchHref(card)}
              aria-label={`Phát ${card.name}`}
              className="flex size-9 items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-white/80"
            >
              <Play className="size-[18px] translate-x-px fill-current" />
            </Link>
          </Tooltip>
          <MyListButton title={card} />
          <RateButton title={card} />
          <Tooltip content={card.type === "SERIES" ? "Tập phim và thông tin" : "Thông tin khác"}>
            <button
              type="button"
              onClick={openDetails}
              aria-label="Thông tin khác"
              className="ml-auto flex size-9 items-center justify-center rounded-full border-2 border-white/50 bg-[#2a2a2a]/60 text-white transition-colors hover:border-white"
            >
              <ChevronDown className="size-5" strokeWidth={2.5} />
            </button>
          </Tooltip>
        </div>

        {episode ? (
          <p className="truncate text-[0.85rem] font-semibold text-white" data-testid="hover-episode-label">
            {episode}
          </p>
        ) : null}
        {progress ? (
          <div className="flex items-center gap-2">
            <div className="h-[3px] flex-1 bg-white/25">
              <div className="h-full bg-brand" style={{ width: `${Math.max(3, progress.ratio * 100)}%` }} />
            </div>
            <span className="shrink-0 text-white/80">{formatRemaining(progress.positionSec, progress.durationSec)}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-white/90">
          <MatchScore score={card.matchScore} />
          <MaturityBadge rating={card.maturityRating} />
          {runtime && <span>{runtime}</span>}
          {card.year && <span className="text-white/70">{card.year}</span>}
          <span className="rounded-[3px] border border-white/40 px-1 text-[0.65rem] leading-[1.4] font-semibold">HD</span>
        </div>

        {card.genres.length > 0 && (
          <ul className="flex flex-wrap items-center text-white" aria-label="Thể loại">
            {card.genres.slice(0, 3).map((g, i) => (
              <li key={g} className="flex items-center">
                {i > 0 && <span className="mx-1.5 text-[0.6rem] text-[#646464]" aria-hidden>●</span>}
                {g}
              </li>
            ))}
          </ul>
        )}
        {variant === "top10" && card.rank && <p className="font-semibold text-white/80">#{card.rank} trong Top 10 hôm nay</p>}
      </motion.div>
    </motion.div>
  );
}
