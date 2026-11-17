"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Film, Plus, Search } from "lucide-react";
import type { AdminTitle } from "@app/shared";
import { cn, formatDateTime } from "../lib/format";
import { seriesCountsLabel } from "../lib/series";
import { useDebounced } from "../lib/hooks";
import { useTitles } from "../lib/queries";
import { Card, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Spinner, Toolbar } from "../ui/primitives";
import { FullRow, SkeletonRows, Table, Td, Th, THead, Tr } from "../ui/table";
import { AssetStatusBadge, PublishBadge, TYPE_LABEL } from "../ui/status";

function primaryImage(t: AdminTitle, kind: "POSTER" | "BACKDROP") {
  return t.images.find((i) => i.kind === kind && i.isPrimary) ?? t.images.find((i) => i.kind === kind) ?? null;
}

export function TitlesListSection() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const titles = useTitles({ q: dq, status, type, page });
  const cols = 7;

  return (
    <>
      <PageHeader
        title="Phim"
        description="Quản lý danh mục, metadata, hình ảnh và media."
        actions={
          <Link href="/admin/titles/new" className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3.5 text-sm font-medium text-brand-ink shadow-sm hover:bg-brand-hover">
            <Plus className="size-4" /> Thêm phim
          </Link>
        }
      />
      <Card>
        <Toolbar>
          <div className="relative min-w-0 flex-1 basis-56">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400" />
            <Input
              placeholder="Tìm theo tên, slug…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="pl-8"
              aria-label="Tìm phim"
            />
          </div>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-auto"
            aria-label="Lọc trạng thái"
          >
            <option value="">Mọi trạng thái</option>
            <option value="DRAFT">Nháp</option>
            <option value="PUBLISHED">Đã xuất bản</option>
            <option value="ARCHIVED">Lưu trữ</option>
          </Select>
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
            className="w-auto"
            aria-label="Lọc loại"
          >
            <option value="">Mọi loại</option>
            <option value="MOVIE">Phim lẻ</option>
            <option value="SERIES">Phim bộ</option>
          </Select>
          {titles.isFetching && titles.data ? <Spinner /> : null}
        </Toolbar>
        <Table minWidth={760}>
          <THead>
            <Th className="w-[44%]">Phim</Th>
            <Th>Loại</Th>
            <Th>Trạng thái</Th>
            <Th>Media / tập</Th>
            <Th>Năm</Th>
            <Th>TMDB</Th>
            <Th>Cập nhật</Th>
          </THead>
          {titles.isError ? (
            <FullRow cols={cols}>
              <ErrorState error={titles.error} onRetry={() => titles.refetch()} />
            </FullRow>
          ) : !titles.data ? (
            <SkeletonRows cols={cols} />
          ) : titles.data.items.length === 0 ? (
            <FullRow cols={cols}>
              <EmptyState title="Không có phim nào" description={dq || status || type ? "Thử bỏ bớt bộ lọc." : "Bắt đầu bằng cách nhập phim từ TMDB."} />
            </FullRow>
          ) : (
            <tbody>
              {titles.data.items.map((t) => {
                const poster = primaryImage(t, "POSTER");
                return (
                  <Tr key={t.id} onClick={() => router.push(`/admin/titles/${t.id}`)}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-zinc-100">
                          {poster ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={poster.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <Film className="size-4 text-zinc-300" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <Link href={`/admin/titles/${t.id}`} className="block truncate font-medium text-zinc-900 hover:text-indigo-600" onClick={(e) => e.stopPropagation()}>
                            {t.name}
                          </Link>
                          <p className="truncate text-xs text-zinc-500">{t.slug}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">{TYPE_LABEL[t.type]}</Td>
                    <Td>
                      <PublishBadge status={t.status} />
                    </Td>
                    <Td>
                      {t.type === "SERIES" ? (
                        <span className="text-xs whitespace-nowrap text-zinc-700" data-testid="series-counts">
                          {seriesCountsLabel(t)}
                          {t.episodeCount ? (
                            <span className={cn("ml-1.5", t.publishedEpisodeCount ? "text-emerald-700" : "text-amber-700")}>
                              ({t.publishedEpisodeCount} đã XB)
                            </span>
                          ) : null}
                        </span>
                      ) : t.mainAsset ? (
                        <AssetStatusBadge status={t.mainAsset.status} />
                      ) : (
                        <span className="text-xs text-zinc-400">Chưa gắn</span>
                      )}
                    </Td>
                    <Td className="tabular-nums">{t.releaseDate?.slice(0, 4) ?? "—"}</Td>
                    <Td className="text-xs tabular-nums text-zinc-500">{t.tmdbId ?? "—"}</Td>
                    <Td className="text-xs whitespace-nowrap text-zinc-500">{formatDateTime(t.updatedAt)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          )}
        </Table>
        {titles.data && titles.data.total > 0 ? <Pagination {...titles.data} onPage={setPage} /> : null}
      </Card>
    </>
  );
}
