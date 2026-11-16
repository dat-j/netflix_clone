"use client";

import type { AssetStatus, JobStatus, PublishStatus, SourceFileDto, SubscriptionDto, TitleType } from "@app/shared";
import { Badge } from "./primitives";
import { formatDate } from "../lib/format";

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  QUEUED: "Chờ xử lý",
  RUNNING: "Đang chạy",
  SUCCEEDED: "Hoàn tất",
  FAILED: "Lỗi",
  CANCELED: "Đã huỷ",
};
export function JobStatusBadge({ status }: { status: JobStatus }) {
  const tone = { QUEUED: "neutral", RUNNING: "blue", SUCCEEDED: "green", FAILED: "red", CANCELED: "amber" } as const;
  return (
    <Badge tone={tone[status]}>
      {status === "RUNNING" ? <span className="size-1.5 animate-pulse rounded-full bg-sky-500 motion-reduce:animate-none" /> : null}
      {JOB_STATUS_LABEL[status]}
    </Badge>
  );
}

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  PENDING: "Chờ",
  QUEUED: "Trong hàng đợi",
  PROCESSING: "Đang transcode",
  READY: "Sẵn sàng",
  FAILED: "Lỗi",
};
export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  const tone = { PENDING: "neutral", QUEUED: "neutral", PROCESSING: "blue", READY: "green", FAILED: "red" } as const;
  return <Badge tone={tone[status]}>{ASSET_STATUS_LABEL[status]}</Badge>;
}

export const PUBLISH_LABEL: Record<PublishStatus, string> = { DRAFT: "Nháp", PUBLISHED: "Đã xuất bản", ARCHIVED: "Lưu trữ" };
export function PublishBadge({ status }: { status: PublishStatus }) {
  const tone = { DRAFT: "amber", PUBLISHED: "green", ARCHIVED: "neutral" } as const;
  return <Badge tone={tone[status]}>{PUBLISH_LABEL[status]}</Badge>;
}

export const TYPE_LABEL: Record<TitleType, string> = { MOVIE: "Phim lẻ", SERIES: "Phim bộ" };

export function ProbeBadge({ file }: { file: SourceFileDto }) {
  const map = { PENDING: ["neutral", "Đang probe"], OK: ["green", "OK"], FAILED: ["red", "Lỗi probe"], SKIPPED: ["amber", "Bỏ qua"] } as const;
  const [tone, label] = map[file.probeStatus];
  return (
    <Badge tone={tone} title={file.probeError ?? undefined}>
      {label}
    </Badge>
  );
}

export function SubscriptionBadge({ sub }: { sub: SubscriptionDto | null }) {
  if (!sub) return <Badge tone="neutral">Chưa có gói</Badge>;
  const tone = { ACTIVE: "green", PAST_DUE: "amber", CANCELED: "neutral", EXPIRED: "red" } as const;
  const label = { ACTIVE: "Đang hoạt động", PAST_DUE: "Quá hạn", CANCELED: "Đã huỷ", EXPIRED: "Hết hạn" }[sub.status];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone="violet">{sub.plan.name}</Badge>
      <Badge tone={tone[sub.status]}>{label}</Badge>
      <span className="text-[11px] text-zinc-500">đến {formatDate(sub.currentPeriodEnd)}</span>
    </span>
  );
}
