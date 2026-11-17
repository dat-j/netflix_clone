"use client";

import { CircleAlert, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/messages";
import { useMe } from "@/lib/queries";

export function ErrorPanel({ error, onRetry, title = "Không tải được nội dung" }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
      <CircleAlert className="mb-4 size-12 text-white/40" aria-hidden />
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="mt-2 text-white/60">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" className="mt-6" onClick={onRetry}>
          Thử lại
        </Button>
      )}
    </div>
  );
}

export function EmptyPanel({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-20 text-center">
      {icon && <div className="mb-5 text-white/30">{icon}</div>}
      <h2 className="text-xl font-bold md:text-2xl">{title}</h2>
      {children && <div className="mt-2 text-white/60">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Upsell banner: tài khoản miễn phí vẫn xem được nội dung ở tối đa 720p. */
export function SubscriptionBanner() {
  const { data: me } = useMe();
  if (!me || me.subscription?.status === "ACTIVE") return null;
  const expired = !!me.subscription;
  return (
    <div className="relative z-[1] mx-gutter mb-2 flex flex-col gap-3 rounded-md border border-white/10 bg-gradient-to-r from-brand/20 via-[#1f1f1f] to-[#1f1f1f] p-4 sm:flex-row sm:items-center md:p-5" data-testid="free-plan-banner">
      <Sparkles className="size-6 shrink-0 text-brand" aria-hidden />
      <div className="flex-1">
        <p className="font-bold">{expired ? "Gói thành viên của bạn đã kết thúc" : "Bạn đang dùng Lumio miễn phí"}</p>
        <p className="text-sm text-white/70">Tiếp tục xem phim miễn phí ở tối đa 720p trên một thiết bị. Nâng cấp để mở khóa chất lượng cao hơn và nhiều luồng xem hơn.</p>
      </div>
      <Button asChild variant="brand" size="md">
        <Link href="/plans">Nâng cấp gói</Link>
      </Button>
    </div>
  );
}
