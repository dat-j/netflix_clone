"use client";

import type {
  AvatarOption,
  DeviceSession,
  GenreDto,
  HomeResponse,
  MeResponse,
  Paginated,
  PlanDto,
  PreviewSource,
  ProfileDto,
  ProfileInput,
  RatingValue,
  SubscriptionDto,
  TitleCard,
  TitleDetail,
  TitleType,
} from "@app/shared";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "./api/client";
import { ApiRequestError } from "./api/errors";
import { errorMessage } from "./api/messages";
import { toast } from "./toast";
import { useUI } from "./ui-store";

export const qk = {
  me: ["me"] as const,
  profiles: ["profiles"] as const,
  avatars: ["avatars"] as const,
  plans: ["plans"] as const,
  subscription: ["subscription"] as const,
  sessions: ["sessions"] as const,
  home: (type?: TitleType) => ["catalog", "home", type ?? "ALL"] as const,
  row: (id: string) => ["catalog", "row", id] as const,
  genres: ["genres"] as const,
  genre: (slug: string) => ["catalog", "genre", slug] as const,
  search: (q: string) => ["catalog", "search", q] as const,
  title: (idOrSlug: string) => ["catalog", "title", idOrSlug] as const,
  similar: (id: string) => ["catalog", "similar", id] as const,
  myList: ["catalog", "my-list"] as const,
  continueWatching: ["catalog", "continue-watching"] as const,
  preview: (id: string) => ["preview", id] as const,
};

// ───────── session ─────────
export function useMe(enabled = true) {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => api<MeResponse>("/auth/me"),
    enabled,
    staleTime: 60_000,
    retry: (count, e) => e instanceof ApiRequestError && e.statusCode === 429 && count < 3,
    retryDelay: (count) => 2000 * 2 ** count,
    meta: { silent: true },
  });
}

export function useProfiles() {
  return useQuery({ queryKey: qk.profiles, queryFn: () => api<ProfileDto[]>("/profiles"), staleTime: 60_000 });
}

export function useAvatars(enabled = true) {
  return useQuery({
    queryKey: qk.avatars,
    queryFn: () => api<AvatarOption[]>("/profiles/avatars"),
    enabled,
    staleTime: Infinity,
  });
}

export function usePlans() {
  return useQuery({ queryKey: qk.plans, queryFn: () => api<PlanDto[]>("/plans"), staleTime: 5 * 60_000 });
}

export function useSubscription() {
  return useQuery({ queryKey: qk.subscription, queryFn: () => api<SubscriptionDto | null>("/subscription") });
}

export function useDeviceSessions() {
  return useQuery({ queryKey: qk.sessions, queryFn: () => api<DeviceSession[]>("/auth/sessions") });
}

// ───────── catalog ─────────
export function useHome(type?: TitleType) {
  return useQuery({
    queryKey: qk.home(type),
    queryFn: () => api<HomeResponse>("/browse/home", { query: { type } }),
    staleTime: 60_000,
  });
}

export function useGenres() {
  return useQuery({ queryKey: qk.genres, queryFn: () => api<GenreDto[]>("/browse/genres"), staleTime: 10 * 60_000 });
}

type GenrePage = { genre: GenreDto } & Paginated<TitleCard>;

export function useGenreTitles(slug: string, sort?: string) {
  return useInfiniteQuery({
    queryKey: [...qk.genre(slug), sort ?? "default"],
    queryFn: ({ pageParam }) =>
      api<GenrePage>(`/browse/genres/${encodeURIComponent(slug)}`, { query: { page: pageParam, pageSize: 30, sort } }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });
}

export function useSearch(q: string) {
  const term = q.trim();
  return useInfiniteQuery({
    queryKey: qk.search(term),
    queryFn: ({ pageParam, signal }) =>
      api<Paginated<TitleCard>>("/browse/search", { query: { q: term, page: pageParam, pageSize: 30 }, signal }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: term.length > 0,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

export function fetchRowPage(rowId: string, page: number) {
  return api<Paginated<TitleCard>>(`/browse/rows/${encodeURIComponent(rowId)}`, { query: { page } });
}

export function useTitle(idOrSlug: string | null, initial?: TitleCard | null) {
  return useQuery({
    queryKey: qk.title(idOrSlug ?? ""),
    queryFn: () => api<TitleDetail>(`/titles/${encodeURIComponent(idOrSlug!)}`),
    enabled: !!idOrSlug,
    staleTime: 60_000,
    // Show the card data instantly while the detail loads (fields missing on TitleCard are optional in the UI)
    placeholderData: initial ? (initial as TitleDetail) : undefined,
  });
}

export function useSimilar(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.similar(id ?? ""),
    queryFn: () => api<TitleCard[]>(`/titles/${id}/similar`),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });
}

export function useMyList() {
  return useQuery({ queryKey: qk.myList, queryFn: () => api<TitleCard[]>("/my-list"), staleTime: 30_000 });
}

export function usePreviewSource(titleId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.preview(titleId ?? ""),
    queryFn: () => api<PreviewSource>(`/playback/preview/${titleId}`),
    enabled: enabled && !!titleId,
    staleTime: 5 * 60_000,
    retry: false,
    meta: { silent: true },
  });
}

// ───────── optimistic helpers ─────────
type Patch = Partial<Pick<TitleCard, "inMyList" | "rating" | "progress">>;

function isTitleLike(v: unknown): v is TitleCard {
  return !!v && typeof v === "object" && "id" in v && "slug" in v && "inMyList" in v;
}

/** Deep-map any cached catalog structure, patching every TitleCard/TitleDetail with this id. */
function deepPatch<T>(data: T, titleId: string, patch: Patch): T {
  if (Array.isArray(data)) {
    let changed = false;
    const next = data.map((x) => {
      const y = deepPatch(x, titleId, patch);
      if (y !== x) changed = true;
      return y;
    });
    return (changed ? next : data) as T;
  }
  if (data && typeof data === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      const nv = deepPatch(v, titleId, patch);
      if (nv !== v) changed = true;
      out[k] = nv;
    }
    if (isTitleLike(data) && data.id === titleId) return { ...(changed ? out : data), ...patch } as T;
    return (changed ? out : data) as T;
  }
  return data;
}

export function patchTitleEverywhere(qc: QueryClient, titleId: string, patch: Patch) {
  qc.setQueriesData({ queryKey: ["catalog"] }, (old: unknown) => (old === undefined ? old : deepPatch(old, titleId, patch)));
  // The floating hover card holds a snapshot of the card — keep it in sync too
  useUI.setState((s) => (s.hover && s.hover.card.id === titleId ? { hover: { ...s.hover, card: { ...s.hover.card, ...patch } } } : {}));
}

function snapshotCatalog(qc: QueryClient) {
  return qc.getQueriesData({ queryKey: ["catalog"] });
}
function restore(qc: QueryClient, snap: ReturnType<typeof snapshotCatalog>) {
  for (const [key, data] of snap) qc.setQueryData(key, data);
}

export function useToggleMyList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ title, add }: { title: TitleCard; add: boolean }) =>
      api(`/my-list/${title.id}`, { method: add ? "PUT" : "DELETE" }),
    onMutate: async ({ title, add }) => {
      await qc.cancelQueries({ queryKey: ["catalog"] });
      const snap = snapshotCatalog(qc);
      patchTitleEverywhere(qc, title.id, { inMyList: add });
      qc.setQueryData<TitleCard[]>(qk.myList, (old) => {
        if (!old) return old;
        return add ? [{ ...title, inMyList: true }, ...old.filter((t) => t.id !== title.id)] : old.filter((t) => t.id !== title.id);
      });
      return { snap };
    },
    onSuccess: (_d, { add, title }) => {
      toast({ message: add ? `Đã thêm “${title.name}” vào Danh sách của tôi` : `Đã xóa “${title.name}” khỏi Danh sách của tôi` });
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      toast({ message: errorMessage(e), tone: "error" });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.myList });
      void qc.invalidateQueries({ queryKey: ["catalog", "home"], refetchType: "none" });
    },
  });
}

export function useRateTitle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ titleId, value }: { titleId: string; value: RatingValue | null }) =>
      value ? api(`/ratings/${titleId}`, { method: "PUT", body: { value } }) : api(`/ratings/${titleId}`, { method: "DELETE" }),
    onMutate: async ({ titleId, value }) => {
      await qc.cancelQueries({ queryKey: ["catalog"] });
      const snap = snapshotCatalog(qc);
      patchTitleEverywhere(qc, titleId, { rating: value });
      return { snap };
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      toast({ message: errorMessage(e), tone: "error" });
    },
  });
}

export function useRemoveFromContinueWatching() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (titleId: string) => api(`/continue-watching/${titleId}`, { method: "DELETE" }),
    onMutate: async (titleId) => {
      const snap = snapshotCatalog(qc);
      qc.setQueriesData<HomeResponse>({ queryKey: ["catalog", "home"] }, (old) =>
        old
          ? {
              ...old,
              rows: old.rows.map((r) => (r.kind === "CONTINUE_WATCHING" ? { ...r, items: r.items.filter((i) => i.id !== titleId) } : r)),
            }
          : old,
      );
      return { snap };
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      toast({ message: errorMessage(e), tone: "error" });
    },
  });
}

// ───────── profiles ─────────
export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ProfileInput }) =>
      id ? api<ProfileDto>(`/profiles/${id}`, { method: "PATCH", body: input }) : api<ProfileDto>("/profiles", { method: "POST", body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.profiles });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/profiles/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.profiles });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useSelectProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<ProfileDto>(`/profiles/${id}/select`, { method: "POST" }),
    onSuccess: (profile) => {
      qc.setQueryData<MeResponse>(qk.me, (old) => (old ? { ...old, profile } : old));
      // Everything personalised belongs to the previous profile
      qc.removeQueries({ queryKey: ["catalog"] });
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}
