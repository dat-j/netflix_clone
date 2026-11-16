import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSpinner } from "@/components/ui/spinner";
import { DetailPageFromParams } from "@/components/title/detail-route";

export const metadata: Metadata = { title: "Chi tiết" };

export default function TitlePage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<PageSpinner className="pt-header" />}>
      <DetailPageFromParams params={params} />
    </Suspense>
  );
}
