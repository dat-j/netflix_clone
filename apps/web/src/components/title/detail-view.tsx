"use client";

import type { CreditDto, EpisodeDto, SeasonDto, TitleCard, TitleDetail } from "@app/shared";
import { Check, ChevronDown, Play, Plus, Volume2, VolumeX, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { useEffect, useState } from "react";
import { PreviewVideo } from "@/components/browse/preview-video";
import { ErrorPanel } from "@/components/browse/state-panels";
import { Artwork } from "@/components/ui/artwork";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { recallCard, rememberCard, titleHref } from "@/lib/card-cache";
import { episodeCode, episodeLabel, episodeName } from "@/lib/episodes";
import { useSeasonEpisodes, useSimilar, useTitle, useToggleMyList } from "@/lib/queries";
import { useUI } from "@/lib/ui-store";
import { cn, formatDate, formatRemaining, formatRuntime, qualityLabel } from "@/lib/utils";
import { MatchScore, MaturityBadge, MyListButton, PlayButton, QualityBadge, RateButton, watchHref } from "./title-actions";

interface DetailViewProps {
  idOrSlug: string;
  mode: "modal" | "page";
  onClose?: () => void;
  /** Rendered as the dialog title in modal mode (a11y) */
  TitleTag?: React.ElementType;
}

export function DetailView({ idOrSlug, mode, onClose, TitleTag = "h1" }: DetailViewProps) {
  const initial = recallCard(idOrSlug);
  const { data, error, isPending, isPlaceholderData, refetch } = useTitle(idOrSlug, initial);
  const muted = useUI((s) => s.muted);
  const setMuted = useUI((s) => s.setMuted);
  const setPreviewOwner = useUI((s) => s.setPreviewOwner);
  const [videoOn, setVideoOn] = useState(false);
  const [startPreview, setStartPreview] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setStartPreview(true), 900);
    return () => clearTimeout(t);
  }, [idOrSlug]);

  useEffect(() => {
    setPreviewOwner(`detail:${idOrSlug}`);
    return () => setPreviewOwner(null);
  }, [idOrSlug, setPreviewOwner]);

  if (isPending && !data) return <DetailSkeleton mode={mode} onClose={onClose} />;
  if (error && !data) {
    return (
      <div className="relative min-h-80">
        {onClose && <CloseButton onClose={onClose} />}
        <ErrorPanel error={error} onRetry={() => void refetch()} title="Không mở được nội dung" />
      </div>
    );
  }
  if (!data) return null;

  const t = data;
  const detailLoaded = !isPlaceholderData;
  const progress = t.progress && !t.progress.completed && t.progress.positionSec > 30 ? t.progress : null;
  const overview = t.fullOverview ?? t.overview;
  const genres = t.genreList?.length ? t.genreList.map((g) => g.name) : t.genres;

  return (
    <article className="relative" data-testid="title-detail">
      {/* hero */}
      <div className={cn("relative aspect-video w-full overflow-hidden", mode === "page" && "md:rounded-t-lg")}>
        <Artwork image={t.backdrop ?? t.poster} alt="" sizes="(min-width: 900px) 850px, 100vw" preload quality={85} fallbackLabel={t.name} />
        {t.hasPreview && <PreviewVideo titleId={t.id} active={startPreview} onPlayingChange={setVideoOn} loop={false} />}
        <div className="absolute inset-0 bg-gradient-to-t from-elevated via-elevated/0 via-45% to-transparent" />
        {onClose && <CloseButton onClose={onClose} />}

        <div className="absolute inset-x-[5%] bottom-[7%] flex items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            {t.logo ? (
              <div className="relative mb-[4%] aspect-[3/1] w-[min(42%,22rem)]">
                <Image src={t.logo.url} alt={t.name} fill sizes="360px" className="object-contain object-left-bottom" />
              </div>
            ) : null}
            <TitleTag className={cn(t.logo ? "sr-only" : "mb-[3%] max-w-[80%] text-[clamp(1.6rem,4.2vw,2.75rem)] leading-[1.05] font-black tracking-tight text-shadow")}>
              {t.name}
            </TitleTag>
            <div className="flex items-center gap-2">
              <PlayButton title={t} size="md" className="h-[clamp(2.25rem,4.5vw,2.75rem)] px-[clamp(1rem,3vw,1.75rem)] text-[clamp(0.95rem,1.8vw,1.1rem)]" />
              <MyListButton title={t} className="size-[clamp(2.25rem,4.5vw,2.6rem)]" />
              <RateButton title={t} className="size-[clamp(2.25rem,4.5vw,2.6rem)]" />
            </div>
          </div>
          {videoOn && (
            <button
              type="button"
              onClick={() => setMuted(!muted)}
              aria-label={muted ? "Bật tiếng" : "Tắt tiếng"}
              className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-white/50 text-white hover:border-white"
            >
              {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
            </button>
          )}
        </div>
      </div>

      {/* info */}
      <div className="px-[5%] pb-8 animate-[rise-in_.55s_cubic-bezier(.16,1,.3,1)_both]">
        <div className="grid gap-x-8 gap-y-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[0.95rem] text-white/80">
              <MatchScore score={t.matchScore} />
              {t.year && <span>{t.year}</span>}
              {t.type === "SERIES" && (t.seasonCount || t.seasons?.length) ? (
                <span>{seriesLength(t)}</span>
              ) : (
                formatRuntime(t.runtimeMinutes) && <span>{formatRuntime(t.runtimeMinutes)}</span>
              )}
              <QualityBadge label={qualityLabel(t.maxAvailableHeight) ?? "HD"} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[0.95rem]">
              <MaturityBadge rating={t.maturityRating} />
              {t.genres.length > 0 && <span className="text-white/80">{t.genres.slice(0, 3).join(", ")}</span>}
            </div>
            {progress && (
              <div className="flex max-w-md flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80">
                {t.type === "SERIES" && t.resumeEpisode && t.resumeEpisode.id === progress.episodeId ? (
                  <span className="w-full font-semibold text-white" data-testid="detail-resume-episode">
                    {episodeLabel(t.resumeEpisode)}
                  </span>
                ) : null}
                <div className="h-[3px] flex-1 bg-white/25">
                  <div className="h-full bg-brand" style={{ width: `${Math.max(3, progress.ratio * 100)}%` }} />
                </div>
                <span className="shrink-0">{formatRemaining(progress.positionSec, progress.durationSec)}</span>
              </div>
            )}
            {t.tagline && <p className="text-base font-semibold text-white">{t.tagline}</p>}
            {overview ? (
              <p className="text-[0.95rem] leading-relaxed text-white md:text-base">{overview}</p>
            ) : !detailLoaded ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ) : null}
          </div>
          <dl className="space-y-3 text-sm leading-snug">
            <CreditLine label="Diễn viên" people={t.cast} more={(t.cast?.length ?? 0) > 4} />
            <MetaLine label="Thể loại" values={genres} />
            {t.directors?.length ? <CreditLine label="Đạo diễn" people={t.directors} /> : null}
          </dl>
        </div>

        {detailLoaded && t.seasons?.length > 0 && <Episodes title={t} seasons={t.seasons} />}

        <Similar titleId={detailLoaded ? t.id : null} mode={mode} />

        {detailLoaded && <About title={t} />}
      </div>
    </article>
  );
}

function seriesLength(t: TitleDetail): string {
  const seasons = t.seasonCount || t.seasons?.length || 0;
  const episodes = t.episodeCount || t.seasons?.reduce((n, s) => n + (s.episodeCount ?? s.episodes.length), 0) || 0;
  return seasons > 1 ? `${seasons} mùa` : `${episodes} tập`;
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Đóng"
      data-testid="detail-close"
      className="absolute top-3 right-3 z-10 flex size-9 items-center justify-center rounded-full bg-[#181818] text-white shadow-lg transition-colors hover:bg-[#2a2a2a] md:top-4 md:right-4"
    >
      <X className="size-5" strokeWidth={2.5} />
    </button>
  );
}

function CreditLine({ label, people, more }: { label: string; people?: CreditDto[]; more?: boolean }) {
  if (!people?.length) return null;
  return (
    <div>
      <dt className="inline text-[#777]">{label}: </dt>
      <dd className="inline text-white/90">
        {people.slice(0, 4).map((p, i) => (
          <span key={p.id}>
            {i > 0 && ", "}
            {p.name}
          </span>
        ))}
        {more && (
          <>
            ,{" "}
            <a href="#about" className="italic hover:underline">
              xem thêm
            </a>
          </>
        )}
      </dd>
    </div>
  );
}

function MetaLine({ label, values }: { label: string; values?: string[] }) {
  if (!values?.length) return null;
  return (
    <div>
      <dt className="inline text-[#777]">{label}: </dt>
      <dd className="inline text-white/90">{values.join(", ")}</dd>
    </div>
  );
}

function Episodes({ title, seasons }: { title: TitleDetail; seasons: SeasonDto[] }) {
  const sorted = [...seasons].sort((a, b) => a.seasonNumber - b.seasonNumber);
  const initialSeason =
    title.resumeEpisode?.seasonNumber ??
    sorted.find((s) => s.episodes.some((e) => e.id === title.progress?.episodeId))?.seasonNumber ??
    sorted.find((s) => s.episodes.length > 0)?.seasonNumber ??
    sorted[0].seasonNumber;
  const [seasonNumber, setSeasonNumber] = useState(initialSeason);
  const season = sorted.find((s) => s.seasonNumber === seasonNumber) ?? sorted[0];
  const q = useSeasonEpisodes(title.id, season);
  const episodes = q.data?.episodes ?? [];
  const seasonLabel = (s: SeasonDto) => s.name?.trim() || `Mùa ${s.seasonNumber}`;
  const highlightId = title.resumeEpisode?.id ?? title.progress?.episodeId ?? null;

  return (
    <section className="mt-10" aria-labelledby="episodes-heading" data-testid="episodes">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="episodes-heading" className="text-2xl font-bold">
          Các tập
        </h2>
        {sorted.length > 1 ? (
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger
              data-testid="season-select"
              aria-label={`Chọn mùa, đang chọn ${seasonLabel(season)}`}
              className="inline-flex h-11 min-w-36 items-center justify-between gap-3 rounded border border-white/40 bg-[#242424] px-4 text-base font-bold text-white outline-none hover:bg-[#2f2f2f] focus-visible:ring-2 focus-visible:ring-white data-[state=open]:bg-[#2f2f2f]"
            >
              {seasonLabel(season)}
              <ChevronDown className="size-5" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-[90] max-h-[min(60vh,420px)] min-w-56 overflow-y-auto rounded border border-white/15 bg-[#242424] py-1 text-white shadow-2xl data-[state=open]:animate-fade-in"
              >
                {sorted.map((s) => (
                  <DropdownMenu.Item
                    key={s.id}
                    onSelect={() => setSeasonNumber(s.seasonNumber)}
                    data-testid={`season-option-${s.seasonNumber}`}
                    className={cn(
                      "flex cursor-pointer items-baseline justify-between gap-6 px-4 py-2.5 text-base outline-none data-[highlighted]:bg-white/10",
                      s.seasonNumber === season.seasonNumber && "font-bold",
                    )}
                  >
                    <span>{seasonLabel(s)}</span>
                    <span className="text-sm font-normal text-white/60">{s.episodeCount} tập</span>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : (
          <span className="text-lg font-semibold text-white/80">{seasonLabel(season)}</span>
        )}
      </div>
      {season.overview ? <p className="mb-4 max-w-3xl text-sm text-white/70">{season.overview}</p> : null}
      {q.isPending ? (
        <ol className="divide-y divide-white/10 border-y border-white/10" aria-busy aria-label="Đang tải danh sách tập">
          {Array.from({ length: Math.min(4, Math.max(1, season.episodeCount)) }, (_, i) => (
            <li key={i} className="flex items-center gap-3 px-2 py-4 md:gap-5 md:px-4">
              <Skeleton className="h-6 w-6 md:w-10" />
              <Skeleton className="aspect-video w-28 rounded md:w-36" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </li>
          ))}
        </ol>
      ) : q.isError ? (
        <div className="rounded border border-white/10 px-4 py-6 text-center text-white/70">
          Không tải được danh sách tập.{" "}
          <button type="button" onClick={() => void q.refetch()} className="font-semibold text-white underline">
            Thử lại
          </button>
        </div>
      ) : episodes.length === 0 ? (
        <p className="rounded border border-white/10 px-4 py-6 text-center text-white/60">Mùa này chưa có tập nào.</p>
      ) : (
        <ol className="divide-y divide-white/10 border-y border-white/10" data-testid="episode-list">
          {episodes.map((ep) => (
            <EpisodeRow key={ep.id} title={title} ep={ep} highlighted={ep.id === highlightId} />
          ))}
        </ol>
      )}
    </section>
  );
}

function EpisodeRow({ title, ep, highlighted }: { title: TitleDetail; ep: EpisodeDto; highlighted: boolean }) {
  const progress = ep.progress ? (ep.progress.completed ? 1 : ep.progress.ratio) : null;
  const remaining = ep.progress && !ep.progress.completed ? formatRemaining(ep.progress.positionSec, ep.progress.durationSec) : null;
  const air = !ep.playable && ep.airDate ? formatDate(ep.airDate, { day: "numeric", month: "numeric", year: "numeric" }) : null;
  const badge = !ep.playable ? (
    <p className="mt-1 inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-1.5 py-0.5 text-xs font-medium text-white/70">{air ? `Ra mắt ${air}` : "Sắp ra mắt"}</p>
  ) : null;
  const inner = (
    <>
      <span className="hidden w-10 shrink-0 text-center text-2xl text-white/60 tabular-nums sm:block">{ep.episodeNumber}</span>
      <div className="flex min-w-0 items-center gap-3 sm:contents">
        <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded bg-[#2a2a2a] sm:w-36">
          <Artwork image={ep.still ?? title.backdrop} alt="" sizes="150px" quality={60} />
          {ep.playable && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover/ep:opacity-100 group-focus-visible/ep:opacity-100 max-sm:opacity-100">
              <span className="flex size-9 items-center justify-center rounded-full border-2 border-white bg-black/50 sm:size-10">
                <Play className="size-4 translate-x-px fill-white sm:size-5" />
              </span>
            </span>
          )}
          {progress != null && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/30" aria-label={ep.progress?.completed ? "Đã xem" : `Đã xem ${Math.round(progress * 100)}%`}>
              <div className="h-full bg-brand" style={{ width: `${Math.max(4, progress * 100)}%` }} />
            </div>
          )}
        </div>
        {/* phone: number + name stacked next to the still, synopsis full width below */}
        <div className="min-w-0 flex-1 sm:hidden">
          <h3 className="line-clamp-2 text-[0.95rem] leading-snug font-semibold">
            {ep.episodeNumber}. {episodeName(ep)}
          </h3>
          <p className="mt-0.5 text-xs text-white/60">{[ep.runtimeMinutes ? `${ep.runtimeMinutes} phút` : null, remaining].filter(Boolean).join(" · ")}</p>
          {badge}
        </div>
      </div>
      {ep.overview && <p className="line-clamp-3 text-[0.8rem] leading-snug text-white/70 sm:hidden">{ep.overview}</p>}
      <div className="hidden min-w-0 flex-1 sm:block">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="truncate font-semibold">{episodeName(ep)}</h3>
          {ep.runtimeMinutes ? <span className="shrink-0 text-sm text-white/70">{ep.runtimeMinutes} phút</span> : null}
        </div>
        {ep.overview && <p className="mt-1 line-clamp-3 text-sm leading-snug text-white/70">{ep.overview}</p>}
        {remaining ? <p className="mt-1 text-xs text-white/60">{remaining}</p> : null}
        {badge}
      </div>
    </>
  );
  const cls = cn(
    "group/ep flex flex-col gap-2.5 rounded px-2 py-4 outline-none sm:flex-row sm:items-center sm:gap-5 md:px-4",
    highlighted && "bg-[#333]",
    ep.playable && "hover:bg-[#2a2a2a] focus-visible:ring-2 focus-visible:ring-white",
  );
  return (
    <li data-testid="episode-row" data-episode-id={ep.id} data-playable={ep.playable}>
      {ep.playable ? (
        <Link href={watchHref(title, ep.id)} className={cls} aria-label={`Phát ${episodeCode(ep)} · ${episodeName(ep)}`}>
          {inner}
        </Link>
      ) : (
        <div className={cn(cls, "opacity-60")} aria-disabled>
          {inner}
        </div>
      )}
    </li>
  );
}

function Similar({ titleId, mode }: { titleId: string | null; mode: "modal" | "page" }) {
  const { data, isPending } = useSimilar(titleId);
  const [expanded, setExpanded] = useState(false);
  if (!titleId) return null;
  if (!isPending && (!data || data.length === 0)) return null;
  const items = data ?? [];
  const visible = expanded ? items : items.slice(0, 9);

  return (
    <section className="mt-10" aria-labelledby="similar-heading">
      <h2 id="similar-heading" className="mb-5 text-2xl font-bold">
        Nội dung tương tự
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4">
        {isPending
          ? Array.from({ length: 6 }, (_, i) => (
              <li key={i}>
                <Skeleton className="aspect-[3/4] w-full rounded-md" />
              </li>
            ))
          : visible.map((card) => <SimilarCard key={card.id} card={card} replace={mode === "modal"} />)}
      </ul>
      {items.length > 9 && (
        <div className="relative mt-2 flex justify-center border-b-2 border-[#404040]">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? "Thu gọn" : "Xem thêm"}
            className="absolute -bottom-5 flex size-10 items-center justify-center rounded-full border-2 border-white/50 bg-[#2a2a2a]/80 hover:border-white"
          >
            <ChevronDown className={cn("size-6 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>
      )}
    </section>
  );
}

function SimilarCard({ card, replace }: { card: TitleCard; replace: boolean }) {
  const router = useRouter();
  const toggle = useToggleMyList();
  const open = () => {
    rememberCard(card);
    if (replace) router.replace(titleHref(card), { scroll: false });
    else router.push(titleHref(card));
  };
  return (
    <li className="overflow-hidden rounded-md bg-[#2f2f2f]">
      <button type="button" onClick={open} className="group/sim relative block aspect-video w-full overflow-hidden" aria-label={card.name}>
        <Artwork image={card.backdrop ?? card.poster} alt="" sizes="(min-width: 900px) 260px, 45vw" fallbackLabel={card.name} />
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover/sim:opacity-100">
          <span className="flex size-11 items-center justify-center rounded-full border-2 border-white bg-black/50">
            <Play className="size-5 translate-x-px fill-white" />
          </span>
        </span>
        {card.runtimeMinutes && card.type === "MOVIE" ? (
          <span className="absolute top-2 right-2 rounded bg-black/60 px-1.5 text-xs font-semibold">{formatRuntime(card.runtimeMinutes)}</span>
        ) : null}
      </button>
      <div className="space-y-2 p-3 md:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1 text-sm">
            <p className="truncate font-semibold">{card.name}</p>
            <div className="flex flex-wrap items-center gap-1.5 text-white/75">
              <MatchScore score={card.matchScore} className="text-[0.8rem]" />
              <MaturityBadge rating={card.maturityRating} className="text-[0.75rem]" />
              {card.year && <span>{card.year}</span>}
            </div>
          </div>
          <Tooltip content={card.inMyList ? "Xóa khỏi Danh sách của tôi" : "Thêm vào Danh sách của tôi"}>
            <button
              type="button"
              aria-label={card.inMyList ? "Xóa khỏi Danh sách của tôi" : "Thêm vào Danh sách của tôi"}
              aria-pressed={card.inMyList}
              onClick={() => toggle.mutate({ title: card, add: !card.inMyList })}
              className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-white/50 bg-[#2a2a2a]/60 hover:border-white"
            >
              {card.inMyList ? <Check className="size-5" /> : <Plus className="size-5" />}
            </button>
          </Tooltip>
        </div>
        {card.overview && <p className="line-clamp-4 text-[0.8125rem] leading-snug text-white/70 max-sm:line-clamp-3">{card.overview}</p>}
      </div>
    </li>
  );
}

function About({ title }: { title: TitleDetail }) {
  return (
    <section id="about" className="mt-10 scroll-mt-8 pb-4" aria-labelledby="about-heading">
      <h2 id="about-heading" className="mb-4 text-2xl">
        Giới thiệu về <strong>{title.name}</strong>
      </h2>
      <dl className="space-y-2.5 text-sm leading-snug">
        {title.directors?.length ? <CreditAll label="Đạo diễn" people={title.directors} /> : null}
        {title.cast?.length ? <CreditAll label="Diễn viên" people={title.cast} /> : null}
        {title.writers?.length ? <CreditAll label="Biên kịch" people={title.writers} /> : null}
        <MetaLine label="Thể loại" values={title.genreList?.map((g) => g.name) ?? title.genres} />
        {title.originalName && title.originalName !== title.name && <MetaLine label="Tên gốc" values={[title.originalName]} />}
        {title.countries?.length ? <MetaLine label="Quốc gia" values={title.countries} /> : null}
        {title.maturityRating && (
          <div className="flex items-center gap-2">
            <dt className="text-[#777]">Phân loại độ tuổi:</dt>
            <dd>
              <MaturityBadge rating={title.maturityRating} />
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function CreditAll({ label, people }: { label: string; people: CreditDto[] }) {
  return (
    <div>
      <dt className="inline text-[#777]">{label}: </dt>
      <dd className="inline text-white/90">{people.map((p) => p.name).join(", ")}</dd>
    </div>
  );
}

function DetailSkeleton({ mode, onClose }: { mode: "modal" | "page"; onClose?: () => void }) {
  return (
    <div className="relative" aria-busy aria-label="Đang tải">
      <div className={cn("relative aspect-video w-full", mode === "page" && "md:rounded-t-lg")}>
        <Skeleton className="absolute inset-0 rounded-none" />
        {onClose && <CloseButton onClose={onClose} />}
      </div>
      <div className="space-y-3 px-[5%] py-6">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

export { watchHref };
