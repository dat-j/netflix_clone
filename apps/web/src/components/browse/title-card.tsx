"use client";

import type { TitleCard } from "@app/shared";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Artwork } from "@/components/ui/artwork";
import { rememberCard, titleHref } from "@/lib/card-cache";
import { useCardEpisodeLabel } from "@/lib/hooks/use-episode-label";
import { useCanHover } from "@/lib/hooks/use-media";
import { useUI, type HoverAlign, type HoverTarget } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

export const HOVER_DELAY_MS = 400;

/** `sizes` for a card inside a row/grid, mirroring the --per breakpoints */
export const CARD_SIZES = "(min-width: 2200px) 15vw, (min-width: 1400px) 17vw, (min-width: 1100px) 20vw, (min-width: 800px) 25vw, (min-width: 500px) 33vw, 50vw";
const POSTER_SIZES = "(min-width: 1400px) 9vw, (min-width: 1100px) 10vw, (min-width: 800px) 13vw, (min-width: 500px) 17vw, 25vw";

interface TitleCardTileProps {
  card: TitleCard;
  /** unique key among all visible cards */
  hoverKey: string;
  variant?: HoverTarget["variant"];
  /** Where the card sits in the visible page: drives the hover card's growth direction */
  align?: HoverAlign;
  className?: string;
  preload?: boolean;
  tabIndex?: number;
  onFocus?: () => void;
}

export function TitleCardTile({ card, hoverKey, variant = "default", align = "center", className, preload, tabIndex, onFocus }: TitleCardTileProps) {
  const canHover = useCanHover();
  const openHover = useUI((s) => s.openHover);
  const ref = useRef<HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const startHover = () => {
    if (!canHover) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>("[data-card-art]") ?? ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      openHover({ card, key: hoverKey, align, variant, rect: { top: r.top, left: r.left, width: r.width, height: r.height } });
    }, HOVER_DELAY_MS);
  };
  const cancelHover = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const progress = card.progress && !card.progress.completed ? card.progress.ratio : null;

  return (
    <Link
      ref={ref}
      href={titleHref(card)}
      scroll={false}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onMouseEnter={startHover}
      onMouseLeave={cancelHover}
      onClick={() => {
        cancelHover();
        rememberCard(card);
      }}
      aria-label={card.rank ? `Top ${card.rank}: ${card.name}` : card.name}
      data-testid="title-card"
      className={cn("group/card block rounded-[4px] outline-offset-4", className)}
    >
      {variant === "top10" && card.rank ? (
        <div data-card-art className="relative flex aspect-[16/9] w-full items-stretch">
          <RankNumeral rank={card.rank} />
          <div className="relative ml-auto h-full w-1/2 overflow-hidden rounded-[3px] shadow-lg shadow-black/50">
            <Artwork image={card.poster ?? card.backdrop} alt="" sizes={POSTER_SIZES} preload={preload} fallbackLabel={card.name} />
          </div>
        </div>
      ) : (
        <div data-card-art className="relative aspect-video w-full overflow-hidden rounded-[4px] bg-[#222]">
          <Artwork image={card.backdrop ?? card.poster} alt="" sizes={CARD_SIZES} preload={preload} fallbackLabel={card.backdrop || card.poster ? undefined : card.name} />
          {(card.backdrop || card.poster) && <CardTitleOverlay card={card} />}
          {card.isNew && !progress && (
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-t-[3px] bg-brand px-[0.6em] py-[0.15em] text-[clamp(0.55rem,0.75vw,0.75rem)] font-bold whitespace-nowrap text-brand-ink">
              Mới thêm
            </span>
          )}
          {progress != null && (
            <div className="absolute inset-x-[8%] bottom-[6%] h-[3px] bg-white/30" aria-label={`Đã xem ${Math.round(progress * 100)}%`}>
              <div className="h-full bg-brand" style={{ width: `${Math.max(3, progress * 100)}%` }} />
            </div>
          )}
        </div>
      )}
      {variant === "continue" && <ContinueCaption card={card} />}
    </Link>
  );
}

/** Under a continue-watching card: title on phones, plus "T1:E3 · Tên tập" for series. */
function ContinueCaption({ card }: { card: TitleCard }) {
  const label = useCardEpisodeLabel(card);
  return (
    <div className="mt-1.5 min-h-[1.1rem] text-[0.8rem] leading-tight">
      <p className="truncate text-white/70 md:hidden">{card.name}</p>
      {label ? (
        <p className="truncate text-white/60 md:text-[0.85rem] md:text-white/75" data-testid="continue-episode-label">
          {label}
        </p>
      ) : null}
    </div>
  );
}

function CardTitleOverlay({ card }: { card: TitleCard }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/70 via-black/0 via-45% p-[6%]">
      {card.logo ? (
        <div className="relative h-[34%] w-[62%]">
          <Image src={card.logo.url} alt="" fill sizes="200px" className="object-contain object-left-bottom drop-shadow-[0_2px_4px_rgba(0,0,0,.6)]" />
        </div>
      ) : (
        <span className="line-clamp-2 max-w-[85%] text-[clamp(0.75rem,1.05vw,1.15rem)] leading-tight font-extrabold tracking-tight text-white text-shadow">
          {card.name}
        </span>
      )}
    </div>
  );
}

/** Giant outlined rank numeral for the Top 10 row */
function RankNumeral({ rank }: { rank: number }) {
  return (
    <svg viewBox="0 0 100 140" aria-hidden className="absolute bottom-0 left-0 h-full w-[58%] overflow-visible" preserveAspectRatio="xMaxYMax meet">
      <text
        x={rank === 10 ? 104 : 96}
        y="136"
        textAnchor="end"
        fontSize="150"
        fontWeight="900"
        letterSpacing={rank === 10 ? "-18" : "0"}
        fill="#141414"
        stroke="#595959"
        strokeWidth="3.5"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {rank}
      </text>
    </svg>
  );
}
