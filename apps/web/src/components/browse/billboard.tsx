"use client";

import type { TitleDetail } from "@app/shared";
import { Info, RotateCcw, Volume2, VolumeX } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MyListButton, PlayButton } from "@/components/title/title-actions";
import { Artwork } from "@/components/ui/artwork";
import { Skeleton } from "@/components/ui/skeleton";
import { rememberCard, titleHref } from "@/lib/card-cache";
import { useInView } from "@/lib/hooks/use-media";
import { useUI } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { PreviewVideo } from "./preview-video";

function usePageVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

export function Billboard({ title }: { title: TitleDetail }) {
  const pathname = usePathname();
  const [ref, inView] = useInView<HTMLElement>(0.4);
  const pageVisible = usePageVisible();
  const muted = useUI((s) => s.muted);
  const setMuted = useUI((s) => s.setMuted);
  const previewOwner = useUI((s) => s.previewOwner);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [round, setRound] = useState(0);
  const [started, setStarted] = useState(false);

  const modalOpen = pathname.startsWith("/title/");
  const paused = !inView || modalOpen || !pageVisible || previewOwner !== null;

  // Netflix waits a beat on the still before rolling the preview
  useEffect(() => {
    if (!title.hasPreview) return;
    const t = setTimeout(() => setStarted(true), 1500);
    return () => clearTimeout(t);
  }, [title.hasPreview]);

  useEffect(() => rememberCard(title), [title]);

  const showVideo = title.hasPreview && started && !ended;
  const compact = playing && !paused; // shrink copy while the preview plays

  return (
    <section
      ref={ref}
      aria-label={`Nổi bật: ${title.name}`}
      className="relative mb-[-6vw] h-[max(32rem,min(56.25vw,100svh))] w-full select-none"
      data-testid="billboard"
    >
      <div className="absolute inset-0">
        <Artwork image={title.backdrop ?? title.poster} alt="" sizes="100vw" preload quality={85} fallbackLabel={undefined} />
        {showVideo && (
          <PreviewVideo
            key={round}
            titleId={title.id}
            active
            paused={paused}
            onPlayingChange={setPlaying}
          />
        )}
        <VideoEndWatcher active={showVideo} onEnded={() => setEnded(true)} />
        <div className="scrim-left absolute inset-0" />
        <div className="scrim-bottom absolute inset-x-0 bottom-0 h-[14.7vw]" />
      </div>

      <div className="absolute inset-x-gutter bottom-[35%] flex flex-col items-start animate-[rise-in_.8s_cubic-bezier(.16,1,.3,1)_both]">
        <div className={cn("w-[min(40vw,640px)] origin-bottom-left transition-transform duration-[1300ms] ease-out-expo", compact && "scale-[0.72]")}>
          {title.logo ? (
            <div className="relative aspect-[3/1] w-full">
              <Image src={title.logo.url} alt={title.name} fill sizes="40vw" preload className="object-contain object-left-bottom drop-shadow-[0_2px_8px_rgba(0,0,0,.5)]" />
            </div>
          ) : (
            <h1 className="text-[clamp(2.25rem,5.2vw,5.5rem)] leading-[0.95] font-black tracking-tight text-white text-shadow">{title.name}</h1>
          )}
        </div>
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity,margin] duration-[1300ms] ease-out-expo",
            compact ? "mt-0 grid-rows-[0fr] opacity-0" : "mt-[1.2vw] grid-rows-[1fr] opacity-100",
          )}
        >
          <p className="line-clamp-3 w-[min(36vw,600px)] overflow-hidden text-[clamp(0.95rem,1.25vw,1.4rem)] leading-snug font-normal text-white text-shadow">
            {title.overview ?? title.fullOverview}
          </p>
        </div>
        <div className="mt-[1.5vw] flex items-center gap-[0.7vw]">
          <PlayButton title={title} />
          <Link
            href={titleHref(title)}
            scroll={false}
            onClick={() => rememberCard(title)}
            className="inline-flex h-[clamp(2.5rem,3.4vw,3.25rem)] items-center justify-center gap-2.5 rounded bg-[rgb(109_109_110/0.7)] px-[clamp(1.25rem,2.4vw,2.25rem)] text-[clamp(1rem,1.35vw,1.3rem)] font-bold text-white transition-colors hover:bg-[rgb(109_109_110/0.4)]"
          >
            <Info className="size-[1.4em]" aria-hidden />
            Thông tin khác
          </Link>
        </div>
      </div>

      <div className="absolute right-0 bottom-[35%] flex items-center gap-3">
        {title.hasPreview && (playing || ended) && (
          <button
            type="button"
            onClick={() => {
              if (ended) {
                setEnded(false);
                setRound((r) => r + 1);
              } else setMuted(!muted);
            }}
            aria-label={ended ? "Xem lại đoạn giới thiệu" : muted ? "Bật tiếng" : "Tắt tiếng"}
            className="flex size-[clamp(2.25rem,2.8vw,2.75rem)] items-center justify-center rounded-full border border-white/70 bg-transparent text-white transition-colors hover:bg-white/10"
          >
            {ended ? <RotateCcw className="size-[45%]" /> : muted ? <VolumeX className="size-[45%]" /> : <Volume2 className="size-[45%]" />}
          </button>
        )}
        {title.maturityRating && (
          <span className="flex h-[clamp(2.25rem,2.8vw,2.75rem)] items-center border-l-[3px] border-[#dcdcdc] bg-[#333]/60 pr-[calc(var(--gutter)+1.5rem)] pl-3 text-[clamp(0.9rem,1.1vw,1.15rem)] text-white">
            {title.maturityRating}
          </span>
        )}
      </div>
    </section>
  );
}

/** Watches the billboard <video> for the `ended` event (PreviewVideo only reports playing state). */
function VideoEndWatcher({ active, onEnded }: { active: boolean; onEnded: () => void }) {
  useEffect(() => {
    if (!active) return;
    const video = document.querySelector<HTMLVideoElement>("[data-testid='billboard'] video");
    if (!video) return;
    video.addEventListener("ended", onEnded);
    return () => video.removeEventListener("ended", onEnded);
  });
  return null;
}

/** Mobile hero: centered poster card with actions (Netflix mobile web layout). */
export function MobileHero({ title }: { title: TitleDetail }) {
  // Posters carry their own title art; only draw the name when we fall back to a backdrop
  const art = title.poster ?? title.backdrop;
  return (
    <section className="relative px-gutter pt-[calc(var(--header-h)+1.25rem)] pb-2" aria-label={`Nổi bật: ${title.name}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[85%] overflow-hidden opacity-50 blur-2xl" aria-hidden>
        <Artwork image={art} alt="" sizes="30vw" quality={60} />
      </div>
      <div className="relative mx-auto w-[min(100%,22rem,38.6svh)]">
        <div className="relative mx-auto aspect-[2/3] max-h-[58svh] overflow-hidden rounded-lg shadow-[0_8px_40px_rgba(0,0,0,.6)] ring-1 ring-white/15">
          <Artwork image={art} alt="" sizes="90vw" preload quality={85} fallbackLabel={title.poster ? undefined : title.name} />
          <div className="absolute top-3 right-3">
            <MyListButton title={title} />
          </div>
        </div>
        <div className="relative mt-4 flex flex-col items-center gap-3">
          {title.poster ? (
            <h1 className="sr-only">{title.name}</h1>
          ) : (
            <h1 className="text-center text-2xl leading-tight font-black tracking-tight">{title.name}</h1>
          )}
          {title.genres.length > 0 && (
            <p className="text-center text-[0.85rem] text-white/85">{title.genres.slice(0, 3).join(" • ")}</p>
          )}
          <div className="grid w-full grid-cols-2 gap-2.5">
            <PlayButton title={title} size="md" className="w-full" />
            <Link
              href={titleHref(title)}
              scroll={false}
              onClick={() => rememberCard(title)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded bg-[rgb(109_109_110/0.7)] font-semibold text-white"
            >
              <Info className="size-5" />
              Thông tin
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function BillboardSkeleton() {
  return (
    <>
      <div className="relative mb-[-6vw] h-[max(32rem,min(56.25vw,100svh))] w-full max-md:hidden">
        <Skeleton className="absolute inset-0 rounded-none opacity-60" />
        <div className="absolute inset-x-gutter bottom-[35%] space-y-4">
          <Skeleton className="h-[5vw] w-[32vw]" />
          <Skeleton className="h-4 w-[30vw]" />
          <Skeleton className="h-4 w-[24vw]" />
          <div className="flex gap-3 pt-2">
            <Skeleton className="h-12 w-36" />
            <Skeleton className="h-12 w-48" />
          </div>
        </div>
        <div className="scrim-bottom absolute inset-x-0 bottom-0 h-[14.7vw]" />
      </div>
      <div className="px-gutter pt-[calc(var(--header-h)+3.5rem)] md:hidden">
        <Skeleton className="mx-auto aspect-[2/3] max-h-[68svh] w-full max-w-[22rem] rounded-lg" />
      </div>
    </>
  );
}
