import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmail } from "@/components/auth/auth-forms";
import { PageSpinner } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Xác minh email" };

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner className="min-h-80" />}>
      <VerifyEmail />
    </Suspense>
  );
}
