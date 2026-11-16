import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchPage } from "@/components/browse/collection-pages";
import { TitleGridSkeleton } from "@/components/browse/title-grid";

export const metadata: Metadata = { title: "Tìm kiếm" };

export default function Page() {
  return (
    <Suspense fallback={<TitleGridSkeleton className="pt-[calc(var(--header-h)+6rem)]" />}>
      <SearchPage />
    </Suspense>
  );
}
