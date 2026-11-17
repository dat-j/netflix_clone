"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type {
  AdminEpisode,
  AdminEpisodeInput,
  AdminSeason,
  AdminSeasonInput,
  AdminStats,
  AdminTitle,
  AdminTitleInput,
  AdminUser,
  BillboardDto,
  CollectionDto,
  CollectionInput,
  GenreDto,
  HomeRowDto,
  HomeRowInput,
  JobStatus,
  MeResponse,
  Paginated,
  PlanDto,
  PlanInput,
  SourceFileDto,
  TranscodeJobDto,
  MediaAssetDto,
  ImageDto,
} from "@app/shared";
import { api } from "@/lib/api/client";
import { anyEpisodeBusy } from "./series";

export const qk = {
  me: ["auth", "me"] as const,
  stats: ["admin", "stats"] as const,
  titles: (p: object) => ["admin", "titles", "list", p] as const,
  titlesAll: ["admin", "titles"] as const,
  title: (id: string) => ["admin", "titles", "detail", id] as const,
  seasons: (id: string) => ["admin", "titles", "seasons", id] as const,
  genres: ["admin", "genres"] as const,
  sourceFiles: (p: object) => ["admin", "source-files", p] as const,
  sourceFilesAll: ["admin", "source-files"] as const,
  jobs: (p: object) => ["admin", "jobs", p] as const,
  jobsAll: ["admin", "jobs"] as const,
  users: (p: object) => ["admin", "users", p] as const,
  usersAll: ["admin", "users"] as const,
  plans: ["admin", "plans"] as const,
  homeRows: ["admin", "home-rows"] as const,
  collections: ["admin", "collections"] as const,
  billboards: ["admin", "billboards"] as const,
};

export const isActiveJob = (s: JobStatus | undefined | null) => s === "QUEUED" || s === "RUNNING";

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: () => api<MeResponse>("/auth/me"), retry: false, staleTime: 60_000 });
}

export function useStats() {
  return useQuery({ queryKey: qk.stats, queryFn: () => api<AdminStats>("/admin/stats"), refetchInterval: 15_000 });
}

export interface TitleFilters {
  q: string;
  status: string;
  type: string;
  page: number;
}
export function useTitles(f: TitleFilters) {
  return useQuery({
    queryKey: qk.titles(f),
    queryFn: () => api<Paginated<AdminTitle>>("/admin/titles", { query: { ...f, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });
}

export function useTitle(id: string) {
  return useQuery({
    queryKey: qk.title(id),
    queryFn: () => api<AdminTitle>(`/admin/titles/${encodeURIComponent(id)}`),
    // Theo dõi tiến độ transcode khi có job đang chạy
    refetchInterval: (q) => {
      const t = q.state.data;
      if (!t) return false;
      const busy = [t.mainAsset, t.previewAsset].some(
        (a) => a && (a.status === "QUEUED" || a.status === "PROCESSING" || a.status === "PENDING" || isActiveJob(a.latestJob?.status)),
      );
      return busy ? 2500 : false;
    },
  });
}

/** Mùa + tập của phim bộ; tự làm mới khi có tập đang transcode. */
export function useSeasons(titleId: string, enabled = true) {
  return useQuery({
    queryKey: qk.seasons(titleId),
    queryFn: () => api<AdminSeason[]>(`/admin/titles/${encodeURIComponent(titleId)}/seasons`),
    enabled,
    refetchInterval: (q) => (anyEpisodeBusy(q.state.data) ? 2500 : false),
  });
}

export function useGenres() {
  return useQuery({ queryKey: qk.genres, queryFn: () => api<GenreDto[]>("/admin/genres"), staleTime: 5 * 60_000 });
}

export interface SourceFileFilters {
  q: string;
  prefix: string;
  status: string;
  unlinked: boolean;
  page: number;
}
export function useSourceFiles(f: SourceFileFilters, enabled = true) {
  return useQuery({
    queryKey: qk.sourceFiles(f),
    queryFn: () =>
      api<Paginated<SourceFileDto>>("/admin/source-files", {
        query: { q: f.q, prefix: f.prefix, status: f.status, unlinked: f.unlinked ? "true" : undefined, page: f.page, pageSize: 25 },
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useJobs(f: { status: string; page: number }) {
  return useQuery({
    queryKey: qk.jobs(f),
    queryFn: () => api<Paginated<TranscodeJobDto>>("/admin/jobs", { query: { ...f, pageSize: 25 } }),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items.some((j) => isActiveJob(j.status)) ? 2000 : 10_000),
  });
}

export function useUsers(f: { q: string; page: number }) {
  return useQuery({
    queryKey: qk.users(f),
    queryFn: () => api<Paginated<AdminUser>>("/admin/users", { query: { ...f, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });
}

export function usePlans() {
  return useQuery({ queryKey: qk.plans, queryFn: () => api<PlanDto[]>("/admin/plans") });
}
export function useHomeRows() {
  return useQuery({ queryKey: qk.homeRows, queryFn: () => api<HomeRowDto[]>("/admin/home-rows") });
}
export function useCollections() {
  return useQuery({ queryKey: qk.collections, queryFn: () => api<CollectionDto[]>("/admin/collections") });
}
export function useBillboards() {
  return useQuery({ queryKey: qk.billboards, queryFn: () => api<BillboardDto[]>("/admin/billboards") });
}

/** Mutation gọn: chạy fn, invalidate các key. */
export function useAdminMutation<TVars, TData = unknown>(fn: (v: TVars) => Promise<TData>, invalidate: QueryKey[] = [], onSuccess?: (data: TData, v: TVars) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (data, v) => {
      onSuccess?.(data, v);
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
    },
  });
}

// Các lệnh gọi thô (dùng trong mutation)
export const adminApi = {
  createTitle: (b: AdminTitleInput) => api<AdminTitle>("/admin/titles", { method: "POST", body: b }),
  updateTitle: (id: string, b: Partial<AdminTitleInput>) => api<AdminTitle>(`/admin/titles/${id}`, { method: "PATCH", body: b }),
  deleteTitle: (id: string) => api(`/admin/titles/${id}`, { method: "DELETE" }),
  publish: (id: string) => api<AdminTitle>(`/admin/titles/${id}/publish`, { method: "POST" }),
  unpublish: (id: string) => api<AdminTitle>(`/admin/titles/${id}/unpublish`, { method: "POST" }),
  syncTmdb: (id: string) => api<AdminTitle>(`/admin/titles/${id}/sync-tmdb`, { method: "POST" }),
  createSeason: (titleId: string, b: AdminSeasonInput) => api<AdminSeason>(`/admin/titles/${titleId}/seasons`, { method: "POST", body: b }),
  updateSeason: (id: string, b: Partial<AdminSeasonInput>) => api<AdminSeason>(`/admin/seasons/${id}`, { method: "PATCH", body: b }),
  deleteSeason: (id: string) => api(`/admin/seasons/${id}`, { method: "DELETE" }),
  createEpisode: (seasonId: string, b: AdminEpisodeInput) => api<AdminEpisode>(`/admin/seasons/${seasonId}/episodes`, { method: "POST", body: b }),
  bulkEpisodes: (seasonId: string, count: number, startAt?: number) =>
    api<AdminEpisode[]>(`/admin/seasons/${seasonId}/episodes/bulk`, { method: "POST", body: { count, ...(startAt ? { startAt } : {}) } }),
  updateEpisode: (id: string, b: Partial<AdminEpisodeInput>) => api<AdminEpisode>(`/admin/episodes/${id}`, { method: "PATCH", body: b }),
  deleteEpisode: (id: string) => api(`/admin/episodes/${id}`, { method: "DELETE" }),
  attachEpisodeSource: (id: string, sourceFileId: string) => api<MediaAssetDto>(`/admin/episodes/${id}/assets`, { method: "POST", body: { sourceFileId } }),
  publishEpisode: (id: string) => api<AdminEpisode>(`/admin/episodes/${id}/publish`, { method: "POST" }),
  unpublishEpisode: (id: string) => api<AdminEpisode>(`/admin/episodes/${id}/unpublish`, { method: "POST" }),
  uploadEpisodeStill: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("kind", "STILL");
    fd.append("file", file);
    return api<ImageDto>(`/admin/episodes/${id}/images`, { method: "POST", body: fd });
  },
  publishReady: (seasonId: string) => api<AdminEpisode[]>(`/admin/seasons/${seasonId}/publish-ready`, { method: "POST" }),
  syncTmdbSeasons: (titleId: string, seasonNumbers?: number[]) =>
    api<AdminSeason[]>(`/admin/titles/${titleId}/sync-tmdb-seasons`, { method: "POST", body: seasonNumbers?.length ? { seasonNumbers } : {} }),
  createPlan: (b: PlanInput) => api<PlanDto>("/admin/plans", { method: "POST", body: b }),
  updatePlan: (id: string, b: Partial<PlanInput>) => api<PlanDto>(`/admin/plans/${id}`, { method: "PATCH", body: b }),
  createHomeRow: (b: HomeRowInput) => api<HomeRowDto>("/admin/home-rows", { method: "POST", body: b }),
  updateHomeRow: (id: string, b: Partial<HomeRowInput>) => api<HomeRowDto>(`/admin/home-rows/${id}`, { method: "PATCH", body: b }),
  deleteHomeRow: (id: string) => api(`/admin/home-rows/${id}`, { method: "DELETE" }),
  reorderHomeRows: (ids: string[]) => api("/admin/home-rows/reorder", { method: "POST", body: { ids } }),
  createCollection: (b: CollectionInput) => api<CollectionDto>("/admin/collections", { method: "POST", body: b }),
  updateCollection: (id: string, b: Partial<CollectionInput>) => api<CollectionDto>(`/admin/collections/${id}`, { method: "PATCH", body: b }),
  deleteCollection: (id: string) => api(`/admin/collections/${id}`, { method: "DELETE" }),
  createBillboard: (titleId: string) => api<BillboardDto>("/admin/billboards", { method: "POST", body: { titleId } }),
  deleteBillboard: (id: string) => api(`/admin/billboards/${id}`, { method: "DELETE" }),
};
