"use client";

import type { EpisodeRef, RatingValue, TitleCard, TitleDetail } from "@app/shared";
import { Check, Play, Plus, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { CircleButton } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { playAction, watchUrl } from "@/lib/episodes";
import { useRateTitle, useToggleMyList } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * Player link. An explicit episode wins; otherwise series play their `resumeEpisode` (detail) or the episode in
 * progress (cards), and with neither the API picks the "xem tiếp" episode.
 */
export function watchHref(title: Pick<TitleCard, "id" | "type" | "progress"> & { resumeEpisode?: EpisodeRef | null }, episodeId?: string | null) {
  if (episodeId) return watchUrl(title.id, episodeId);
  return playAction(title).href;
}

/** Big white "Phát"/"Tiếp tục"/"Tiếp tục T1:E3" button (billboard + detail modal) */
export function PlayButton({
  title,
  className,
  size = "lg",
  label,
}: {
  title: Pick<TitleCard, "id" | "type" | "progress"> & { resumeEpisode?: EpisodeRef | null };
  className?: string;
  size?: "md" | "lg";
  label?: string;
}) {
  const action = playAction(title);
  return (
    <Link
      href={action.href}
      data-testid="play-button"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded bg-white font-bold text-black transition-colors hover:bg-white/75",
        size === "lg" ? "h-[clamp(2.5rem,3.4vw,3.25rem)] px-[clamp(1.25rem,2.4vw,2.25rem)] text-[clamp(1rem,1.35vw,1.3rem)]" : "h-10 px-5 text-base",
        className,
      )}
    >
      <Play className="size-[1.4em] fill-current" aria-hidden />
      {label ?? action.label}
    </Link>
  );
}

export function MyListButton({ title, className }: { title: TitleCard | TitleDetail; className?: string }) {
  const toggle = useToggleMyList();
  const inList = title.inMyList;
  const label = inList ? "Xóa khỏi Danh sách của tôi" : "Thêm vào Danh sách của tôi";
  return (
    <Tooltip content={label}>
      <CircleButton
        aria-label={label}
        aria-pressed={inList}
        className={cn("size-9", className)}
        onClick={(e) => {
          e.stopPropagation();
          toggle.mutate({ title, add: !inList });
        }}
      >
        {inList ? <Check className="size-[55%]" strokeWidth={2.5} /> : <Plus className="size-[55%]" strokeWidth={2.5} />}
      </CircleButton>
    </Tooltip>
  );
}

function LoveIcon({ className }: { className?: string }) {
  // Two overlapping thumbs = "love it"
  return (
    <span className={cn("relative inline-flex", className)} aria-hidden>
      <ThumbsUp className="absolute -left-[18%] size-full" strokeWidth={2.2} />
      <ThumbsUp className="relative left-[18%] size-full" strokeWidth={2.2} />
    </span>
  );
}

const RATING_OPTIONS: { value: RatingValue; label: string; Icon: (p: { className?: string }) => React.ReactNode }[] = [
  { value: "DISLIKE", label: "Không phải gu của tôi", Icon: ({ className }) => <ThumbsDown className={className} strokeWidth={2.2} /> },
  { value: "LIKE", label: "Tôi thích nội dung này", Icon: ({ className }) => <ThumbsUp className={className} strokeWidth={2.2} /> },
  { value: "LOVE", label: "Tôi rất thích nội dung này!", Icon: LoveIcon },
];

/**
 * Netflix-style rating: a single thumb button; hovering (or focusing) it expands a pill
 * with dislike / like / love. Clicking the current value clears it.
 */
export function RateButton({ title, className }: { title: TitleCard | TitleDetail; className?: string }) {
  const rate = useRateTitle();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = RATING_OPTIONS.find((o) => o.value === title.rating);
  const CurrentIcon = current?.Icon ?? RATING_OPTIONS[1].Icon;

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  return (
    <div className={cn("relative size-9", className)} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      <CircleButton
        aria-label={current ? `Đã đánh giá: ${current.label}` : "Đánh giá"}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn("size-full", current && "border-white")}
      >
        <CurrentIcon className={cn("size-[50%]", current && "fill-white/20")} />
      </CircleButton>
      <div
        role="group"
        aria-label="Đánh giá nội dung"
        className={cn(
          "absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-[#2b2b2b] p-1 shadow-[0_0_2px_rgba(255,255,255,.4),0_8px_20px_rgba(0,0,0,.6)] transition-[opacity,scale] duration-200",
          open ? "visible scale-100 opacity-100" : "invisible scale-75 opacity-0",
        )}
      >
        {RATING_OPTIONS.map(({ value, label, Icon }) => {
          const active = title.rating === value;
          return (
            <Tooltip key={value} content={label}>
              <button
                type="button"
                aria-label={label}
                aria-pressed={active}
                onClick={(e) => {
                  e.stopPropagation();
                  rate.mutate({ titleId: title.id, value: active ? null : value });
                  setOpen(false);
                }}
                className={cn(
                  "flex size-9 items-center justify-center rounded-full text-white transition-[background-color,scale] hover:scale-110 hover:bg-white/15",
                  active && "bg-white/20",
                )}
              >
                <Icon className={cn("size-[18px]", active && "fill-white/30")} />
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

export function MaturityBadge({ rating, className }: { rating: string | null | undefined; className?: string }) {
  if (!rating) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center border border-white/40 px-[0.4em] py-px text-[0.85em] leading-tight font-medium whitespace-nowrap text-white/90",
        className,
      )}
    >
      {rating}
    </span>
  );
}

export function QualityBadge({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <span className="inline-flex items-center rounded-[3px] border border-white/40 px-1 text-[0.7em] leading-[1.35] font-semibold tracking-wide text-white/90">
      {label}
    </span>
  );
}

export function MatchScore({ score, className }: { score: number | null | undefined; className?: string }) {
  if (score == null) return null;
  return <span className={cn("font-bold whitespace-nowrap text-success", className)}>{Math.round(score)}% phù hợp</span>;
}
