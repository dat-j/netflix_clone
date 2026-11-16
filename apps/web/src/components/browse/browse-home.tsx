"use client";

import type { TitleType } from "@app/shared";
import { Clapperboard } from "lucide-react";
import { useMediaQuery } from "@/lib/hooks/use-media";
import { useHome } from "@/lib/queries";
import { Billboard, BillboardSkeleton, MobileHero } from "./billboard";
import { GenrePicker } from "./genre-picker";
import { LazyRow, RowSkeleton } from "./row";
import { EmptyPanel, ErrorPanel, SubscriptionBanner } from "./state-panels";

export function BrowseHome({ type }: { type?: TitleType }) {
  const { data, error, isPending, refetch } = useHome(type);
  const isDesktop = useMediaQuery("(min-width: 768px)", true);
  const heading = type === "MOVIE" ? "Phim lẻ" : type === "SERIES" ? "Phim bộ" : null;

  return (
    <div className="relative pb-16">
      {heading && (
        <div className="absolute inset-x-0 top-[var(--header-h)] z-[3] flex items-center gap-6 px-gutter py-3 max-md:static max-md:pt-[calc(var(--header-h)+0.75rem)]">
          <h1 className="text-[clamp(1.5rem,2.6vw,2.4rem)] font-bold text-shadow">{heading}</h1>
          <GenrePicker />
        </div>
      )}

      {isPending ? (
        <>
          <BillboardSkeleton />
          <div className="relative z-[1]">
            {Array.from({ length: 4 }, (_, i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        </>
      ) : error ? (
        <div className="pt-[calc(var(--header-h)+4rem)]">
          <ErrorPanel error={error} onRetry={() => void refetch()} />
        </div>
      ) : (
        <>
          {data.billboard && isDesktop ? (
            <Billboard title={data.billboard} />
          ) : data.billboard && !heading ? (
            <MobileHero title={data.billboard} />
          ) : (
            <div className="h-[calc(var(--header-h)+5rem)]" />
          )}
          <div className="relative z-[1]">
            <SubscriptionBanner />
            {data.rows.filter((r) => r.items.length > 0).length === 0 ? (
              <EmptyPanel icon={<Clapperboard className="size-14" />} title="Chưa có nội dung">
                Thư viện đang được cập nhật. Vui lòng quay lại sau.
              </EmptyPanel>
            ) : (
              data.rows
                .filter((r) => r.items.length > 0)
                .map((row, i) => <LazyRow key={row.id} row={row} index={i} />)
            )}
          </div>
        </>
      )}
    </div>
  );
}
