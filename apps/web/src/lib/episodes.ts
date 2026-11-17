/** Series helpers shared by browse, detail and player. Pure, unit-tested. */

import type { EpisodeRef, TitleCard, WatchProgressDto } from "@app/shared";

type EpisodeNumbers = { seasonNumber: number; episodeNumber: number };
type NamedEpisode = EpisodeNumbers & { name: string | null };

/** "T1:E3" */
export function episodeCode(ep: EpisodeNumbers | null | undefined): string | null {
  if (!ep) return null;
  return `T${ep.seasonNumber}:E${ep.episodeNumber}`;
}

/** "T1:E3 · Khởi đầu" (or just "T1:E3" when the episode has no name). */
export function episodeLabel(ep: NamedEpisode | null | undefined): string | null {
  const code = episodeCode(ep);
  if (!code) return null;
  const name = ep?.name?.trim();
  return name ? `${code} · ${name}` : code;
}

/** Fallback display name for an episode without a name. */
export function episodeName(ep: { episodeNumber: number; name: string | null }): string {
  return ep.name?.trim() || `Tập ${ep.episodeNumber}`;
}

/** Progress worth surfacing as "in progress" (not finished, past the first 30 s). */
export function isResumable(p: WatchProgressDto | null | undefined): p is WatchProgressDto {
  return !!p && !p.completed && p.positionSec > 30;
}

export interface PlayAction {
  href: string;
  label: string;
  /** True when the label says "Tiếp tục…" */
  resume: boolean;
}

/**
 * What the big "Phát" button does.
 * - Movie: resume if there is meaningful progress.
 * - Series: plays `resumeEpisode` ("Tiếp tục T1:E3" when that episode is in progress, "Phát T1:E4" when the viewer
 *   already watched something else, plain "Phát" for a fresh start). Without a resume episode the API picks one.
 */
export function playAction(
  title: Pick<TitleCard, "id" | "type" | "progress"> & { resumeEpisode?: EpisodeRef | null },
): PlayAction {
  const base = `/watch/${title.id}`;
  if (title.type === "SERIES") {
    const ep = title.resumeEpisode ?? null;
    if (!ep) {
      const inProgress = isResumable(title.progress) && title.progress.episodeId ? title.progress.episodeId : null;
      return { href: inProgress ? `${base}?episode=${encodeURIComponent(inProgress)}` : base, label: inProgress ? "Tiếp tục" : "Phát", resume: !!inProgress };
    }
    const href = `${base}?episode=${encodeURIComponent(ep.id)}`;
    const code = episodeCode(ep)!;
    const p = title.progress;
    if (p && p.episodeId === ep.id && isResumable(p)) return { href, label: `Tiếp tục ${code}`, resume: true };
    if (p) return { href, label: `Phát ${code}`, resume: false };
    // Never watched: say which episode only if it isn't the obvious first one
    return { href, label: ep.seasonNumber === 1 && ep.episodeNumber === 1 ? "Phát" : `Phát ${code}`, resume: false };
  }
  const resume = isResumable(title.progress);
  return { href: base, label: resume ? "Tiếp tục" : "Phát", resume };
}

/** Link to the player; series with no explicit episode let the API pick the "xem tiếp" episode. */
export function watchUrl(titleId: string, episodeId?: string | null): string {
  return `/watch/${titleId}${episodeId ? `?episode=${encodeURIComponent(episodeId)}` : ""}`;
}
