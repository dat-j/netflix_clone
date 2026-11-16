import type { Metadata } from "next";
import { Suspense } from "react";
import { GenrePage } from "@/components/browse/collection-pages";
import { TitleGridSkeleton } from "@/components/browse/title-grid";

export const metadata: Metadata = { title: "Thể loại" };

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<TitleGridSkeleton className="pt-[calc(var(--header-h)+6rem)]" />}>
      <GenrePage params={params} />
    </Suspense>
  );
}
