"use client";

import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useIsClient } from "@/lib/hooks/use-media";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/messages";
import { useMe } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { CheckoutResponse, PlanDto } from "@app/shared";
import { PlanCards } from "./plan-cards";

/** Checkout luôn được khởi tạo ở server; client chỉ nhận URL chuyển hướng đã tạo. */
export function PlanActions() {
  const isClient = useIsClient();
  const hasHint = isClient && /(?:^|;\\s*)lm_s=1/.test(document.cookie);
  const { data: me } = useMe(hasHint);
  const activePlanId = me?.subscription?.status === "ACTIVE" ? me.subscription.plan.id : null;
  const checkout = useMutation({
    mutationFn: (plan: PlanDto) =>
      api<CheckoutResponse>("/billing/checkout", {
        method: "POST",
        body: { planId: plan.id, months: plan.intervalMonths },
      }),
    onSuccess: (result) => {
      if (result.redirectUrl) window.location.assign(result.redirectUrl);
      else toast({ message: result.instructions ?? "Đã tạo yêu cầu thanh toán" });
    },
    onError: (error) => toast({ message: errorMessage(error), tone: "error" }),
  });

  return (
    <PlanCards
      action={(plan) => {
        if (!me) {
          return (
            <Button asChild variant="brand" className="w-full">
              <Link href="/signup">Đăng ký tài khoản</Link>
            </Button>
          );
        }
        if (plan.id === activePlanId) {
          return (
            <Button variant="outline" className="w-full" disabled>
              Gói hiện tại
            </Button>
          );
        }
        return (
          <Button
            variant="brand"
            className="w-full"
            loading={checkout.isPending}
            disabled={checkout.isPending}
            onClick={() => checkout.mutate(plan)}
          >
            Chọn gói & thanh toán
          </Button>
        );
      }}
    />
  );
}
