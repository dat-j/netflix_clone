"use client";

import Link from "next/link";
import { useIsClient } from "@/lib/hooks/use-media";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { useMe } from "@/lib/queries";
import { PlanCards } from "./plan-cards";

/** Plan grid with CTAs that depend on who is looking (guest / member / current plan). */
export function PlanActions() {
  const isClient = useIsClient();
  const hasHint = isClient && /(?:^|;\s*)lm_s=1/.test(document.cookie);
  const { data: me } = useMe(hasHint);
  const activePlanId = me?.subscription?.status === "ACTIVE" ? me.subscription.plan.id : null;

  return (
    <PlanCards
      action={(plan) =>
        !me ? (
          <Button asChild variant="brand" className="w-full">
            <Link href="/signup">Đăng ký</Link>
          </Button>
        ) : plan.id === activePlanId ? (
          <Button variant="outline" className="w-full" disabled>
            Gói hiện tại
          </Button>
        ) : (
          <Button asChild variant="brand" className="w-full">
            <a href={`mailto:${BRAND.supportEmail}?subject=${encodeURIComponent(`Kích hoạt gói ${plan.name}`)}&body=${encodeURIComponent(`Email tài khoản: ${me.user.email}`)}`}>
              Liên hệ để kích hoạt
            </a>
          </Button>
        )
      }
    />
  );
}
