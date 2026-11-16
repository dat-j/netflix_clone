"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Download, Film, PencilLine, Search, Settings2 } from "lucide-react";
import type { AdminTitle, TitleType, TmdbSearchResult } from "@app/shared";
import { api, ApiRequestError } from "@/lib/api/client";
import { cn } from "../lib/format";
import { adminApi, qk, useAdminMutation } from "../lib/queries";
import { titleToForm } from "../lib/schemas";
import { useFeedback } from "../ui/feedback";
import { Button, Card, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton } from "../ui/primitives";
import { TYPE_LABEL } from "../ui/status";
import { TitleForm } from "./title-form";

/** API báo TMDB chưa cấu hình (thiếu API key) — nhận diện mềm vì hợp đồng không định nghĩa mã riêng. */
export function isTmdbNotConfigured(e: unknown): boolean {
  if (!(e instanceof ApiRequestError)) return false;
  if (e.statusCode === 501 || e.statusCode === 503) return true;
  return /tmdb/i.test(e.message) && /(config|cấu hình|api key|apikey|token)/i.test(e.message);
}

export function TitleNewSection() {
  const [tab, setTab] = useState<"tmdb" | "manual">("tmdb");
  return (
    <>
      <Link href="/admin/titles" className="mb-3 inline-flex items-center gap-1 text-[13px] text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-3.5" /> Danh sách phim
      </Link>
      <PageHeader title="Thêm phim" description="Nhập metadata từ TMDB (khuyến nghị) hoặc tạo thủ công." />
      <div className="mb-4 inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 shadow-xs" role="tablist">
        {(
          [
            ["tmdb", "Từ TMDB", Download],
            ["manual", "Nhập thủ công", PencilLine],
          ] as const
        ).map(([k, label, Icon]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium", tab === k ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900")}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>
      {tab === "tmdb" ? <TmdbImport onManual={() => setTab("manual")} /> : <ManualCreate />}
    </>
  );
}

function TmdbImport({ onManual }: { onManual: () => void }) {
  const router = useRouter();
  const { toast, toastError } = useFeedback();
  const [draft, setDraft] = useState("");
  const [type, setType] = useState<TitleType>("MOVIE");
  const [search, setSearch] = useState<{ q: string; type: TitleType } | null>(null);
  const results = useQuery({
    queryKey: ["admin", "tmdb", search],
    queryFn: () => api<TmdbSearchResult[]>("/admin/tmdb/search", { query: { q: search!.q, type: search!.type } }),
    enabled: !!search,
    staleTime: 60_000,
  });
  const imp = useAdminMutation(
    (r: TmdbSearchResult) => api<AdminTitle>("/admin/titles/import-tmdb", { method: "POST", body: { tmdbId: r.tmdbId, type: r.type } }),
    [qk.titlesAll, qk.stats],
    (t) => {
      toast("success", "Đã nhập phim từ TMDB", t.name);
      router.push(`/admin/titles/${t.id}`);
    },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = draft.trim();
    if (q) setSearch({ q, type });
  };

  const notConfigured = results.isError && isTmdbNotConfigured(results.error);

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2 border-b border-zinc-200 p-3">
        <div className="relative min-w-0 flex-1 basis-60">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400" />
          <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Tên phim trên TMDB…" className="pl-8" aria-label="Từ khoá TMDB" />
        </div>
        <Select value={type} onChange={(e) => setType(e.target.value as TitleType)} className="w-auto" aria-label="Loại">
          <option value="MOVIE">Phim lẻ</option>
          <option value="SERIES">Phim bộ</option>
        </Select>
        <Button type="submit" variant="primary" loading={results.isFetching}>
          Tìm
        </Button>
      </form>
      {!search ? (
        <EmptyState icon={<Search className="size-8" />} title="Tìm phim trên TMDB" description="Metadata, poster, backdrop, logo, diễn viên sẽ được nhập tự động." />
      ) : notConfigured ? (
        <div className="m-4 flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900" role="alert">
          <Settings2 className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">TMDB chưa được cấu hình</p>
            <p className="mt-1">Máy chủ chưa có khoá API TMDB (biến môi trường <code className="rounded bg-amber-100 px-1">TMDB_API_KEY</code>/<code className="rounded bg-amber-100 px-1">TMDB_READ_TOKEN</code>). Bạn vẫn có thể tạo phim thủ công.</p>
            <Button size="sm" className="mt-3" onClick={onManual}>
              <PencilLine className="size-3.5" /> Nhập thủ công
            </Button>
          </div>
        </div>
      ) : results.isError ? (
        <ErrorState error={results.error} onRetry={() => results.refetch()} />
      ) : !results.data ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : results.data.length === 0 ? (
        <EmptyState title="Không tìm thấy kết quả" description={`Không có ${TYPE_LABEL[search.type].toLowerCase()} nào khớp “${search.q}”.`} />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {results.data.map((r) => (
            <li key={`${r.type}-${r.tmdbId}`} className="flex gap-3 px-3 py-3">
              <div className="flex h-24 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-zinc-100">
                {r.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <Film className="size-5 text-zinc-300" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900">
                  {r.name} {r.year ? <span className="font-normal text-zinc-500">({r.year})</span> : null}
                </p>
                {r.originalName && r.originalName !== r.name ? <p className="text-xs text-zinc-500">{r.originalName}</p> : null}
                <p className="mt-1 line-clamp-2 text-xs text-zinc-600">{r.overview ?? "Không có mô tả."}</p>
              </div>
              <div className="shrink-0 self-center">
                {r.alreadyImported ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <Check className="size-3.5" /> Đã nhập
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={imp.isPending && imp.variables?.tmdbId === r.tmdbId}
                    disabled={imp.isPending}
                    onClick={() => imp.mutate(r, { onError: (e) => toastError(e, "Nhập phim thất bại") })}
                  >
                    <Download className="size-3.5" /> Nhập
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ManualCreate() {
  const router = useRouter();
  const { toast, toastError } = useFeedback();
  const create = useAdminMutation(adminApi.createTitle, [qk.titlesAll, qk.stats], (t) => {
    toast("success", "Đã tạo phim", t.name);
    router.push(`/admin/titles/${t.id}`);
  });
  return (
    <Card title="Thông tin phim">
      <div className="p-4">
        <TitleForm
          initial={titleToForm(null)}
          submitLabel="Tạo phim"
          submitting={create.isPending}
          onSubmit={(input) => create.mutate(input, { onError: (e) => toastError(e, "Không tạo được phim") })}
          onCancel={() => router.push("/admin/titles")}
        />
      </div>
    </Card>
  );
}
