"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { SourceFileDto } from "@app/shared";
import { basename, cn, formatBytes, formatDuration, formatResolution } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import { useSourceFiles } from "../lib/queries";
import { Dialog } from "../ui/dialog";
import { Badge, Button, EmptyState, ErrorState, Input, Pagination, Skeleton } from "../ui/primitives";
import { ProbeBadge } from "../ui/status";

/** Hộp thoại chọn file nguồn từ bucket để gắn vào phim. */
export function SourceFilePickerDialog({
  open,
  onOpenChange,
  title,
  submitting,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  submitting?: boolean;
  onPick: (file: SourceFileDto) => void;
}) {
  const [q, setQ] = useState("");
  const [unlinked, setUnlinked] = useState(true);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<SourceFileDto | null>(null);
  const dq = useDebounced(q);
  const files = useSourceFiles({ q: dq, prefix: "", status: "", unlinked, page }, open);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={title}
      description="Chọn một file video đã probe thành công. Hệ thống sẽ tạo asset và đưa vào hàng đợi transcode."
      footer={
        <>
          <span className="mr-auto self-center truncate text-xs text-zinc-500">{selected ? `Đã chọn: ${selected.key}` : "Chưa chọn file"}</span>
          <Button onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button variant="primary" disabled={!selected} loading={submitting} onClick={() => selected && onPick(selected)}>
            Gắn & transcode
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400" />
          <Input
            autoFocus
            placeholder="Tìm theo đường dẫn file…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="pl-8"
            aria-label="Tìm file nguồn"
          />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-zinc-700">
          <input
            type="checkbox"
            checked={unlinked}
            onChange={(e) => {
              setUnlinked(e.target.checked);
              setPage(1);
            }}
            className="size-4 accent-indigo-600"
          />
          Chỉ file chưa gắn
        </label>
      </div>
      <div className="overflow-hidden rounded-md border border-zinc-200">
        {files.isError ? (
          <ErrorState error={files.error} onRetry={() => files.refetch()} compact />
        ) : !files.data ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : files.data.items.length === 0 ? (
          <EmptyState title="Không có file phù hợp" description="Thử bỏ lọc hoặc quét lại bucket ở mục Kho file nguồn." />
        ) : (
          <ul className="max-h-[50dvh] divide-y divide-zinc-100 overflow-y-auto" role="listbox" aria-label="File nguồn">
            {files.data.items.map((f) => {
              const disabled = f.probeStatus !== "OK";
              const on = selected?.id === f.id;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    disabled={disabled}
                    onClick={() => setSelected(f)}
                    className={cn(
                      "grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-50",
                      on ? "bg-indigo-50 ring-1 ring-indigo-300 ring-inset" : "hover:bg-zinc-50",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-zinc-900">{basename(f.key)}</span>
                      <span className="block truncate text-xs text-zinc-500">{f.key}</span>
                    </span>
                    <span className="flex flex-wrap items-center justify-end gap-1.5 text-xs text-zinc-600 tabular-nums">
                      <span>{formatDuration(f.durationSec)}</span>
                      <span className="hidden sm:inline">· {formatResolution(f.width, f.height)}</span>
                      <span className="hidden sm:inline">· {formatBytes(f.sizeBytes)}</span>
                      {f.linkedAssetIds.length ? <Badge tone="blue">Đã gắn</Badge> : null}
                      <ProbeBadge file={f} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {files.data && files.data.total > files.data.pageSize ? <Pagination {...files.data} onPage={setPage} /> : null}
      </div>
    </Dialog>
  );
}
