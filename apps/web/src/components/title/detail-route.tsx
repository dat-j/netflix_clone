"use client";

import { use } from "react";
import { DetailModal } from "./detail-modal";
import { DetailView } from "./detail-view";

export function DetailModalFromParams({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <DetailModal slug={decodeURIComponent(slug)} />;
}

/** Direct load / refresh of /title/[slug]: full page with the same content as the modal. */
export function DetailPageFromParams({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return (
    <div className="pt-[calc(var(--header-h)+1rem)] md:pt-[calc(var(--header-h)+2rem)]">
      <div className="mx-auto w-full max-w-[1000px] overflow-hidden bg-elevated md:rounded-lg md:shadow-2xl md:shadow-black/60">
        <DetailView idOrSlug={decodeURIComponent(slug)} mode="page" />
      </div>
    </div>
  );
}
