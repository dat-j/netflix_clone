import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminApp, AdminBootScreen } from "@/components/admin/shell";

export const metadata: Metadata = {
  title: "Quản trị · Lumio",
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<AdminBootScreen />}>
      <AdminApp>{children}</AdminApp>
    </Suspense>
  );
}
