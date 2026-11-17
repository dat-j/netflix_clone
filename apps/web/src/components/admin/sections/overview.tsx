"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertOctagon, ArrowRight, CheckCircle2, Clock, Cpu, Eye, FileVideo, Film, PencilLine, Users, Wallet } from "lucide-react";
import { cn, formatBytes, formatRelative } from "../lib/format";
import { isActiveJob, useJobs, useStats, useSystemHealth } from "../lib/queries";
import { Card, EmptyState, ErrorState, PageHeader, ProgressBar, Skeleton } from "../ui/primitives";
import { JobStatusBadge } from "../ui/status";

function Tile({ label, value, sub, icon, href, tone = "zinc" }: { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; href?: string; tone?: "zinc" | "red" | "blue" | "green" }) {
  const body = (
    <div className={cn("admin-card flex h-full flex-col gap-1 rounded-xl border bg-white px-4 py-3.5 shadow-xs", href && "hover:border-zinc-300", tone === "red" ? "border-red-200" : tone === "green" ? "border-emerald-200" : "border-zinc-200")}>
      <div className="flex items-center justify-between text-[12px] font-medium text-zinc-500">
        {label}
        <span className={cn(tone === "red" ? "text-red-500" : tone === "green" ? "text-emerald-500" : tone === "blue" ? "text-indigo-500" : "text-zinc-400")}>{icon}</span>
      </div>
      <div className="text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-zinc-500">{sub}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-indigo-500">
      {body}
    </Link>
  ) : (
    body
  );
}

export function OverviewSection() {
  const stats = useStats();
  const jobs = useJobs({ status: "", page: 1 });
  const health = useSystemHealth();
  const s = stats.data;
  const n = (v: number | undefined) => (v ?? 0).toLocaleString("vi-VN");
  const ic = "size-4";

  return (
    <>
      <PageHeader title="Tổng quan" description="Tình trạng hệ thống, nội dung và hàng đợi transcode." />
      {stats.isError ? (
        <Card className="mb-4">
          <ErrorState error={stats.error} onRetry={() => stats.refetch()} compact />
        </Card>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 ui-stagger">
          {!s ? (
            Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-[88px] rounded-lg" />)
          ) : (
            <>
              <Tile label="Người dùng" value={n(s.users)} icon={<Users className={ic} />} href="/admin/users" />
              <Tile label="Thuê bao hoạt động" value={n(s.activeSubscriptions)} icon={<Wallet className={ic} />} href="/admin/users" sub={s.users ? `${Math.round((s.activeSubscriptions / s.users) * 100)}% người dùng` : undefined} />
              <Tile label="Lượt xem 7 ngày" value={n(s.viewsLast7d)} icon={<Eye className={ic} />} />
              <Tile label="Phim đã xuất bản" value={n(s.titlesPublished)} icon={<Film className={ic} />} href="/admin/titles" />
              <Tile label="Phim nháp" value={n(s.titlesDraft)} icon={<PencilLine className={ic} />} href="/admin/titles" />
              <Tile label="File nguồn" value={n(s.sourceFiles)} sub={formatBytes(s.sourceBytes)} icon={<FileVideo className={ic} />} href="/admin/source-files" />
              <Tile label="Job đang chạy" value={n(s.jobsRunning)} icon={<Cpu className={ic} />} tone="blue" href="/admin/jobs" />
              <Tile label="Job chờ" value={n(s.jobsQueued)} icon={<Clock className={ic} />} href="/admin/jobs" />
              <Tile label="Job lỗi" value={n(s.jobsFailed)} icon={<AlertOctagon className={ic} />} tone={s.jobsFailed > 0 ? "red" : "zinc"} href="/admin/jobs" />
              <Tile
                label="Hệ thống"
                value={<span className="text-base">{health.isError ? "Có sự cố" : health.data ? "Đang hoạt động" : "Đang kiểm tra"}</span>}
                icon={health.isError || health.data?.dependencies.worker.status !== "ok"
                  ? <AlertOctagon className={ic} />
                  : <CheckCircle2 className={ic} />}
                tone={health.isError || (health.data && health.data.dependencies.worker.status !== "ok") ? "red" : health.data ? "green" : "blue"}
                sub={health.data
                  ? `DB ${health.data.dependencies.database.latencyMs}ms · Redis ${health.data.dependencies.redis.latencyMs}ms · Worker ${health.data.dependencies.worker.activeWorkers}`
                  : health.isError ? "Không kết nối được health endpoint" : "Đang kiểm tra API, database và Redis"}
              />
            </>
          )}
        </div>
      )}

      <Card
        title="Tác vụ transcode gần đây"
        actions={
          <Link href="/admin/jobs" className="inline-flex items-center gap-1 text-[13px] font-medium text-indigo-600 hover:text-indigo-500">
            Xem tất cả <ArrowRight className="size-3.5" />
          </Link>
        }
      >
        {jobs.isError ? (
          <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} compact />
        ) : !jobs.data ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : jobs.data.items.length === 0 ? (
          <EmptyState title="Chưa có tác vụ nào" description="Gắn file nguồn vào một phim để bắt đầu transcode." />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {jobs.data.items.slice(0, 8).map((j) => (
              <li key={j.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_110px_180px_100px]">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-zinc-900">{j.titleName ?? "(không rõ phim)"}</p>
                  <p className="truncate text-xs text-zinc-500">{j.stage ?? j.sourceKey ?? j.id}</p>
                </div>
                <div className="justify-self-end sm:justify-self-start">
                  <JobStatusBadge status={j.status} />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  {isActiveJob(j.status) || j.status === "SUCCEEDED" ? (
                    <ProgressBar value={j.status === "SUCCEEDED" ? 100 : j.progress} tone={j.status === "SUCCEEDED" ? "green" : "blue"} />
                  ) : j.error ? (
                    <p className="truncate text-xs text-red-600" title={j.error}>
                      {j.error}
                    </p>
                  ) : null}
                </div>
                <span className="hidden text-right text-xs text-zinc-500 sm:block">{formatRelative(j.startedAt ?? j.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
