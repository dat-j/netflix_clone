import type { Prisma } from "@app/db";
import type { MediaAssetDto, SourceFileDto, TranscodeJobDto } from "@app/shared";

export const jobInclude = {
  asset: {
    select: {
      sourceFile: { select: { key: true } },
      titleAsMain: { select: { name: true } },
      titleAsPreview: { select: { name: true } },
      episodeAsMain: { select: { name: true, title: { select: { name: true } } } },
    },
  },
} satisfies Prisma.TranscodeJobInclude;

type JobRow = Prisma.TranscodeJobGetPayload<{ include: typeof jobInclude }>;
type BareJob = Prisma.TranscodeJobGetPayload<object>;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toJobDto(j: JobRow | BareJob, ctx?: { titleName?: string | null; sourceKey?: string | null }): TranscodeJobDto {
  const a = "asset" in j ? j.asset : null;
  const titleName = ctx?.titleName ?? a?.titleAsMain?.name ?? a?.titleAsPreview?.name
    ?? (a?.episodeAsMain ? `${a.episodeAsMain.title.name}${a.episodeAsMain.name ? ` — ${a.episodeAsMain.name}` : ""}` : null);
  return {
    id: j.id,
    assetId: j.assetId,
    titleName: titleName ?? null,
    sourceKey: ctx?.sourceKey ?? a?.sourceFile?.key ?? null,
    status: j.status,
    progress: j.progress,
    stage: j.stage,
    attempt: j.attempt,
    error: j.error,
    startedAt: iso(j.startedAt),
    finishedAt: iso(j.finishedAt),
    createdAt: j.createdAt.toISOString(),
  };
}

export const assetInclude = {
  renditions: { orderBy: { height: "asc" }, select: { name: true, width: true, height: true, videoKbps: true } },
  sourceFile: { select: { key: true } },
  jobs: { orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.MediaAssetInclude;

type AssetRow = Prisma.MediaAssetGetPayload<{ include: typeof assetInclude }>;

export function toAssetDto(a: AssetRow, titleName: string | null = null): MediaAssetDto {
  const job = a.jobs[0];
  return {
    id: a.id,
    kind: a.kind,
    status: a.status,
    durationSec: a.durationSec,
    sourceKey: a.sourceFile?.key ?? null,
    renditions: a.renditions,
    errorMessage: a.errorMessage,
    latestJob: job ? toJobDto(job, { titleName, sourceKey: a.sourceFile?.key ?? null }) : null,
  };
}

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
}
const num = (v: unknown, d: number | null = null) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

type SourceRow = Prisma.SourceFileGetPayload<{ include: { assets: { select: { id: true } } } }>;

export function toSourceFileDto(s: SourceRow): SourceFileDto {
  return {
    id: s.id,
    bucket: s.bucket,
    key: s.key,
    sizeBytes: s.sizeBytes.toString(),
    lastModified: iso(s.lastModified),
    probeStatus: s.probeStatus,
    probeError: s.probeError,
    container: s.container,
    durationSec: s.durationSec,
    videoCodec: s.videoCodec,
    width: s.width,
    height: s.height,
    audioTracks: arr(s.audioTracks).map((t, i) => ({
      index: num(t.index, i)!, codec: str(t.codec) ?? str(t.codec_name) ?? "unknown",
      language: str(t.language) ?? str(t.lang), channels: num(t.channels),
    })),
    subtitleTracks: arr(s.subtitleTracks).map((t, i) => ({
      index: num(t.index, i)!, codec: str(t.codec) ?? str(t.codec_name) ?? "unknown", language: str(t.language) ?? str(t.lang),
    })),
    linkedAssetIds: s.assets.map((a) => a.id),
  };
}
