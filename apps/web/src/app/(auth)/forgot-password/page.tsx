import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/auth/auth-forms";
import { PageSpinner } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Quên mật khẩu" };

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner className="min-h-80" />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
