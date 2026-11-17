"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, EyeOff, Info, RefreshCw, Trash2 } from "lucide-react";
import type { AdminTitle, AdminTitleInput } from "@app/shared";
import { ApiRequestError } from "@/lib/api/client";
import { formatDateTime } from "../lib/format";
import { adminApi, qk, useAdminMutation, useTitle } from "../lib/queries";
import { diffTitleInput, titleToForm } from "../lib/schemas";
import { errorMessage, useFeedback } from "../ui/feedback";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "../ui/primitives";
import { PublishBadge, TYPE_LABEL } from "../ui/status";
import { TitleForm } from "./title-form";
import { ImagesPanel, MediaPanel } from "./title-media";
import { SeasonsPanel } from "./title-seasons";
import { seriesPublishBlockReason } from "../lib/series";

export function publishBlockReason(t: AdminTitle): string | null {
  if (t.status === "PUBLISHED") return null;
  if (t.type === "SERIES") return seriesPublishBlockReason(t);
  if (!t.mainAsset) return "Chưa gắn video chính.";
  if (t.mainAsset.status !== "READY") return "Video chính chưa transcode xong (cần trạng thái Sẵn sàng).";
  return null;
}

export function TitleEditorSection({ id }: { id: string }) {
  const title = useTitle(id);
  const router = useRouter();
  const qc = useQueryClient();
  const { toast, toastError, confirm } = useFeedback();

  const setTitle = (t: AdminTitle) => {
    qc.setQueryData(qk.title(id), t);
    void qc.invalidateQueries({ queryKey: qk.titlesAll, refetchType: "none" });
    void qc.invalidateQueries({ queryKey: qk.stats });
  };

  const save = useAdminMutation((b: Partial<AdminTitleInput>) => adminApi.updateTitle(id, b), [], (t) => {
    setTitle(t);
    toast("success", "Đã lưu thay đổi");
  });
  const publish = useAdminMutation((on: boolean) => (on ? adminApi.publish(id) : adminApi.unpublish(id)), [], (t, on) => {
    setTitle(t);
    toast("success", on ? "Đã xuất bản" : "Đã gỡ xuất bản");
  });
  const sync = useAdminMutation(() => adminApi.syncTmdb(id), [], (t) => {
    setTitle(t);
    toast("success", "Đã đồng bộ từ TMDB", "Các trường đã ghi đè được giữ nguyên.");
  });
  const del = useAdminMutation(() => adminApi.deleteTitle(id), [qk.titlesAll, qk.stats], () => {
    toast("success", "Đã xoá phim");
    router.replace("/admin/titles");
  });

  if (title.isError) {
    const notFound = title.error instanceof ApiRequestError && title.error.statusCode === 404 && title.error.code === "NOT_FOUND";
    return (
      <>
        <BackLink />
        <Card>{notFound ? <EmptyState title="Không tìm thấy phim" description="Phim có thể đã bị xoá." /> : <ErrorState error={title.error} onRetry={() => title.refetch()} />}</Card>
      </>
    );
  }
  if (!title.data) {
    return (
      <>
        <BackLink />
        <Skeleton className="mb-4 h-8 w-72" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Skeleton className="h-[520px] rounded-lg" />
          <div className="space-y-4">
            <Skeleton className="h-64 rounded-lg" />
            <Skeleton className="h-48 rounded-lg" />
          </div>
        </div>
      </>
    );
  }

  const t = title.data;
  const blocked = publishBlockReason(t);

  const onDelete = async () => {
    const ok = await confirm({
      title: `Xoá “${t.name}”?`,
      description: "Phim, hình ảnh và liên kết media sẽ bị xoá. File nguồn trong bucket không bị ảnh hưởng. Không thể hoàn tác.",
      confirmLabel: "Xoá phim",
      danger: true,
    });
    if (ok) del.mutate(undefined, { onError: (e) => toastError(e, "Không xoá được") });
  };

  const onSync = async () => {
    const ok = await confirm({ title: "Đồng bộ lại từ TMDB?", description: "Các trường chưa ghi đè sẽ được cập nhật theo dữ liệu TMDB mới nhất.", confirmLabel: "Đồng bộ" });
    if (ok) sync.mutate(undefined, { onError: (e) => toastError(e, "Đồng bộ TMDB thất bại") });
  };

  const onSave = (input: AdminTitleInput) => {
    const patch = diffTitleInput(t, input);
    if (Object.keys(patch).length === 0) {
      toast("info", "Không có thay đổi nào");
      return;
    }
    save.mutate(patch, { onError: (e) => toastError(e, "Lưu thất bại") });
  };

  return (
    <>
      <BackLink />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">{t.name}</h1>
            <PublishBadge status={t.status} />
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            {TYPE_LABEL[t.type]} · {t.slug}
            {t.tmdbId ? ` · TMDB #${t.tmdbId}` : " · Nhập tay"} · cập nhật {formatDateTime(t.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {t.tmdbId ? (
            <Button size="sm" onClick={onSync} loading={sync.isPending}>
              <RefreshCw className="size-3.5" /> Đồng bộ TMDB
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={onDelete} loading={del.isPending}>
            <Trash2 className="size-3.5" /> Xoá
          </Button>
          {t.status === "PUBLISHED" ? (
            <Button size="sm" onClick={() => publish.mutate(false, { onError: (e) => toastError(e, "Không gỡ được") })} loading={publish.isPending}>
              <EyeOff className="size-3.5" /> Gỡ xuất bản
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={!!blocked}
              title={blocked ?? (t.type === "SERIES" ? "Chỉ các tập đã xuất bản mới hiển thị với người xem." : undefined)}
              data-testid="title-publish"
              onClick={() => publish.mutate(true, { onError: (e) => toastError(e, "Không xuất bản được") })}
              loading={publish.isPending}
            >
              <Eye className="size-3.5" /> Xuất bản
            </Button>
          )}
        </div>
      </div>

      {blocked ? (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900" role="status" data-testid="publish-blocked">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-medium">Chưa thể xuất bản:</span> {blocked}
          </span>
        </div>
      ) : t.type === "SERIES" && t.status !== "PUBLISHED" ? (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[13px] text-sky-900" role="status">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>
            Phim bộ được xuất bản khi có ít nhất 1 tập đã xuất bản (hiện có {t.publishedEpisodeCount}/{t.episodeCount} tập). Người xem chỉ thấy các tập đã xuất bản.
          </span>
        </div>
      ) : null}
      {publish.isError ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800" role="alert">
          {errorMessage(publish.error)}
        </div>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card title="Thông tin phim" actions={t.overriddenFields.length ? <span className="text-xs text-zinc-500">{t.overriddenFields.length} trường đã ghi đè</span> : null}>
          <div className="p-4">
            <TitleForm
              key={t.updatedAt}
              initial={titleToForm(t)}
              overridden={t.overriddenFields}
              fromTmdb={!!t.tmdbId}
              submitLabel="Lưu thay đổi"
              requireDirty
              submitting={save.isPending}
              onSubmit={onSave}
            />
          </div>
        </Card>
        <div className="space-y-4">
          <MediaPanel title={t} />
          <ImagesPanel title={t} />
        </div>
      </div>
      {t.type === "SERIES" ? (
        <div className="mt-4">
          <SeasonsPanel title={t} />
        </div>
      ) : null}
    </>
  );
}

function BackLink() {
  return (
    <Link href="/admin/titles" className="mb-3 inline-flex items-center gap-1 text-[13px] text-zinc-500 hover:text-zinc-900">
      <ArrowLeft className="size-3.5" /> Danh sách phim
    </Link>
  );
}
