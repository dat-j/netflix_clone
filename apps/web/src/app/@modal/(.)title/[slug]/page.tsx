import { Suspense } from "react";
import { DetailModalFromParams } from "@/components/title/detail-route";

export default function InterceptedTitle({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={null}>
      <DetailModalFromParams params={params} />
    </Suspense>
  );
}
