"use client";

import type { EpisodeDto } from "@app/shared";
import { useState } from "react";
import { episodeName } from "@/lib/episodes";
import { useSeasonEpisodes } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { usePlayer } from "../controller";
import { usePlayerStore } from "../store";
import { EpisodesIcon, PlayIcon } from "./icons";
import { MenuPanel, MenuTrigger } from "./menus";

/** Series: browse seasons / episodes and switch in place without leaving the player. */
export function EpisodesMenu() {
  const { detail, session } = usePlayer();
  const open = usePlayerStore((s) => s.menu === "episodes");
  const seasons = detail?.seasons ?? [];
  if (!session?.episode || seasons.length === 0) return null;
  return (
    <div className="relative">
      <MenuTrigger id="episodes" label="Các tập">
        <EpisodesIcon />
      </MenuTrigger>
      <MenuPanel id="episodes" title="Các tập" className="md:w-[min(560px,calc(100vw-4rem))] md:py-0">
        {open && <EpisodesPanelBody currentSeason={session.episode.seasonNumber} />}
      </MenuPanel>
    </div>
  );
}

function EpisodesPanelBody({ currentSeason }: { currentSeason: number }) {
  const { detail, titleId } = usePlayer();
  const seasons = detail?.seasons ?? [];
  const [seasonNumber, setSeasonNumber] = useState(currentSeason);
  const season = seasons.find((s) => s.seasonNumber === seasonNumber) ?? seasons[0];
  const q = useSeasonEpisodes(titleId, season);

  return (
    <div data-testid="episodes-panel">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-[#1f1f1f] px-4 py-3 md:bg-[#262626] md:px-5 md:pt-4">
        {seasons.length > 1 ? (
          <label className="relative">
            <span className="sr-only">Chọn mùa</span>
            <select
              value={season?.seasonNumber}
              onChange={(e) => setSeasonNumber(Number(e.target.value))}
              data-testid="player-season-select"
              className="h-10 appearance-none rounded border border-white/30 bg-[#2f2f2f] pr-9 pl-3 text-base font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.seasonNumber}>
                  {s.name || `Mùa ${s.seasonNumber}`}
                </option>
              ))}
            </select>
            <span aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-white" />
          </label>
        ) : (
          <h3 className="text-lg font-bold md:text-xl">{season?.name || `Mùa ${season?.seasonNumber ?? 1}`}</h3>
        )}
        {season ? <span className="text-sm text-white/60">{season.episodeCount} tập</span> : null}
      </div>
      {q.isPending ? (
        <ul className="space-y-2 px-4 pb-4 md:px-5" aria-busy>
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="h-16 animate-pulse rounded bg-white/5" />
          ))}
        </ul>
      ) : q.isError ? (
        <p className="px-5 pb-5 text-sm text-white/70">
          Không tải được danh sách tập.{" "}
          <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>
            Thử lại
          </button>
        </p>
      ) : (
        <ol className="pb-3">
          {q.data.episodes.map((ep) => (
            <EpisodeItem key={ep.id} ep={ep} />
          ))}
        </ol>
      )}
    </div>
  );
}

function EpisodeItem({ ep }: { ep: EpisodeDto }) {
  const { session, playEpisode, detail } = usePlayer();
  const current = session?.episode?.id === ep.id;
  const progress = ep.progress && !ep.progress.completed ? ep.progress.ratio : ep.progress?.completed ? 1 : null;
  const still = ep.still?.url ?? detail?.backdrop?.url ?? null;
  return (
    <li>
      <button
        type="button"
        disabled={!ep.playable}
        aria-current={current ? "true" : undefined}
        onClick={() => playEpisode(ep.id)}
        data-testid="player-episode-item"
        data-episode-id={ep.id}
        className={cn(
          "group/ep flex w-full items-start gap-3 px-4 py-3 text-left outline-none md:px-5",
          current ? "bg-white/10" : "hover:bg-white/[0.07] focus-visible:bg-white/10",
          !ep.playable && "cursor-not-allowed opacity-50",
        )}
      >
        <span className="w-6 shrink-0 pt-1 text-center text-lg font-semibold text-white/60 tabular-nums">{ep.episodeNumber}</span>
        <span className={cn("relative aspect-video shrink-0 overflow-hidden rounded-[3px] bg-[#2a2a2a]", current ? "w-32 md:w-40" : "w-24 md:w-28")}>
          {still ? (
            // eslint-disable-next-line @next/next/no-img-element -- CDN still
            <img src={still} alt="" loading="lazy" className="size-full object-cover" />
          ) : null}
          {ep.playable && !current ? (
            <span className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition-opacity group-hover/ep:opacity-100">
              <PlayIcon className="size-7" />
            </span>
          ) : null}
          {progress != null ? (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/30">
              <span className="block h-full bg-[var(--brand,#e50914)]" style={{ width: `${Math.max(4, progress * 100)}%` }} />
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate font-semibold", current ? "text-white" : "text-white/90")}>{episodeName(ep)}</span>
            {ep.runtimeMinutes ? <span className="shrink-0 text-xs text-white/55">{ep.runtimeMinutes} phút</span> : null}
          </span>
          {current ? <span className="mt-0.5 block text-xs font-semibold text-[var(--brand,#e50914)]">Đang phát</span> : null}
          {!ep.playable ? <span className="mt-0.5 block text-xs text-white/60">Sắp ra mắt</span> : null}
          {ep.overview && current ? <span className="mt-1 line-clamp-3 block text-sm leading-snug text-white/70">{ep.overview}</span> : null}
        </span>
      </button>
    </li>
  );
}
