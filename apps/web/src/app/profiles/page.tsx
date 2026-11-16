import type { Metadata } from "next";
import { Suspense } from "react";
import { LogoLink } from "@/components/brand/logo";
import { ProfileGate } from "@/components/profiles/profile-gate";
import { PageSpinner } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Ai đang xem?" };

export default function ProfilesPage() {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="flex h-header items-center px-gutter">
        <LogoLink href="/profiles" />
      </header>
      <Suspense fallback={<PageSpinner className="min-h-[70dvh]" />}>
        <ProfileGate />
      </Suspense>
    </div>
  );
}
