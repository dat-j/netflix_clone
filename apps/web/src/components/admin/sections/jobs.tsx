"use client";

import { Fragment, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import type { Paginated, TranscodeJobDto } from "@app/shared";
import { api } from "@/lib/api/client";
import { cn, formatDateTime, formatDuration, formatRelative } from "../lib/format";
import { isActiveJob, qk, useJobs } from "../lib/queries";
import { useFeedback } from "../ui/feedback";
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, ProgressBar, Spinner, Toolbar } from "../ui/primitives";
import { FullRow, SkeletonRows, Table, Td, Th, THead } from "../ui/table";
import { JobStatusBadge, JOB_STATUS_LABEL } from "../ui/status";

const FILTERS = ["", "RUNNING", "QUEUED", "FAILED", "SUCCEEDED", "CANCELED"] as const;

function elapsed(j: TranscodeJobDto): string {
  if (!j.startedAt) return "—";
  const end = j.finishedAt ? new Date(j.finishedAt).getTime() : Date.now();
  return formatDuration((end - new Date(j.startedAt).getTime()) / 1000);
}

export function JobsSection() {
  const qc = useQueryClient();
  const { toast, toastError } = useFeedback();
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const jobs = useJobs({ status, page });
  const active = jobs.data?.items.some((j) => isActiveJob(j.status));

  const retry = async (j: TranscodeJobDto) => {
    setRetrying(j.id);
    try {
      const updated = await api<TranscodeJobDto>(`/admin/jobs/${j.id}/retry`, { method: "POST" });
      // cập nhật lạc quan dòng hiện tại
      qc.setQueryData<Paginated<TranscodeJobDto>>(qk.jobs({ status, page }), (d) => (d ? { ...d, items: d.items.map((x) => (x.id === j.id ? updated : x)) } : d));
      toast("success", "Đã đưa tác vụ vào hàng đợi lại", j.titleName ?? undefined);
      void qc.invalidateQueries({ queryKey: qk.jobsAll });
      void qc.invalidateQueries({ queryKey: qk.stats });
    } catch (e) {
      toastError(e, "Không chạy lại được");
    } finally {
      setRetrying(null);
    }
  };

  const cols = 7;
  return (
    <>
      <PageHeader title="Tác vụ transcode" description="Hàng đợi chuyển mã HLS (AES-128), tự làm mới khi có tác vụ đang chạy." />
      <Card>
        <Toolbar>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Lọc trạng thái">
            {FILTERS.map((f) => (
              <button
                key={f || "all"}
                role="tab"
                aria-selected={status === f}
                onClick={() => {
                  setStatus(f);
                  setPage(1);
                }}
                className={cn(
                  "h-7 rounded-full px-3 text-xs font-medium transition-colors",
                  status === f ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200",
                )}
              >
                {f ? JOB_STATUS_LABEL[f] : "Tất cả"}
              </button>
            ))}
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-500">
            {jobs.isFetching ? <Spinner className="size-3.5" /> : <span className={cn("size-1.5 rounded-full", active ? "bg-emerald-500" : "bg-zinc-300")} />}
            {active ? "Tự làm mới mỗi 2 giây" : "Tự làm mới mỗi 10 giây"}
          </span>
        </Toolbar>
        <Table minWidth={900}>
          <THead>
            <Th className="w-8">
              <span className="sr-only">Chi tiết</span>
            </Th>
            <Th className="w-[28%]">Phim / nguồn</Th>
            <Th>Trạng thái</Th>
            <Th className="w-[26%]">Tiến độ</Th>
            <Th>Lần</Th>
            <Th>Thời gian</Th>
            <Th className="text-right">
              <span className="sr-only">Hành động</span>
            </Th>
          </THead>
          {jobs.isError ? (
            <FullRow cols={cols}>
              <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />
            </FullRow>
          ) : !jobs.data ? (
            <SkeletonRows cols={cols} />
          ) : jobs.data.items.length === 0 ? (
            <FullRow cols={cols}>
              <EmptyState title="Không có tác vụ" description={status ? "Không có tác vụ ở trạng thái này." : "Gắn file nguồn vào phim để tạo tác vụ transcode."} />
            </FullRow>
          ) : (
            <tbody>
              {jobs.data.items.map((j) => {
                const expanded = open === j.id;
                return (
                  <Fragment key={j.id}>
                    <tr className={cn("border-b border-zinc-100 hover:bg-zinc-50/80", expanded && "bg-zinc-50")} data-testid="job-row">
                      <Td>
                        <button onClick={() => setOpen(expanded ? null : j.id)} className="rounded p-0.5 text-zinc-400 hover:text-zinc-800" aria-expanded={expanded} aria-label="Chi tiết tác vụ">
                          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                      </Td>
                      <Td className="max-w-0">
                        <p className="truncate font-medium text-zinc-900">{j.titleName ?? "(không rõ phim)"}</p>
                        <p className="truncate text-xs text-zinc-500" title={j.sourceKey ?? undefined}>
                          {j.sourceKey ?? j.assetId}
                        </p>
                      </Td>
                      <Td>
                        <JobStatusBadge status={j.status} />
                      </Td>
                      <Td className="max-w-0">
                        {j.status === "FAILED" ? (
                          <p className="truncate text-xs text-red-600" title={j.error ?? undefined}>
                            {j.error ?? "Lỗi không rõ"}
                          </p>
                        ) : (
                          <>
                            <ProgressBar value={j.status === "SUCCEEDED" ? 100 : j.progress} tone={j.status === "SUCCEEDED" ? "green" : "blue"} />
                            {j.stage && isActiveJob(j.status) ? <p className="mt-0.5 truncate text-[11px] text-zinc-500">{j.stage}</p> : null}
                          </>
                        )}
                      </Td>
                      <Td className="tabular-nums">{j.attempt}</Td>
                      <Td className="text-xs whitespace-nowrap text-zinc-500">
                        <span title={formatDateTime(j.createdAt)}>{formatRelative(j.createdAt)}</span>
                        {j.startedAt ? <span className="block text-zinc-400">chạy {elapsed(j)}</span> : null}
                      </Td>
                      <Td className="text-right">
                        {j.status === "FAILED" || j.status === "CANCELED" ? (
                          <Button size="sm" onClick={() => retry(j)} loading={retrying === j.id}>
                            <RotateCcw className="size-3.5" /> Chạy lại
                          </Button>
                        ) : null}
                      </Td>
                    </tr>
                    {expanded ? (
                      <tr className="border-b border-zinc-100 bg-zinc-50">
                        <td colSpan={cols} className="px-10 py-3">
                          <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-[max-content_1fr]">
                            <dt className="text-zinc-500">Job ID</dt>
                            <dd className="font-mono text-zinc-800">{j.id}</dd>
                            <dt className="text-zinc-500">Asset ID</dt>
                            <dd className="font-mono text-zinc-800">{j.assetId}</dd>
                            <dt className="text-zinc-500">Giai đoạn</dt>
                            <dd>{j.stage ?? "—"}</dd>
                            <dt className="text-zinc-500">Tạo / bắt đầu / kết thúc</dt>
                            <dd>
                              {formatDateTime(j.createdAt)} · {formatDateTime(j.startedAt)} · {formatDateTime(j.finishedAt)}
                            </dd>
                            {j.error ? (
                              <>
                                <dt className="text-zinc-500">Lỗi</dt>
                                <dd>
                                  <pre className="max-h-48 overflow-auto rounded border border-red-200 bg-red-50 p-2 font-mono text-[11px] whitespace-pre-wrap text-red-800">{j.error}</pre>
                                </dd>
                              </>
                            ) : null}
                          </dl>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          )}
        </Table>
        {jobs.data && jobs.data.total > 0 ? <Pagination {...jobs.data} onPage={setPage} /> : null}
      </Card>
    </>
  );
}
