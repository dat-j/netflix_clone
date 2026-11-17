"use client";

import type { HomeRow, TitleCard } from "@app/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fetchRowPage, qk } from "@/lib/queries";
import { mapApiHref } from "@/lib/routes";
import { useCanHover, useNearViewport } from "@/lib/hooks/use-media";
import { useUI, type HoverAlign } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { TitleCardTile } from "./title-card";

type Variant = "default" | "top10" | "continue";

export function rowVariant(row: Pick<HomeRow, "kind">): Variant {
  if (row.kind === "TOP10") return "top10";
  if (row.kind === "CONTINUE_WATCHING") return "continue";
  return "default";
}

/** Reads the CSS-driven items-per-page (.row-metrics --per) so JS and layout always agree. */
function usePerPage(ref: React.RefObject<HTMLElement | null>) {
  const [per, setPer] = useState(5);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const v = parseInt(getComputedStyle(el).getPropertyValue("--per"), 10);
      if (v > 0) setPer(v);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return per;
}

/** Lazily mounts a row once it nears the viewport; keeps the exact height meanwhile (no layout shift). */
export function LazyRow({ row, index }: { row: HomeRow; index: number }) {
  const [ref, near] = useNearViewport<HTMLDivElement>("400px 0px");
  const eager = index < 2;
  return (
    <div ref={ref}>
      {eager || near ? <Row row={row} rowIndex={index} /> : <RowSkeleton title={row.title} variant={rowVariant(row)} />}
    </div>
  );
}

export function Row({ row, rowIndex = 0 }: { row: HomeRow; rowIndex?: number }) {
  const variant = rowVariant(row);
  const [wantMore, setWantMore] = useState(false);
  // Pages 2+ live in the query cache (["catalog", …]) so optimistic patches reach them too
  const more = useInfiniteQuery({
    queryKey: qk.row(row.id),
    queryFn: ({ pageParam }) => fetchRowPage(row.id, pageParam),
    initialPageParam: 2,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: wantMore && row.hasMore,
    staleTime: 5 * 60_000,
  });
  const items = useMemo(() => {
    const seen = new Set<string>();
    const all = [...row.items, ...(more.data?.pages.flatMap((p) => p.items) ?? [])];
    return all.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  }, [row.items, more.data]);
  const hasMore = row.hasMore && (!more.data || more.hasNextPage);
  const { fetchNextPage, isFetching } = more;

  const loadMore = useCallback(() => {
    if (!hasMore || isFetching) return;
    if (!wantMore) setWantMore(true);
    else void fetchNextPage();
  }, [hasMore, isFetching, wantMore, fetchNextPage]);

  if (items.length === 0) return null;

  return (
    <section aria-labelledby={`row-${row.id}`} className="group/row relative my-[3vw] md:my-[2.2vw] motion-safe:animate-[rise-in_.5s_cubic-bezier(.16,1,.3,1)_both]" data-testid="browse-row">
      <RowHeader id={`row-${row.id}`} title={row.title} href={mapApiHref(row.href)} />
      <Slider items={items} rowKey={`${row.id}-${rowIndex}`} variant={variant} onNearEnd={loadMore} hasMore={hasMore} eager={rowIndex === 0} />
    </section>
  );
}

function RowHeader({ id, title, href }: { id: string; title: string; href: string | null }) {
  const content = (
    <>
      <span>{title}</span>
      {href && (
        <span className="flex items-center text-[0.8rem] font-semibold text-[#54b9c5] opacity-0 transition-all duration-300 group-hover/title:opacity-100 max-md:hidden">
          <span className="max-w-0 overflow-hidden whitespace-nowrap transition-[max-width] duration-500 group-hover/title:max-w-32">Xem tất cả</span>
          <ChevronRight className="size-4 translate-y-px" />
        </span>
      )}
    </>
  );
  return (
    <h2 id={id} className="mb-[0.6em] px-gutter text-[clamp(1rem,1.4vw,1.5rem)] leading-tight font-bold text-[#e5e5e5]">
      {href ? (
        <Link href={href} className="group/title inline-flex items-end gap-2 hover:text-white">
          {content}
        </Link>
      ) : (
        content
      )}
    </h2>
  );
}

function Slider({
  items,
  rowKey,
  variant,
  onNearEnd,
  hasMore,
  eager,
}: {
  items: TitleCard[];
  rowKey: string;
  variant: Variant;
  onNearEnd: () => void;
  hasMore: boolean;
  eager?: boolean;
}) {
  const canHover = useCanHover();
  const metricsRef = useRef<HTMLDivElement>(null);
  const per = usePerPage(metricsRef);
  const [offset, setOffset] = useState(0); // index of the first fully visible item
  const [moved, setMoved] = useState(false);
  const closeHover = useUI((s) => s.closeHover);

  const maxOffset = Math.max(0, items.length - per);
  const clamped = Math.min(offset, maxOffset);
  const pageCount = Math.max(1, Math.ceil(items.length / per));
  const page = clamped >= maxOffset && maxOffset > 0 ? pageCount - 1 : Math.floor(clamped / per);

  // Fetch the next page of the row as the user approaches the end
  useEffect(() => {
    if (hasMore && clamped + per * 2 >= items.length) onNearEnd();
  }, [clamped, per, items.length, hasMore, onNearEnd]);

  const go = (dir: 1 | -1) => {
    closeHover();
    setMoved(true);
    setOffset((o) => {
      const cur = Math.min(o, maxOffset);
      if (dir === 1) return cur >= maxOffset ? 0 : Math.min(cur + per, maxOffset); // wrap to start at the end
      return cur <= 0 ? maxOffset : Math.max(cur - per, 0);
    });
  };

  const alignFor = (i: number): HoverAlign => {
    const pos = i - clamped;
    if (pos <= 0) return "left";
    if (pos >= per - 1) return "right";
    return "center";
  };

  // Touch devices: native momentum scrolling with snap, no arrows
  if (!canHover) {
    return (
      <div ref={metricsRef} className="row-metrics">
        <div
          className="scrollbar-none flex snap-x snap-mandatory scroll-px-gutter overflow-x-auto overscroll-x-contain px-gutter"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (hasMore && el.scrollLeft + el.clientWidth * 2.5 > el.scrollWidth) onNearEnd();
          }}
        >
          {items.map((card, i) => (
            <div key={card.id} className="shrink-0 snap-start px-[calc(var(--row-gap)/2)]" style={{ width: `calc(100% / ${per + 0.3})` }}>
              <TitleCardTile card={card} hoverKey={`${rowKey}:${i}`} variant={variant} preload={eager && i < per} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const translate = `translate3d(calc(${-clamped} * 100% / var(--per)), 0, 0)`;

  return (
    <div ref={metricsRef} className="row-metrics relative" style={{ overflowX: "clip" }}>
      {/* page indicator */}
      {pageCount > 1 && (
        <ol aria-hidden className="absolute -top-[1.35em] right-gutter flex gap-[2px] opacity-0 transition-opacity duration-200 group-hover/row:opacity-100">
          {Array.from({ length: pageCount }, (_, i) => (
            <li key={i} className={cn("h-[2px] w-3 transition-colors", i === page ? "bg-[#aaa]" : "bg-[#4d4d4d]")} />
          ))}
        </ol>
      )}

      <div className="relative px-gutter">
        <div
          className="flex transition-transform duration-[750ms] ease-[cubic-bezier(.5,0,.1,1)] will-change-transform motion-reduce:transition-none"
          style={{ transform: translate }}
        >
          {items.map((card, i) => {
            const visible = i >= clamped && i < clamped + per;
            const peek = i === clamped - 1 || i === clamped + per;
            return (
              <div
                key={card.id}
                className="shrink-0 px-[calc(var(--row-gap)/2)]"
                style={{ width: "calc(100% / var(--per))" }}
              >
                <TitleCardTile
                  card={card}
                  hoverKey={`${rowKey}:${i}`}
                  variant={variant}
                  align={alignFor(i)}
                  preload={eager && i < per}
                  tabIndex={visible ? 0 : -1}
                  onFocus={() => {
                    if (!visible) setOffset(Math.min(Math.floor(i / per) * per, maxOffset));
                  }}
                  className={cn(!visible && !peek && "pointer-events-none")}
                />
              </div>
            );
          })}
        </div>

        {moved && items.length > per && (
          <SliderArrow side="left" onClick={() => go(-1)} />
        )}
        {items.length > per && <SliderArrow side="right" onClick={() => go(1)} />}
      </div>
    </div>
  );
}

function SliderArrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Xem các nội dung trước" : "Xem thêm nội dung"}
      className={cn(
        "group/arrow absolute top-0 bottom-0 z-[2] flex w-[calc(var(--gutter)-var(--row-gap))] items-center justify-center bg-[#141414]/50 text-white opacity-0 transition-[opacity,background-color] duration-200 group-hover/row:opacity-100 hover:bg-[#141414]/70 focus-visible:opacity-100",
        side === "left" ? "left-0 rounded-r-[4px]" : "right-0 rounded-l-[4px]",
      )}
    >
      <Icon className="size-[70%] max-h-12 transition-transform duration-150 group-hover/arrow:scale-125" strokeWidth={2.5} />
    </button>
  );
}

export function RowSkeleton({ title, variant = "default" }: { title?: string; variant?: Variant }) {
  return (
    <section className="row-metrics my-[3vw] md:my-[2.2vw]" aria-hidden>
      <div className="mb-[0.6em] px-gutter text-[clamp(1rem,1.4vw,1.5rem)] leading-tight font-bold text-[#e5e5e5]">
        {title ?? <span className="skeleton inline-block h-[1em] w-48 rounded" />}
      </div>
      <div className="flex overflow-hidden px-gutter">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="shrink-0 px-[calc(var(--row-gap)/2)]" style={{ width: "calc(100% / var(--per))" }}>
            <div className={cn("skeleton w-full rounded-[4px]", variant === "top10" ? "aspect-[16/9]" : "aspect-video")} style={{ animationDelay: `${i * 80}ms` }} />
          </div>
        ))}
      </div>
    </section>
  );
}
