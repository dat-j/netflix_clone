"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ImagePlus, Link2, RotateCcw, Upload } from "lucide-react";
import type { AdminTitle, AssetKind, ImageDto, ImageKind, MediaAssetDto, SourceFileDto } from "@app/shared";
import { api } from "@/lib/api/client";
import { basename, cn, formatDuration, heightLabel } from "../lib/format";
import { isActiveJob, qk } from "../lib/queries";
import { useFeedback } from "../ui/feedback";
import { Badge, Button, Card, ProgressBar } from "../ui/primitives";
import { AssetStatusBadge, JobStatusBadge } from "../ui/status";
import { SourceFilePickerDialog } from "./source-file-picker";

// ───────── Media ─────────
export function MediaPanel({ title }: { title: AdminTitle }) {
  const series = title.type === "SERIES";
  return (
    <Card title="Media">
      <div className="divide-y divide-zinc-100">
        {/* Phim bộ: video nằm ở từng tập (mục “Mùa & tập”); title chỉ cần preview */}
        {series ? (
          <p className="px-4 py-3 text-xs text-zinc-500">Video của phim bộ được gắn cho từng tập ở mục “Mùa &amp; tập” bên dưới.</p>
        ) : (
          <AssetRow title={title} kind="MAIN" asset={title.mainAsset} />
        )}
        <AssetRow title={title} kind="PREVIEW" asset={title.previewAsset} />
      </div>
    </Card>
  );
}

function AssetRow({ title, kind, asset }: { title: AdminTitle; kind: AssetKind; asset: MediaAssetDto | null }) {
  const qc = useQueryClient();
  const { toast, toastError } = useFeedback();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const job = asset?.latestJob ?? null;
  const label = kind === "MAIN" ? "Video chính" : "Preview / trailer";

  const attach = async (file: SourceFileDto) => {
    setBusy(true);
    try {
      await api<MediaAssetDto>(`/admin/titles/${title.id}/assets`, { method: "POST", body: { sourceFileId: file.id, kind } });
      toast("success", "Đã gắn file và đưa vào hàng đợi transcode", basename(file.key));
      setPicking(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.title(title.id) }),
        qc.invalidateQueries({ queryKey: qk.jobsAll }),
        qc.invalidateQueries({ queryKey: qk.sourceFilesAll }),
      ]);
    } catch (e) {
      toastError(e, "Không gắn được file");
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (!job) return;
    setBusy(true);
    try {
      await api(`/admin/jobs/${job.id}/retry`, { method: "POST" });
      toast("success", "Đã chạy lại tác vụ");
      await qc.invalidateQueries({ queryKey: qk.title(title.id) });
    } catch (e) {
      toastError(e, "Không chạy lại được");
    } finally {
      setBusy(false);
    }
  };

  const running = asset && (asset.status === "PROCESSING" || asset.status === "QUEUED" || isActiveJob(job?.status));

  return (
    <div className="px-4 py-3" data-testid={`asset-${kind}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold text-zinc-900">{label}</h3>
        {asset ? <AssetStatusBadge status={asset.status} /> : <Badge>Chưa có</Badge>}
        <div className="ml-auto flex gap-2">
          {job && (job.status === "FAILED" || asset?.status === "FAILED") ? (
            <Button size="sm" onClick={retry} loading={busy}>
              <RotateCcw className="size-3.5" /> Chạy lại
            </Button>
          ) : null}
          <Button size="sm" onClick={() => setPicking(true)} disabled={!!running}>
            <Link2 className="size-3.5" /> {asset ? "Đổi file nguồn" : "Gắn file nguồn"}
          </Button>
        </div>
      </div>
      {asset ? (
        <div className="mt-2 space-y-2 text-xs text-zinc-600">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="min-w-0 truncate" title={asset.sourceKey ?? undefined}>
              Nguồn: <span className="font-medium text-zinc-800">{asset.sourceKey ?? "—"}</span>
            </span>
            <span>Thời lượng: {formatDuration(asset.durationSec)}</span>
          </div>
          {asset.renditions.length ? (
            <div className="flex flex-wrap gap-1">
              {[...asset.renditions]
                .sort((a, b) => a.height - b.height)
                .map((r) => (
                  <Badge key={r.name} tone="neutral" title={`${r.width}×${r.height} · ${r.videoKbps} kbps`}>
                    {heightLabel(r.height)}
                  </Badge>
                ))}
            </div>
          ) : null}
          {job ? (
            <div className="rounded-md bg-zinc-50 px-3 py-2">
              <div className="mb-1.5 flex items-center gap-2">
                <JobStatusBadge status={job.status} />
                <span className="truncate">{job.stage ?? ""}</span>
                <span className="ml-auto text-zinc-400">lần {job.attempt}</span>
              </div>
              {job.status !== "FAILED" ? <ProgressBar value={job.status === "SUCCEEDED" ? 100 : job.progress} tone={job.status === "SUCCEEDED" ? "green" : "blue"} label={`Tiến độ ${label}`} /> : null}
              {job.error || asset.errorMessage ? (
                <p className="mt-1 flex items-start gap-1.5 text-red-700">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" /> <span className="break-words">{job.error ?? asset.errorMessage}</span>
                </p>
              ) : null}
            </div>
          ) : asset.errorMessage ? (
            <p className="text-red-700">{asset.errorMessage}</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">{kind === "MAIN" ? "Cần video chính ở trạng thái Sẵn sàng để xuất bản." : "Không bắt buộc — dùng cho hero và thẻ phim."}</p>
      )}
      {picking ? <SourceFilePickerDialog open={picking} onOpenChange={setPicking} title={`Gắn file nguồn — ${label}`} submitting={busy} onPick={attach} /> : null}
    </div>
  );
}

// ───────── Images ─────────
const IMAGE_KINDS: { kind: ImageKind; label: string; aspect: string }[] = [
  { kind: "POSTER", label: "Poster", aspect: "aspect-[2/3]" },
  { kind: "BACKDROP", label: "Backdrop", aspect: "aspect-video" },
  { kind: "LOGO", label: "Logo", aspect: "aspect-[3/1]" },
];

export function ImagesPanel({ title }: { title: AdminTitle }) {
  return (
    <Card title="Hình ảnh">
      <div className="grid grid-cols-[1fr_2fr] gap-3 p-4 sm:grid-cols-[120px_1fr]">
        {IMAGE_KINDS.map((k) => (
          <ImageSlot key={k.kind} title={title} {...k} className={k.kind === "POSTER" ? "row-span-2" : ""} />
        ))}
      </div>
    </Card>
  );
}

function ImageSlot({ title, kind, label, aspect, className }: { title: AdminTitle; kind: ImageKind; label: string; aspect: string; className?: string }) {
  const qc = useQueryClient();
  const { toast, toastError } = useFeedback();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const img = title.images.find((i) => i.kind === kind && i.isPrimary) ?? title.images.find((i) => i.kind === kind);

  const upload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast("error", "File không phải ảnh");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast("error", "Ảnh quá lớn (tối đa 15 MB)");
      return;
    }
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", file);
    setBusy(true);
    try {
      const created = await api<ImageDto>(`/admin/titles/${title.id}/images`, { method: "POST", body: fd });
      qc.setQueryData<AdminTitle>(qk.title(title.id), (t) =>
        t ? { ...t, images: [...t.images.map((i) => (i.kind === kind && created.isPrimary ? { ...i, isPrimary: false } : i)), created] } : t,
      );
      toast("success", `Đã tải ${label.toLowerCase()} lên`);
      void qc.invalidateQueries({ queryKey: qk.title(title.id) });
    } catch (e) {
      toastError(e, "Tải ảnh thất bại");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-zinc-600">{label}</span>
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
        className={cn(
          "group relative w-full overflow-hidden rounded-md border border-dashed border-zinc-300 bg-zinc-50 hover:border-indigo-400",
          kind === "LOGO" && "bg-[repeating-conic-gradient(#e4e4e7_0_25%,#fafafa_0_50%)] bg-[length:14px_14px]",
          aspect,
        )}
        aria-label={`Tải ${label} lên`}
      >
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img.url} alt={label} className={cn("h-full w-full", kind === "LOGO" ? "object-contain p-2" : "object-cover")} />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-zinc-400">
            <ImagePlus className="size-5" />
            <span className="text-[11px]">Chưa có</span>
          </span>
        )}
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center gap-1.5 bg-black/55 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
            busy && "opacity-100",
          )}
        >
          <Upload className="size-3.5" /> {busy ? "Đang tải…" : "Tải ảnh lên"}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        className="hidden"
        data-testid={`upload-${kind}`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
    </div>
  );
}
