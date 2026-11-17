import type { Metadata } from "next";
import { Suspense } from "react";
import { LogoLink } from "@/components/brand/logo";
import { PaymentResult } from "@/components/landing/payment-result";
import { SiteFooter } from "@/components/layout/site-footer";

export const metadata: Metadata = { title: "Kết quả thanh toán", robots: { index: false, follow: false } };

export default async function PaymentResultPage({
  searchParams,
}: {
  searchParams: Promise<{ paymentId?: string }>;
}) {
  const { paymentId } = await searchParams;
  return (
    <div className="min-h-dvh bg-bg">
      <header className="flex h-header items-center border-b border-white/10 px-gutter"><LogoLink /></header>
      <Suspense fallback={<main className="min-h-[70dvh]" />}>
        <PaymentResult paymentId={paymentId} />
      </Suspense>
      <SiteFooter compact />
    </div>
  );
}
