import { Suspense } from "react";
import { TitleEditorRoute } from "@/components/admin/sections/title-editor-route";

// Trang admin là SPA phía client sau cổng xác thực (/auth/me) — không cần xác thực điều hướng tức thì.
export const instant = false;

export default function Page({ params }: PageProps<"/admin/titles/[id]">) {
  return (
    <Suspense fallback={null}>
      <TitleEditorRoute params={params} />
    </Suspense>
  );
}
