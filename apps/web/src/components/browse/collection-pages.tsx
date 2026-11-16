"use client";

import { Bookmark, SearchX } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { use, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGenres, useGenreTitles, useMyList, useSearch } from "@/lib/queries";
import { GenrePicker } from "./genre-picker";
import { EmptyPanel, ErrorPanel } from "./state-panels";
import { TitleGrid, TitleGridSkeleton } from "./title-grid";

function PageHeading({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-gutter pt-[calc(var(--header-h)+1.5rem)] pb-[2vw] md:pt-[calc(var(--header-h)+2.5rem)]">
      <h1 className="text-[clamp(1.5rem,2.6vw,2.4rem)] font-bold">{children}</h1>
      {aside}
    </div>
  );
}

export function GenrePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = use(params);
  const slug = decodeURIComponent(raw);
  const q = useGenreTitles(slug);
  const { data: genres } = useGenres();
  const genre = q.data?.pages[0]?.genre ?? genres?.find((g) => g.slug === slug);
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);

  return (
    <div className="pb-16">
      <PageHeading aside={<GenrePicker label="Thể loại khác" />}>
        {genre?.name ?? <Skeleton className="inline-block h-[1em] w-48 align-middle" />}
      </PageHeading>
      {q.isPending ? (
        <TitleGridSkeleton />
      ) : q.error ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyPanel title="Chưa có nội dung trong thể loại này" action={<Button asChild variant="outline"><Link href="/browse">Về trang chủ</Link></Button>} />
      ) : (
        <TitleGrid
          items={items}
          gridKey={`genre-${slug}`}
          hasMore={q.hasNextPage}
          loadingMore={q.isFetchingNextPage}
          onLoadMore={() => void q.fetchNextPage()}
        />
      )}
    </div>
  );
}

export function MyListPage() {
  const { data, isPending, error, refetch } = useMyList();
  return (
    <div className="pb-16">
      <PageHeading>Danh sách của tôi</PageHeading>
      {isPending ? (
        <TitleGridSkeleton count={10} />
      ) : error ? (
        <ErrorPanel error={error} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyPanel
          icon={<Bookmark className="size-14" />}
          title="Bạn chưa thêm nội dung nào vào danh sách"
          action={
            <Button asChild variant="primary">
              <Link href="/browse">Khám phá phim</Link>
            </Button>
          }
        >
          Nhấn nút <strong className="text-white">+</strong> trên phim hoặc series để lưu lại và xem sau.
        </EmptyPanel>
      ) : (
        <TitleGrid items={data} gridKey="my-list" />
      )}
    </div>
  );
}

export function SearchPage() {
  const params = useSearchParams();
  const term = (params.get("q") ?? "").trim();
  const q = useSearch(term);
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const total = q.data?.pages[0]?.total;

  return (
    <div className="min-h-[70vh] pb-16" data-testid="search-page">
      <div className="px-gutter pt-[calc(var(--header-h)+1.5rem)] pb-[2vw] md:pt-[calc(var(--header-h)+2.5rem)]">
        {term ? (
          <p className="text-[clamp(1rem,1.3vw,1.25rem)] text-white/60" aria-live="polite">
            {q.isPending ? (
              "Đang tìm…"
            ) : (
              <>
                {total != null && total > 0 ? `${total} kết quả cho ` : "Kết quả cho "}
                <span className="font-semibold text-white">“{term}”</span>
              </>
            )}
          </p>
        ) : (
          <h1 className="text-[clamp(1.5rem,2.6vw,2.4rem)] font-bold">Tìm kiếm</h1>
        )}
      </div>
      {!term ? (
        <EmptyPanel title="Bạn muốn xem gì hôm nay?">Nhập tên phim, series, diễn viên hoặc thể loại vào ô tìm kiếm phía trên. Không cần gõ dấu.</EmptyPanel>
      ) : q.isPending ? (
        <TitleGridSkeleton />
      ) : q.error ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyPanel icon={<SearchX className="size-14" />} title={`Không tìm thấy kết quả cho “${term}”`}>
          <ul className="mt-2 space-y-1 text-left text-sm">
            <li>• Thử từ khóa khác hoặc ngắn hơn</li>
            <li>• Tìm theo tên phim, diễn viên hay đạo diễn</li>
            <li>• Thử một thể loại như “hài”, “hành động”, “tình cảm”</li>
          </ul>
        </EmptyPanel>
      ) : (
        <div className={q.isPlaceholderData ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <TitleGrid
            items={items}
            gridKey={`search-${term}`}
            hasMore={q.hasNextPage}
            loadingMore={q.isFetchingNextPage}
            onLoadMore={() => void q.fetchNextPage()}
          />
        </div>
      )}
    </div>
  );
}
