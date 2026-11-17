/** Quy tắc phim bộ cho trang admin. Hàm thuần — test bằng vitest. */

import type { AdminEpisode, AdminEpisodeInput, AdminSeason, AdminTitle, MediaAssetDto } from "@app/shared";
import { formatMmSs, parseMmSs } from "./format";

export const isAssetBusy = (a: MediaAssetDto | null | undefined) =>
  !!a && (a.status === "PENDING" || a.status === "QUEUED" || a.status === "PROCESSING" || a.latestJob?.status === "QUEUED" || a.latestJob?.status === "RUNNING");

/** Tập có thể xuất bản: video chính READY và chưa xuất bản. */
export const isEpisodeReady = (e: AdminEpisode) => e.status !== "PUBLISHED" && e.mainAsset?.status === "READY";

export const readyEpisodeCount = (season: AdminSeason) => season.episodes.filter(isEpisodeReady).length;

export const anyEpisodeBusy = (seasons: AdminSeason[] | undefined) => !!seasons?.some((s) => s.episodes.some((e) => isAssetBusy(e.mainAsset)));

/** Lý do chưa xuất bản được tập (null = được). */
export function episodePublishBlockReason(e: AdminEpisode): string | null {
  if (e.status === "PUBLISHED") return null;
  if (!e.mainAsset) return "Chưa gắn video.";
  if (e.mainAsset.status !== "READY") return "Video chưa transcode xong.";
  return null;
}

/** Số tập kế tiếp gợi ý khi thêm tập. */
export function nextEpisodeNumber(season: Pick<AdminSeason, "episodes">): number {
  return season.episodes.reduce((m, e) => Math.max(m, e.episodeNumber), 0) + 1;
}

export function nextSeasonNumber(seasons: Pick<AdminSeason, "seasonNumber">[]): number {
  return seasons.reduce((m, s) => Math.max(m, s.seasonNumber), 0) + 1;
}

/** "2 mùa · 18 tập (12 đã XB)" cho bảng danh sách phim. */
export function seriesCountsLabel(t: Pick<AdminTitle, "type" | "seasonCount" | "episodeCount" | "publishedEpisodeCount">): string {
  if (t.type !== "SERIES") return "—";
  if (!t.seasonCount && !t.episodeCount) return "Chưa có tập";
  return `${t.seasonCount} mùa · ${t.episodeCount} tập`;
}

// ───────── form sửa tập ─────────

export interface EpisodeFormValues {
  episodeNumber: string;
  name: string;
  overview: string;
  runtimeMinutes: string;
  airDate: string;
  introStart: string;
  introEnd: string;
  creditsStart: string;
}

export function episodeToForm(e: AdminEpisode): EpisodeFormValues {
  return {
    episodeNumber: String(e.episodeNumber),
    name: e.name ?? "",
    overview: e.overview ?? "",
    runtimeMinutes: e.runtimeMinutes == null ? "" : String(e.runtimeMinutes),
    airDate: e.airDate ? e.airDate.slice(0, 10) : "",
    introStart: formatMmSs(e.introStartSec),
    introEnd: formatMmSs(e.introEndSec),
    creditsStart: formatMmSs(e.creditsStartSec),
  };
}

export type EpisodeFormErrors = Partial<Record<keyof EpisodeFormValues, string>>;

/**
 * Kiểm tra + chuyển form → AdminEpisodeInput. `durationSec` (thời lượng video nếu đã biết) để chặn mốc vượt quá video.
 */
export function parseEpisodeForm(v: EpisodeFormValues, durationSec?: number | null): { input: AdminEpisodeInput } | { errors: EpisodeFormErrors } {
  const errors: EpisodeFormErrors = {};
  const num = Number(v.episodeNumber);
  if (!/^\d+$/.test(v.episodeNumber.trim()) || num < 1) errors.episodeNumber = "Số tập là số nguyên ≥ 1";
  let runtime: number | null = null;
  if (v.runtimeMinutes.trim()) {
    runtime = Number(v.runtimeMinutes);
    if (!/^\d+$/.test(v.runtimeMinutes.trim()) || runtime < 1 || runtime > 600) errors.runtimeMinutes = "1–600 phút";
  }
  if (v.airDate && !/^\d{4}-\d{2}-\d{2}$/.test(v.airDate)) errors.airDate = "Ngày không hợp lệ";
  const mark = (key: "introStart" | "introEnd" | "creditsStart") => {
    const r = parseMmSs(v[key]);
    if (r === undefined) errors[key] = "Dạng m:ss, ví dụ 1:30";
    else if (r != null && durationSec && r > durationSec) errors[key] = `Vượt quá thời lượng (${formatMmSs(durationSec)})`;
    return r ?? null;
  };
  const introStartSec = mark("introStart");
  const introEndSec = mark("introEnd");
  const creditsStartSec = mark("creditsStart");
  if (introEndSec != null && introStartSec != null && introEndSec <= introStartSec && !errors.introEnd) errors.introEnd = "Phải sau mốc bắt đầu intro";
  if (introStartSec != null && introEndSec == null && !errors.introEnd) errors.introEnd = "Cần mốc kết thúc intro";
  if (creditsStartSec != null && introEndSec != null && creditsStartSec <= introEndSec && !errors.creditsStart) errors.creditsStart = "Phải sau phần intro";
  if (Object.keys(errors).length) return { errors };
  return {
    input: {
      episodeNumber: num,
      name: v.name.trim() || null,
      overview: v.overview.trim() || null,
      runtimeMinutes: runtime,
      airDate: v.airDate || null,
      introStartSec,
      introEndSec,
      creditsStartSec,
    },
  };
}

/** Chỉ các trường thay đổi (PATCH). */
export function diffEpisodeInput(e: AdminEpisode, next: AdminEpisodeInput): Partial<AdminEpisodeInput> {
  const out: Partial<AdminEpisodeInput> = {};
  const cur: AdminEpisodeInput = {
    episodeNumber: e.episodeNumber,
    name: e.name,
    overview: e.overview,
    runtimeMinutes: e.runtimeMinutes,
    airDate: e.airDate ? e.airDate.slice(0, 10) : null,
    introStartSec: e.introStartSec,
    introEndSec: e.introEndSec,
    creditsStartSec: e.creditsStartSec,
  };
  for (const k of Object.keys(next) as (keyof AdminEpisodeInput)[]) {
    if ((next[k] ?? null) !== (cur[k] ?? null)) (out as Record<string, unknown>)[k] = next[k];
  }
  return out;
}

/** Lý do title SERIES chưa xuất bản được. */
export function seriesPublishBlockReason(t: Pick<AdminTitle, "status" | "publishedEpisodeCount" | "episodeCount">): string | null {
  if (t.status === "PUBLISHED") return null;
  if (t.publishedEpisodeCount > 0) return null;
  if (!t.episodeCount) return "Phim bộ cần ít nhất 1 tập đã xuất bản — hãy thêm mùa và tập ở mục “Mùa & tập”.";
  return "Phim bộ cần ít nhất 1 tập đã xuất bản — gắn video cho tập, chờ transcode xong rồi xuất bản tập ở mục “Mùa & tập”.";
}
