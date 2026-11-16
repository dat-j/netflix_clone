"use client";

import type { TitleCard } from "@app/shared";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { HoverAlign } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { TitleCardTile } from "./title-card";

/** Wrapping grid of cards (genre, search, my list) with the same per-row counts as sliders. */
export function TitleGrid({
  items,
  gridKey,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  items: TitleCard[];
  gridKey: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [per, setPer] = useState(5);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setPer(parseInt(getComputedStyle(el).getPropertyValue("--per"), 10) || 5);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || !onLoadMore) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && onLoadMore(), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, onLoadMore]);

  const alignFor = (i: number): HoverAlign => (i % per === 0 ? "left" : i % per === per - 1 ? "right" : "center");

  return (
    <div ref={ref} className="row-metrics px-gutter">
      <ul className="grid gap-x-[var(--row-gap)] gap-y-[max(2.5vw,1.25rem)]" style={{ gridTemplateColumns: "repeat(var(--per), minmax(0, 1fr))" }}>
        {items.map((card, i) => (
          <li key={card.id}>
            <TitleCardTile card={card} hoverKey={`${gridKey}:${i}`} align={alignFor(i)} preload={i < per} />
          </li>
        ))}
      </ul>
      <div ref={sentinel} aria-hidden />
      {loadingMore && (
        <div className="flex justify-center py-8">
          <Spinner className="size-8 text-white/60" />
        </div>
      )}
    </div>
  );
}

export function TitleGridSkeleton({ count = 18, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("row-metrics px-gutter", className)} aria-busy>
      <div className="grid gap-x-[var(--row-gap)] gap-y-[max(2.5vw,1.25rem)]" style={{ gridTemplateColumns: "repeat(var(--per), minmax(0, 1fr))" }}>
        {Array.from({ length: count }, (_, i) => (
          <Skeleton key={i} className="aspect-video w-full rounded-[4px]" style={{ animationDelay: `${(i % 6) * 80}ms` }} />
        ))}
      </div>
    </div>
  );
}
