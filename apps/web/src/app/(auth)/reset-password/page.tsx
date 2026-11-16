import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/auth-forms";
import { PageSpinner } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Đặt lại mật khẩu" };

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner className="min-h-80" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
