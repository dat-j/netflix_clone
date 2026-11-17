"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  CopyPlus,
  DownloadCloud,
  Eye,
  EyeOff,
  ImagePlus,
  Layers,
  Link2,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import type { AdminEpisode, AdminSeason, AdminSeasonInput, AdminTitle, SourceFileDto } from "@app/shared";
import { api } from "@/lib/api/client";
import { basename, cn, formatDate, formatDuration, formatMmSs } from "../lib/format";
import { adminApi, qk, useSeasons } from "../lib/queries";
import {
  diffEpisodeInput,
  episodePublishBlockReason,
  episodeToForm,
  isAssetBusy,
  nextEpisodeNumber,
  nextSeasonNumber,
  parseEpisodeForm,
  readyEpisodeCount,
  type EpisodeFormErrors,
  type EpisodeFormValues,
} from "../lib/series";
import { Dialog } from "../ui/dialog";
import { useFeedback } from "../ui/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, ProgressBar, Skeleton, Textarea } from "../ui/primitives";
import { AssetStatusBadge, JobStatusBadge, PublishBadge } from "../ui/status";
import { SourceFilePickerDialog } from "./source-file-picker";

/** Mutations shared by the panel: keep the seasons cache + title counts fresh. */
function useSeriesCache(titleId: string) {
  const qc = useQueryClient();
  return {
    setSeasons: (updater: (s: AdminSeason[]) => AdminSeason[]) =>
      qc.setQueryData<AdminSeason[]>(qk.seasons(titleId), (old) => (old ? updater(old) : old)),
    patchEpisode: (ep: AdminEpisode) =>
      qc.setQueryData<AdminSeason[]>(qk.seasons(titleId), (old) =>
        old?.map((s) => (s.id === ep.seasonId ? { ...s, episodes: s.episodes.map((e) => (e.id === ep.id ? ep : e)) } : s)),
      ),
    refresh: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.seasons(titleId) }),
        qc.invalidateQueries({ queryKey: qk.title(titleId) }),
        qc.invalidateQueries({ queryKey: qk.titlesAll, refetchType: "none" }),
      ]);
    },
    refreshJobs: () => Promise.all([qc.invalidateQueries({ queryKey: qk.jobsAll }), qc.invalidateQueries({ queryKey: qk.sourceFilesAll })]),
  };
}

export function SeasonsPanel({ title }: { title: AdminTitle }) {
  const seasons = useSeasons(title.id);
  const cache = useSeriesCache(title.id);
  const { toast, toastError, confirm } = useFeedback();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [seasonDialog, setSeasonDialog] = useState<{ mode: "create" } | { mode: "edit"; season: AdminSeason } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const list = seasons.data ? [...seasons.data].sort((a, b) => a.seasonNumber - b.seasonNumber) : [];
  const active = list.find((s) => s.id === activeId) ?? list[0] ?? null;

  const sync = async () => {
    const ok = await confirm({
      title: "Đồng bộ mùa/tập từ TMDB?",
      description: "Tạo mùa/tập còn thiếu và cập nhật tên, mô tả, ngày phát, ảnh still. Các trường đã sửa tay được giữ nguyên; video đã gắn không bị ảnh hưởng.",
      confirmLabel: "Đồng bộ",
    });
    if (!ok) return;
    setSyncing(true);
    try {
      const res = await adminApi.syncTmdbSeasons(title.id);
      cache.setSeasons(() => res);
      toast("success", "Đã đồng bộ từ TMDB", `${res.length} mùa · ${res.reduce((n, s) => n + s.episodes.length, 0)} tập`);
      await cache.refresh();
    } catch (e) {
      toastError(e, "Đồng bộ TMDB thất bại");
    } finally {
      setSyncing(false);
    }
  };

  const actions = (
    <>
      {title.tmdbId ? (
        <Button size="sm" onClick={sync} loading={syncing} data-testid="sync-tmdb-seasons">
          {!syncing && <DownloadCloud className="size-3.5" />} Đồng bộ mùa/tập từ TMDB
        </Button>
      ) : null}
      <Button size="sm" variant="primary" onClick={() => setSeasonDialog({ mode: "create" })} data-testid="add-season">
        <Plus className="size-3.5" /> Thêm mùa
      </Button>
    </>
  );

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <Layers className="size-4 text-zinc-500" /> Mùa &amp; tập
          {seasons.data ? (
            <span className="text-xs font-normal text-zinc-500">
              {list.length} mùa · {list.reduce((n, s) => n + s.episodes.length, 0)} tập · {title.publishedEpisodeCount} đã xuất bản
            </span>
          ) : null}
        </span>
      }
      actions={actions}
      className="overflow-hidden"
    >
      <div data-testid="seasons-panel">
        {seasons.isError ? (
          <ErrorState error={seasons.error} onRetry={() => seasons.refetch()} compact />
        ) : !seasons.data ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            title="Chưa có mùa nào"
            description={title.tmdbId ? "Đồng bộ từ TMDB để tạo sẵn mùa, tập và ảnh still, hoặc thêm mùa thủ công." : "Thêm mùa đầu tiên rồi tạo tập cho mùa đó."}
            icon={<Layers className="size-8" aria-hidden />}
            action={<div className="flex flex-wrap justify-center gap-2">{actions}</div>}
          />
        ) : (
          <>
            <div role="tablist" aria-label="Các mùa" className="flex gap-1 overflow-x-auto border-b border-zinc-200 px-2 pt-2 [scrollbar-width:thin]">
              {list.map((s) => {
                const on = s.id === active?.id;
                const published = s.episodes.filter((e) => e.status === "PUBLISHED").length;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    data-testid={`season-tab-${s.seasonNumber}`}
                    onClick={() => setActiveId(s.id)}
                    className={cn(
                      "-mb-px flex shrink-0 items-center gap-2 rounded-t-md border border-b-0 px-3 py-2 text-[13px] font-medium whitespace-nowrap transition-colors",
                      on ? "border-zinc-200 bg-white text-zinc-900" : "border-transparent text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800",
                    )}
                  >
                    {s.name?.trim() || `Mùa ${s.seasonNumber}`}
                    <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", on ? "bg-zinc-100 text-zinc-600" : "bg-zinc-100/70 text-zinc-500")}>
                      {published}/{s.episodes.length}
                    </span>
                  </button>
                );
              })}
            </div>
            {active ? (
              <SeasonView
                key={active.id}
                title={title}
                season={active}
                onEdit={() => setSeasonDialog({ mode: "edit", season: active })}
                onDeleted={() => setActiveId(null)}
              />
            ) : null}
          </>
        )}
      </div>
      {seasonDialog ? (
        <SeasonDialog
          titleId={title.id}
          state={seasonDialog}
          defaultNumber={nextSeasonNumber(list)}
          onClose={() => setSeasonDialog(null)}
          onSaved={(s) => {
            setActiveId(s.id);
            setSeasonDialog(null);
          }}
        />
      ) : null}
    </Card>
  );
}

// ───────── season ─────────

function SeasonView({ title, season, onEdit, onDeleted }: { title: AdminTitle; season: AdminSeason; onEdit: () => void; onDeleted: () => void }) {
  const cache = useSeriesCache(title.id);
  const { toast, toastError, confirm } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const ready = readyEpisodeCount(season);
  const episodes = [...season.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
  const published = episodes.filter((e) => e.status === "PUBLISHED").length;

  const run = async (key: string, fn: () => Promise<void>, errTitle: string) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toastError(e, errTitle);
    } finally {
      setBusy(null);
    }
  };

  const addEpisode = () =>
    run(
      "add",
      async () => {
        const ep = await adminApi.createEpisode(season.id, { episodeNumber: nextEpisodeNumber(season) });
        cache.setSeasons((all) => all.map((s) => (s.id === season.id ? { ...s, episodes: [...s.episodes, ep] } : s)));
        setEditing(ep.id);
        toast("success", `Đã thêm tập ${ep.episodeNumber}`);
        await cache.refresh();
      },
      "Không thêm được tập",
    );

  const publishReady = () =>
    run(
      "publish-ready",
      async () => {
        const eps = await adminApi.publishReady(season.id);
        toast("success", eps.length ? `Đã xuất bản ${eps.length} tập` : "Không có tập nào sẵn sàng");
        await cache.refresh();
      },
      "Không xuất bản được",
    );

  const remove = async () => {
    const ok = await confirm({
      title: `Xoá ${season.name?.trim() || `Mùa ${season.seasonNumber}`}?`,
      description:
        published > 0
          ? `Mùa này còn ${published} tập đã xuất bản — hãy gỡ xuất bản các tập trước khi xoá.`
          : `${episodes.length} tập và liên kết video của chúng sẽ bị xoá. File nguồn trong bucket không bị ảnh hưởng.`,
      confirmLabel: "Xoá mùa",
      danger: true,
    });
    if (!ok) return;
    await run(
      "delete",
      async () => {
        await adminApi.deleteSeason(season.id);
        cache.setSeasons((all) => all.filter((s) => s.id !== season.id));
        onDeleted();
        toast("success", "Đã xoá mùa");
        await cache.refresh();
      },
      "Không xoá được mùa",
    );
  };

  return (
    <div role="tabpanel" aria-label={season.name ?? `Mùa ${season.seasonNumber}`} data-testid="season-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900">
            {season.name?.trim() || `Mùa ${season.seasonNumber}`}
            <span className="ml-2 font-normal text-zinc-500">
              Mùa số {season.seasonNumber}
              {season.airDate ? ` · ${formatDate(season.airDate)}` : ""}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {episodes.length} tập · {published} đã xuất bản{ready ? ` · ${ready} sẵn sàng xuất bản` : ""}
          </p>
          {season.overview ? <p className="mt-1 line-clamp-2 max-w-2xl text-xs text-zinc-600">{season.overview}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={addEpisode} loading={busy === "add"} data-testid="add-episode">
            {busy !== "add" && <Plus className="size-3.5" />} Thêm tập
          </Button>
          <Button size="sm" onClick={() => setBulkOpen(true)} data-testid="bulk-episodes">
            <CopyPlus className="size-3.5" /> Thêm nhanh nhiều tập
          </Button>
          <Button
            size="sm"
            variant={ready ? "primary" : "outline"}
            onClick={publishReady}
            disabled={!ready}
            loading={busy === "publish-ready"}
            title={ready ? undefined : "Chưa có tập nào có video Sẵn sàng mà chưa xuất bản"}
            data-testid="publish-ready"
          >
            {busy !== "publish-ready" && <Send className="size-3.5" />} Xuất bản tất cả tập đã sẵn sàng{ready ? ` (${ready})` : ""}
          </Button>
          <span className="flex items-center gap-1">
            <Button size="icon" variant="ghost" aria-label="Sửa thông tin mùa" title="Sửa thông tin mùa" onClick={onEdit} data-testid="edit-season">
              <Pencil className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Xoá mùa"
              title="Xoá mùa"
              className="text-red-600 hover:bg-red-50"
              onClick={remove}
              loading={busy === "delete"}
            >
              {busy !== "delete" && <Trash2 className="size-4" />}
            </Button>
          </span>
        </div>
      </div>

      {episodes.length === 0 ? (
        <EmptyState
          title="Mùa này chưa có tập"
          description="Thêm từng tập, hoặc tạo nhanh nhiều tập trống rồi gắn video sau."
          action={
            <div className="flex gap-2">
              <Button size="sm" onClick={addEpisode} loading={busy === "add"}>
                <Plus className="size-3.5" /> Thêm tập
              </Button>
              <Button size="sm" onClick={() => setBulkOpen(true)}>
                <CopyPlus className="size-3.5" /> Thêm nhanh nhiều tập
              </Button>
            </div>
          }
        />
      ) : (
        <ul className="divide-y divide-zinc-100" data-testid="episode-rows">
          {episodes.map((ep) => (
            <EpisodeRow
              key={ep.id}
              titleId={title.id}
              episode={ep}
              editing={editing === ep.id}
              onToggleEdit={() => setEditing((cur) => (cur === ep.id ? null : ep.id))}
            />
          ))}
        </ul>
      )}

      {bulkOpen ? <BulkDialog season={season} titleId={title.id} onClose={() => setBulkOpen(false)} /> : null}
    </div>
  );
}

function SeasonDialog({
  titleId,
  state,
  defaultNumber,
  onClose,
  onSaved,
}: {
  titleId: string;
  state: { mode: "create" } | { mode: "edit"; season: AdminSeason };
  defaultNumber: number;
  onClose: () => void;
  onSaved: (s: AdminSeason) => void;
}) {
  const cache = useSeriesCache(titleId);
  const { toast, toastError } = useFeedback();
  const editing = state.mode === "edit" ? state.season : null;
  const [num, setNum] = useState(String(editing?.seasonNumber ?? defaultNumber));
  const [name, setName] = useState(editing?.name ?? "");
  const [overview, setOverview] = useState(editing?.overview ?? "");
  const [airDate, setAirDate] = useState(editing?.airDate?.slice(0, 10) ?? "");
  const [saving, setSaving] = useState(false);
  const numError = /^\d+$/.test(num.trim()) ? null : "Số mùa là số nguyên ≥ 0";

  const submit = async () => {
    if (numError) return;
    const body: AdminSeasonInput = { seasonNumber: Number(num), name: name.trim() || null, overview: overview.trim() || null, airDate: airDate || null };
    setSaving(true);
    try {
      const saved = editing ? await adminApi.updateSeason(editing.id, body) : await adminApi.createSeason(titleId, body);
      cache.setSeasons((all) => (editing ? all.map((s) => (s.id === saved.id ? { ...saved, episodes: saved.episodes ?? s.episodes } : s)) : [...all, saved]));
      toast("success", editing ? "Đã lưu mùa" : `Đã thêm ${saved.name?.trim() || `Mùa ${saved.seasonNumber}`}`);
      onSaved(saved);
      await cache.refresh();
    } catch (e) {
      toastError(e, editing ? "Không lưu được mùa" : "Không thêm được mùa");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={editing ? "Sửa thông tin mùa" : "Thêm mùa"}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={submit} loading={saving} disabled={!!numError} data-testid="season-save">
            {editing ? "Lưu" : "Thêm mùa"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-[120px_1fr]"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Số mùa" htmlFor="season-number" error={numError ?? undefined}>
          <Input id="season-number" inputMode="numeric" value={num} onChange={(e) => setNum(e.target.value)} aria-invalid={!!numError} />
        </Field>
        <Field label="Tên mùa" htmlFor="season-name" hint="Để trống → “Mùa N”">
          <Input id="season-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`Mùa ${num || defaultNumber}`} />
        </Field>
        <Field label="Ngày phát hành" htmlFor="season-air" className="sm:col-span-2 sm:max-w-56">
          <Input id="season-air" type="date" value={airDate} onChange={(e) => setAirDate(e.target.value)} />
        </Field>
        <Field label="Mô tả" htmlFor="season-overview" className="sm:col-span-2">
          <Textarea id="season-overview" value={overview} onChange={(e) => setOverview(e.target.value)} rows={3} />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}

function BulkDialog({ season, titleId, onClose }: { season: AdminSeason; titleId: string; onClose: () => void }) {
  const cache = useSeriesCache(titleId);
  const { toast, toastError } = useFeedback();
  const [count, setCount] = useState("10");
  const [startAt, setStartAt] = useState(String(nextEpisodeNumber(season)));
  const [saving, setSaving] = useState(false);
  const n = Number(count);
  const start = Number(startAt);
  const countError = /^\d+$/.test(count) && n >= 1 && n <= 100 ? null : "Từ 1 đến 100 tập";
  const startError = /^\d+$/.test(startAt) && start >= 1 ? null : "Số tập ≥ 1";
  const clash = !countError && !startError ? season.episodes.filter((e) => e.episodeNumber >= start && e.episodeNumber < start + n).map((e) => e.episodeNumber) : [];

  const submit = async () => {
    if (countError || startError) return;
    setSaving(true);
    try {
      const eps = await adminApi.bulkEpisodes(season.id, n, start);
      cache.setSeasons((all) => all.map((s) => (s.id === season.id ? { ...s, episodes: [...s.episodes, ...eps] } : s)));
      toast("success", `Đã tạo ${eps.length} tập trống`);
      onClose();
      await cache.refresh();
    } catch (e) {
      toastError(e, "Không tạo được tập");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title="Thêm nhanh nhiều tập"
      description={`Tạo các tập trống cho ${season.name?.trim() || `Mùa ${season.seasonNumber}`}; điền thông tin và gắn video sau.`}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={submit} loading={saving} disabled={!!countError || !!startError} data-testid="bulk-save">
            Tạo {countError ? "" : n} tập
          </Button>
        </>
      }
    >
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Số lượng" htmlFor="bulk-count" error={countError ?? undefined}>
          <Input id="bulk-count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} autoFocus />
        </Field>
        <Field label="Bắt đầu từ tập" htmlFor="bulk-start" error={startError ?? undefined}>
          <Input id="bulk-start" inputMode="numeric" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </Field>
        {clash.length ? (
          <p className="col-span-2 flex items-start gap-1.5 text-xs text-amber-700">
            <AlertTriangle className="mt-px size-3.5 shrink-0" /> Đã có tập {clash.slice(0, 6).join(", ")}
            {clash.length > 6 ? "…" : ""} — các số trùng có thể bị từ chối.
          </p>
        ) : !countError && !startError ? (
          <p className="col-span-2 text-xs text-zinc-500">
            Sẽ tạo tập {start} → {start + n - 1}.
          </p>
        ) : null}
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}

// ───────── episode ─────────

function EpisodeRow({ titleId, episode: ep, editing, onToggleEdit }: { titleId: string; episode: AdminEpisode; editing: boolean; onToggleEdit: () => void }) {
  const cache = useSeriesCache(titleId);
  const { toast, toastError, confirm } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const asset = ep.mainAsset;
  const job = asset?.latestJob ?? null;
  const running = isAssetBusy(asset);
  const blocked = episodePublishBlockReason(ep);
  const published = ep.status === "PUBLISHED";

  const run = async (key: string, fn: () => Promise<void>, errTitle: string) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toastError(e, errTitle);
    } finally {
      setBusy(null);
    }
  };

  const attach = (file: SourceFileDto) =>
    run(
      "attach",
      async () => {
        await adminApi.attachEpisodeSource(ep.id, file.id);
        toast("success", `Đã gắn video cho tập ${ep.episodeNumber}`, `${basename(file.key)} — đang đưa vào hàng đợi transcode`);
        setPicking(false);
        await Promise.all([cache.refresh(), cache.refreshJobs()]);
      },
      "Không gắn được file",
    );

  const togglePublish = () =>
    run(
      "publish",
      async () => {
        const updated = published ? await adminApi.unpublishEpisode(ep.id) : await adminApi.publishEpisode(ep.id);
        cache.patchEpisode(updated);
        toast("success", published ? `Đã gỡ xuất bản tập ${ep.episodeNumber}` : `Đã xuất bản tập ${ep.episodeNumber}`);
        await cache.refresh();
      },
      published ? "Không gỡ xuất bản được" : "Không xuất bản được",
    );

  const retry = () =>
    run(
      "retry",
      async () => {
        if (!job) return;
        await api(`/admin/jobs/${job.id}/retry`, { method: "POST" });
        toast("success", "Đã chạy lại tác vụ");
        await cache.refresh();
      },
      "Không chạy lại được",
    );

  const remove = async () => {
    if (published) {
      toast("info", "Gỡ xuất bản tập trước khi xoá");
      return;
    }
    const ok = await confirm({
      title: `Xoá tập ${ep.episodeNumber}${ep.name ? ` “${ep.name}”` : ""}?`,
      description: "Thông tin tập và liên kết video sẽ bị xoá. File nguồn trong bucket không bị ảnh hưởng.",
      confirmLabel: "Xoá tập",
      danger: true,
    });
    if (!ok) return;
    await run(
      "delete",
      async () => {
        await adminApi.deleteEpisode(ep.id);
        cache.setSeasons((all) => all.map((s) => (s.id === ep.seasonId ? { ...s, episodes: s.episodes.filter((e) => e.id !== ep.id) } : s)));
        toast("success", "Đã xoá tập");
        await cache.refresh();
      },
      "Không xoá được tập",
    );
  };

  const markers = [
    ep.introEndSec != null ? `Intro ${formatMmSs(ep.introStartSec ?? 0)}–${formatMmSs(ep.introEndSec)}` : null,
    ep.creditsStartSec != null ? `Credits ${formatMmSs(ep.creditsStartSec)}` : null,
  ].filter(Boolean);

  return (
    <li data-testid="episode-row" data-episode-number={ep.episodeNumber} className={cn(editing && "bg-zinc-50/70")}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 lg:grid-cols-[auto_minmax(0,1fr)_minmax(180px,240px)_auto] lg:items-center">
        <StillSlot episode={ep} titleId={titleId} />
        <div className="min-w-0">
          <button type="button" onClick={onToggleEdit} className="group/name flex max-w-full items-baseline gap-2 text-left" aria-expanded={editing}>
            <span className="shrink-0 text-xs font-semibold text-zinc-500 tabular-nums">E{ep.episodeNumber}</span>
            <span className={cn("truncate text-[13px] font-medium group-hover/name:text-indigo-600", ep.name ? "text-zinc-900" : "text-zinc-400 italic")}>
              {ep.name || "Chưa đặt tên"}
            </span>
          </button>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-zinc-500">
            <span>{ep.runtimeMinutes ? `${ep.runtimeMinutes} phút` : asset?.durationSec ? formatDuration(asset.durationSec) : "— phút"}</span>
            {ep.airDate ? <span>· {formatDate(ep.airDate)}</span> : null}
            {markers.map((m) => (
              <span key={m} className="text-zinc-400">
                · {m}
              </span>
            ))}
          </p>
          {ep.overview ? <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500 max-lg:hidden">{ep.overview}</p> : null}
        </div>

        <div className="col-span-2 min-w-0 space-y-1 lg:col-span-1" data-testid="episode-media">
          <div className="flex flex-wrap items-center gap-1.5">
            <PublishBadge status={ep.status} />
            {asset ? <AssetStatusBadge status={asset.status} /> : <Badge>Chưa có video</Badge>}
            {job && running ? <JobStatusBadge status={job.status} /> : null}
          </div>
          {asset ? (
            <p className="truncate text-[11px] text-zinc-500" title={asset.sourceKey ?? undefined}>
              {basename(asset.sourceKey)}
            </p>
          ) : null}
          {running && job ? <ProgressBar value={job.progress} label={`Tiến độ transcode tập ${ep.episodeNumber}`} className="max-w-60" /> : null}
          {job?.status === "FAILED" || asset?.status === "FAILED" ? (
            <p className="flex items-start gap-1 text-[11px] text-red-700">
              <AlertTriangle className="mt-px size-3 shrink-0" /> <span className="line-clamp-2 break-words">{job?.error ?? asset?.errorMessage ?? "Transcode lỗi"}</span>
            </p>
          ) : null}
        </div>

        <div className="col-span-2 flex flex-wrap items-center gap-1.5 lg:col-span-1 lg:justify-end">
          {job && (job.status === "FAILED" || asset?.status === "FAILED") ? (
            <Button size="sm" onClick={retry} loading={busy === "retry"}>
              {busy !== "retry" && <RotateCcw className="size-3.5" />} Chạy lại
            </Button>
          ) : null}
          <Button size="sm" onClick={() => setPicking(true)} disabled={running} data-testid="episode-attach">
            <Link2 className="size-3.5" /> {asset ? "Đổi video" : "Gắn video"}
          </Button>
          {published ? (
            <Button size="sm" onClick={togglePublish} loading={busy === "publish"} data-testid="episode-unpublish">
              {busy !== "publish" && <EyeOff className="size-3.5" />} Gỡ
            </Button>
          ) : (
            <Button
              size="sm"
              variant={blocked ? "outline" : "primary"}
              onClick={togglePublish}
              disabled={!!blocked}
              title={blocked ?? undefined}
              loading={busy === "publish"}
              data-testid="episode-publish"
            >
              {busy !== "publish" && <Eye className="size-3.5" />} Xuất bản
            </Button>
          )}
          <Button size="icon" variant="ghost" aria-label={editing ? "Đóng chỉnh sửa" : "Sửa tập"} title="Sửa tập" onClick={onToggleEdit} data-testid="episode-edit">
            <ChevronDown className={cn("size-4 transition-transform", editing && "rotate-180")} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Xoá tập"
            title={published ? "Gỡ xuất bản trước khi xoá" : "Xoá tập"}
            className="text-red-600 hover:bg-red-50 disabled:text-zinc-300"
            onClick={remove}
            loading={busy === "delete"}
          >
            {busy !== "delete" && <Trash2 className="size-4" />}
          </Button>
        </div>
      </div>
      {editing ? <EpisodeEditor key={ep.id + ep.episodeNumber} titleId={titleId} episode={ep} onDone={onToggleEdit} /> : null}
      {picking ? (
        <SourceFilePickerDialog
          open={picking}
          onOpenChange={setPicking}
          title={`Gắn video — Tập ${ep.episodeNumber}${ep.name ? ` · ${ep.name}` : ""}`}
          submitting={busy === "attach"}
          onPick={(f) => void attach(f)}
        />
      ) : null}
    </li>
  );
}

function StillSlot({ episode: ep, titleId }: { episode: AdminEpisode; titleId: string }) {
  const cache = useSeriesCache(titleId);
  const { toast, toastError } = useFeedback();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  useEffect(() => () => {
    if (localUrl) URL.revokeObjectURL(localUrl);
  }, [localUrl]);

  const upload = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast("error", "File không phải ảnh");
    if (file.size > 15 * 1024 * 1024) return toast("error", "Ảnh quá lớn (tối đa 15 MB)");
    setBusy(true);
    setLocalUrl(URL.createObjectURL(file));
    try {
      const img = await adminApi.uploadEpisodeStill(ep.id, file);
      cache.patchEpisode({ ...ep, still: img });
      toast("success", `Đã cập nhật ảnh still tập ${ep.episodeNumber}`);
      await cache.refresh();
    } catch (e) {
      setLocalUrl(null);
      toastError(e, "Tải ảnh thất bại");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const url = localUrl ?? ep.still?.url ?? null;

  return (
    <div className="row-span-1 w-24 sm:w-28 lg:row-span-1">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) void upload(f);
        }}
        className="group relative block aspect-video w-full overflow-hidden rounded border border-dashed border-zinc-300 bg-zinc-50 hover:border-indigo-400"
        aria-label={`Tải ảnh still cho tập ${ep.episodeNumber}`}
        title="Ảnh still (16:9)"
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center text-zinc-400">
            <ImagePlus className="size-4" />
          </span>
        )}
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center gap-1 bg-black/55 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
            busy && "opacity-100",
          )}
        >
          <Upload className="size-3" /> {busy ? "Đang tải…" : "Ảnh still"}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        className="hidden"
        data-testid={`still-upload-${ep.episodeNumber}`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
    </div>
  );
}

function EpisodeEditor({ titleId, episode: ep, onDone }: { titleId: string; episode: AdminEpisode; onDone: () => void }) {
  const cache = useSeriesCache(titleId);
  const { toast, toastError } = useFeedback();
  const [values, setValues] = useState<EpisodeFormValues>(() => episodeToForm(ep));
  const [errors, setErrors] = useState<EpisodeFormErrors>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof EpisodeFormValues) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const id = (k: string) => `ep-${ep.id}-${k}`;

  const submit = async () => {
    const parsed = parseEpisodeForm(values, ep.mainAsset?.durationSec);
    if ("errors" in parsed) {
      setErrors(parsed.errors);
      return;
    }
    const patch = diffEpisodeInput(ep, parsed.input);
    if (!Object.keys(patch).length) {
      toast("info", "Không có thay đổi nào");
      onDone();
      return;
    }
    setSaving(true);
    try {
      const updated = await adminApi.updateEpisode(ep.id, patch);
      cache.patchEpisode(updated);
      toast("success", `Đã lưu tập ${updated.episodeNumber}`);
      onDone();
      await cache.refresh();
    } catch (e) {
      toastError(e, "Không lưu được tập");
    } finally {
      setSaving(false);
    }
  };

  const markerHint = ep.mainAsset?.durationSec ? `Video dài ${formatDuration(ep.mainAsset.durationSec)}` : "Dạng m:ss — để trống nếu không có";

  return (
    <form
      className="border-t border-dashed border-zinc-200 px-4 pt-3 pb-4"
      data-testid="episode-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[90px_minmax(0,1fr)_140px_170px]">
        <Field label="Tập số" htmlFor={id("num")} error={errors.episodeNumber}>
          <Input id={id("num")} inputMode="numeric" value={values.episodeNumber} onChange={set("episodeNumber")} aria-invalid={!!errors.episodeNumber} />
        </Field>
        <Field label="Tên tập" htmlFor={id("name")} error={errors.name} className="max-sm:col-span-2 max-sm:row-start-1">
          <Input id={id("name")} value={values.name} onChange={set("name")} placeholder={`Tập ${values.episodeNumber || ep.episodeNumber}`} />
        </Field>
        <Field label="Thời lượng (phút)" htmlFor={id("runtime")} error={errors.runtimeMinutes}>
          <Input id={id("runtime")} inputMode="numeric" value={values.runtimeMinutes} onChange={set("runtimeMinutes")} aria-invalid={!!errors.runtimeMinutes} />
        </Field>
        <Field label="Ngày phát" htmlFor={id("air")} error={errors.airDate}>
          <Input id={id("air")} type="date" value={values.airDate} onChange={set("airDate")} />
        </Field>
        <Field label="Tóm tắt" htmlFor={id("overview")} className="col-span-2 sm:col-span-4">
          <Textarea id={id("overview")} rows={2} value={values.overview} onChange={set("overview")} className="min-h-16" />
        </Field>
      </div>
      <fieldset className="mt-3 rounded-md border border-zinc-200 bg-white px-3 pt-2 pb-3">
        <legend className="px-1 text-xs font-medium text-zinc-600">Mốc thời gian (hiện “Bỏ qua phần mở đầu” và “Tập tiếp theo”)</legend>
        <div className="grid max-w-xl grid-cols-3 gap-3">
          <MarkerInput id={id("intro-start")} label="Intro bắt đầu" value={values.introStart} onChange={set("introStart")} error={errors.introStart} />
          <MarkerInput id={id("intro-end")} label="Intro kết thúc" value={values.introEnd} onChange={set("introEnd")} error={errors.introEnd} />
          <MarkerInput id={id("credits")} label="Credits bắt đầu" value={values.creditsStart} onChange={set("creditsStart")} error={errors.creditsStart} />
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">{markerHint}. Không có mốc credits → thẻ “Tập tiếp theo” hiện ở 20 giây cuối.</p>
      </fieldset>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" onClick={onDone}>
          Huỷ
        </Button>
        <Button size="sm" variant="primary" type="submit" loading={saving} data-testid="episode-save">
          Lưu tập
        </Button>
      </div>
    </form>
  );
}

function MarkerInput({ id, label, value, onChange, error }: { id: string; label: ReactNode; value: string; onChange: (e: { target: { value: string } }) => void; error?: string }) {
  return (
    <Field label={label} htmlFor={id} error={error}>
      <Input id={id} value={value} onChange={onChange} placeholder="m:ss" inputMode="numeric" className="font-mono tabular-nums" aria-invalid={!!error} />
    </Field>
  );
}
