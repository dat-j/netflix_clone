"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderSearch, Link2, ScanLine, Search } from "lucide-react";
import type { AssetKind, MediaAssetDto, SourceFileDto } from "@app/shared";
import { api } from "@/lib/api/client";
import { basename, cn, formatBytes, formatDuration, formatResolution } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import { qk, useSourceFiles, useTitles } from "../lib/queries";
import { Dialog } from "../ui/dialog";
import { useFeedback } from "../ui/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Select, Skeleton, Spinner, Toolbar } from "../ui/primitives";
import { FullRow, SkeletonRows, Table, Td, Th, THead, Tr } from "../ui/table";
import { ProbeBadge, PublishBadge } from "../ui/status";

export function SourceFilesSection() {
  const qc = useQueryClient();
  const { toast, toastError } = useFeedback();
  const [q, setQ] = useState("");
  const [prefix, setPrefix] = useState("");
  const [status, setStatus] = useState("");
  const [unlinked, setUnlinked] = useState(false);
  const [page, setPage] = useState(1);
  const [scanning, setScanning] = useState(false);
  const [scanUntil, setScanUntil] = useState(0);
  const [attachFile, setAttachFile] = useState<SourceFileDto | null>(null);
  const dq = useDebounced(q);
  const dprefix = useDebounced(prefix);
  const files = useSourceFiles({ q: dq, prefix: dprefix, status, unlinked, page });

  // Sau khi quét: tự làm mới trong ~1 phút để thấy file mới / kết quả probe.
  useEffect(() => {
    if (!scanUntil) return;
    const t = setInterval(() => {
      if (Date.now() > scanUntil) {
        setScanUntil(0);
        return;
      }
      void qc.invalidateQueries({ queryKey: qk.sourceFilesAll });
    }, 3000);
    return () => clearInterval(t);
  }, [scanUntil, qc]);

  const scan = async () => {
    setScanning(true);
    try {
      await api<{ queued: true }>("/admin/source-files/scan", { method: "POST", body: prefix.trim() ? { prefix: prefix.trim() } : {} });
      toast("success", "Đã xếp hàng quét bucket", prefix.trim() ? `Prefix: ${prefix.trim()}` : "Toàn bộ bucket — kết quả probe sẽ cập nhật dần.");
      setScanUntil(Date.now() + 60_000);
    } catch (e) {
      toastError(e, "Không quét được bucket");
    } finally {
      setScanning(false);
    }
  };

  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const cols = 10;

  return (
    <>
      <PageHeader
        title="Kho file nguồn"
        description="File video gốc trong bucket, kết quả ffprobe và liên kết tới phim."
        actions={
          <Button variant="primary" onClick={scan} loading={scanning}>
            <ScanLine className="size-4" /> Quét bucket{prefix.trim() ? " (prefix)" : ""}
          </Button>
        }
      />
      <Card>
        <Toolbar>
          <div className="relative min-w-0 flex-1 basis-52">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400" />
            <Input placeholder="Tìm theo tên file…" value={q} onChange={(e) => reset(() => setQ(e.target.value))} className="pl-8" aria-label="Tìm file" />
          </div>
          <div className="relative min-w-0 basis-44">
            <FolderSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400" />
            <Input placeholder="Prefix, VD: movies/" value={prefix} onChange={(e) => reset(() => setPrefix(e.target.value))} className="pl-8" aria-label="Prefix" />
          </div>
          <Select value={status} onChange={(e) => reset(() => setStatus(e.target.value))} className="w-auto" aria-label="Trạng thái probe">
            <option value="">Mọi trạng thái</option>
            <option value="OK">OK</option>
            <option value="PENDING">Đang probe</option>
            <option value="FAILED">Lỗi probe</option>
            <option value="SKIPPED">Bỏ qua</option>
          </Select>
          <label className="flex h-9 items-center gap-2 px-1 text-[13px] text-zinc-700">
            <input type="checkbox" checked={unlinked} onChange={(e) => reset(() => setUnlinked(e.target.checked))} className="size-4 accent-indigo-600" />
            Chưa gắn phim
          </label>
          {scanUntil ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-indigo-600">
              <Spinner className="text-indigo-500" /> Đang cập nhật kết quả quét…
            </span>
          ) : files.isFetching && files.data ? (
            <Spinner />
          ) : null}
        </Toolbar>
        <Table minWidth={1080}>
          <THead>
            <Th className="w-[30%]">File</Th>
            <Th className="text-right">Dung lượng</Th>
            <Th className="text-right">Thời lượng</Th>
            <Th>Codec</Th>
            <Th>Độ phân giải</Th>
            <Th>Audio</Th>
            <Th>Phụ đề</Th>
            <Th>Probe</Th>
            <Th>Liên kết</Th>
            <Th className="text-right">
              <span className="sr-only">Hành động</span>
            </Th>
          </THead>
          {files.isError ? (
            <FullRow cols={cols}>
              <ErrorState error={files.error} onRetry={() => files.refetch()} />
            </FullRow>
          ) : !files.data ? (
            <SkeletonRows cols={cols} />
          ) : files.data.items.length === 0 ? (
            <FullRow cols={cols}>
              <EmptyState title="Không có file nào" description={q || prefix || status || unlinked ? "Thử bỏ bớt bộ lọc." : "Bấm “Quét bucket” để liệt kê file nguồn."} />
            </FullRow>
          ) : (
            <tbody>
              {files.data.items.map((f) => (
                <Tr key={f.id}>
                  <Td className="max-w-0">
                    <p className="truncate font-medium text-zinc-900" title={f.key}>
                      {basename(f.key)}
                    </p>
                    <p className="truncate text-xs text-zinc-500" title={`${f.bucket}/${f.key}`}>
                      {f.key}
                    </p>
                  </Td>
                  <Td className="text-right whitespace-nowrap tabular-nums">{formatBytes(f.sizeBytes)}</Td>
                  <Td className="text-right tabular-nums">{formatDuration(f.durationSec)}</Td>
                  <Td className="text-xs whitespace-nowrap uppercase">
                    {f.videoCodec ?? "—"}
                    {f.container ? <span className="ml-1 text-zinc-400 normal-case">({f.container})</span> : null}
                  </Td>
                  <Td className="tabular-nums whitespace-nowrap">{formatResolution(f.width, f.height)}</Td>
                  <Td className="text-xs whitespace-nowrap">
                    {f.audioTracks.length ? (
                      <span title={f.audioTracks.map((a) => `#${a.index} ${a.codec} ${a.language ?? "und"} ${a.channels ?? "?"}ch`).join("\n")}>
                        {f.audioTracks.length} · {f.audioTracks.map((a) => a.language ?? "und").join(", ")}
                      </span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </Td>
                  <Td className="text-xs whitespace-nowrap">
                    {f.subtitleTracks.length ? (
                      <span title={f.subtitleTracks.map((s) => `#${s.index} ${s.codec} ${s.language ?? "und"}`).join("\n")}>
                        {f.subtitleTracks.length} · {f.subtitleTracks.map((s) => s.language ?? "und").join(", ")}
                      </span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </Td>
                  <Td>
                    <ProbeBadge file={f} />
                  </Td>
                  <Td>{f.linkedAssetIds.length ? <Badge tone="blue">{f.linkedAssetIds.length} asset</Badge> : <span className="text-xs text-zinc-400">Chưa gắn</span>}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" disabled={f.probeStatus !== "OK"} onClick={() => setAttachFile(f)} title={f.probeStatus !== "OK" ? "Cần probe OK trước khi gắn" : undefined}>
                      <Link2 className="size-3.5" /> Gắn vào phim
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          )}
        </Table>
        {files.data && files.data.total > 0 ? <Pagination {...files.data} onPage={setPage} /> : null}
      </Card>
      {attachFile ? <AttachToTitleDialog file={attachFile} onClose={() => setAttachFile(null)} /> : null}
    </>
  );
}

function AttachToTitleDialog({ file, onClose }: { file: SourceFileDto; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast, toastError } = useFeedback();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<AssetKind>("MAIN");
  const [titleId, setTitleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dq = useDebounced(q);
  const titles = useTitles({ q: dq, status: "", type: "", page: 1 });

  const submit = async () => {
    if (!titleId) return;
    setBusy(true);
    try {
      await api<MediaAssetDto>(`/admin/titles/${titleId}/assets`, { method: "POST", body: { sourceFileId: file.id, kind } });
      toast("success", "Đã gắn file và đưa vào hàng đợi transcode");
      await Promise.all([qc.invalidateQueries({ queryKey: qk.sourceFilesAll }), qc.invalidateQueries({ queryKey: qk.jobsAll }), qc.invalidateQueries({ queryKey: qk.title(titleId) })]);
      onClose();
    } catch (e) {
      toastError(e, "Không gắn được file");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title="Gắn file vào phim"
      description={file.key}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" disabled={!titleId} loading={busy} onClick={submit}>
            Gắn & transcode
          </Button>
        </>
      }
    >
      <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_180px]">
        <Field label="Tìm phim">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên phim…" />
        </Field>
        <Field label="Loại media">
          <Select value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>
            <option value="MAIN">Video chính</option>
            <option value="PREVIEW">Preview / trailer</option>
          </Select>
        </Field>
      </div>
      <div className="overflow-hidden rounded-md border border-zinc-200">
        {titles.isError ? (
          <ErrorState error={titles.error} compact onRetry={() => titles.refetch()} />
        ) : !titles.data ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : titles.data.items.length === 0 ? (
          <EmptyState title="Không có phim phù hợp" />
        ) : (
          <ul className="max-h-[45dvh] divide-y divide-zinc-100 overflow-y-auto" role="listbox" aria-label="Phim">
            {titles.data.items.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={titleId === t.id}
                  onClick={() => setTitleId(t.id)}
                  className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]", titleId === t.id ? "bg-indigo-50 ring-1 ring-indigo-300 ring-inset" : "hover:bg-zinc-50")}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                  {(kind === "MAIN" ? t.mainAsset : t.previewAsset) ? <Badge tone="amber">Sẽ thay media hiện có</Badge> : null}
                  <PublishBadge status={t.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
