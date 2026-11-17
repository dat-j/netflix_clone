"use client";

import type { TitleCard, TitleDetail } from "@app/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { episodeLabel } from "@/lib/episodes";
import { qk } from "@/lib/queries";

/**
 * "T1:E3 · Tên tập" for a series card the viewer has progress on (continue-watching row, hover card).
 * `TitleCard.progress` only carries `episodeId`, so the numbers come from the title detail (cached, shared with
 * the detail modal). Returns null for movies / cards without progress.
 */
export function useCardEpisodeLabel(card: Pick<TitleCard, "id" | "type" | "progress">, enabled = true): string | null {
  const wanted = enabled && card.type === "SERIES" && !!card.progress?.episodeId;
  const { data } = useQuery({
    queryKey: qk.title(card.id),
    queryFn: () => api<TitleDetail>(`/titles/${encodeURIComponent(card.id)}`),
    enabled: wanted,
    staleTime: 60_000,
    meta: { silent: true },
  });
  if (!wanted || !data) return null;
  const epId = card.progress?.episodeId;
  const fromSeasons = data.seasons?.flatMap((s) => s.episodes).find((e) => e.id === epId);
  if (fromSeasons) return episodeLabel(fromSeasons);
  return data.resumeEpisode ? episodeLabel(data.resumeEpisode) : null;
}
