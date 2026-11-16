"use client";

import type { PlanDto } from "@app/shared";
import { Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/messages";
import { usePlans } from "@/lib/queries";
import { cn, formatPrice, qualityLabel } from "@/lib/utils";

const GRADIENTS = [
  "from-[#2b3a67] to-[#0f1a3d]",
  "from-[#7a2a8f] to-[#2b1a6b]",
  "from-[#ff5a3c] to-[#8f1d3d]",
  "from-[#c48a12] to-[#6b2b11]",
];

function resolution(h: number) {
  if (h >= 2160) return "4K (Ultra HD)";
  if (h >= 1080) return "1080p";
  if (h >= 720) return "720p";
  return `${h}p`;
}

export function usePlanSummary() {
  const { data } = usePlans();
  const active = (data ?? []).filter((p) => p.isActive);
  const cheapest = active.reduce<PlanDto | null>((min, p) => (!min || p.priceAmount < min.priceAmount ? p : min), null);
  return { cheapest };
}

export function PlanPriceTeaser() {
  const { cheapest } = usePlanSummary();
  return (
    <span className="inline-block min-h-[1.5em]">
      {cheapest ? `Giá chỉ từ ${formatPrice(cheapest.priceAmount, cheapest.currency)}/tháng. Hủy bất kỳ lúc nào.` : "Xem mọi lúc, mọi nơi. Hủy bất kỳ lúc nào."}
    </span>
  );
}

export function PlanCards({ action }: { action?: (plan: PlanDto) => React.ReactNode }) {
  const { data, isPending, error } = usePlans();

  if (isPending) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[26rem] w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (error) return <p className="text-white/60">{errorMessage(error)}</p>;

  const plans = data.filter((p) => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  if (plans.length === 0) return <p className="text-white/60">Hiện chưa có gói nào được mở bán.</p>;
  const popularIdx = plans.length >= 3 ? 1 : -1;

  return (
    <ul className={cn("grid gap-4", plans.length >= 4 ? "md:grid-cols-2 xl:grid-cols-4" : plans.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2")} data-testid="plan-cards">
      {plans.map((p, i) => (
        <li
          key={p.id}
          className={cn(
            "relative flex flex-col overflow-hidden rounded-xl border bg-[#141414] p-2 transition-transform duration-300 hover:-translate-y-1",
            i === popularIdx ? "border-brand/70 shadow-[0_0_0_1px_var(--brand),0_20px_60px_-20px_rgb(255_90_60/0.5)]" : "border-white/15",
          )}
        >
          <div className={cn("relative rounded-lg bg-gradient-to-br p-5 pb-6", GRADIENTS[i % GRADIENTS.length])}>
            {i === popularIdx && (
              <span className="absolute top-0 right-0 rounded-bl-lg rounded-tr-lg bg-white/90 px-3 py-1 text-[0.7rem] font-bold text-black">Phổ biến nhất</span>
            )}
            <h3 className="text-2xl font-bold">{p.name}</h3>
            <p className="mt-0.5 font-semibold text-white/80">{resolution(p.maxHeight)}</p>
          </div>
          <dl className="grid flex-1 grid-cols-2 gap-x-4 px-4 py-2 text-sm md:grid-cols-1 md:divide-y md:divide-white/10 [&>div]:border-white/10 max-md:[&>div]:border-b">
            <Row label={p.intervalMonths > 1 ? `Giá ${p.intervalMonths} tháng` : "Giá hàng tháng"} value={formatPrice(p.priceAmount, p.currency)} />
            <Row label="Chất lượng video" value={qualityLabel(p.maxHeight) ?? "-"} />
            <Row label="Độ phân giải" value={resolution(p.maxHeight)} />
            <Row label="Thiết bị xem cùng lúc" value={`${p.maxConcurrentStreams}`} />
            <Row label="Số hồ sơ" value={`${p.maxProfiles}`} />
          </dl>
          {p.description && (
            <p className="flex items-start gap-2 px-4 pb-3 text-[0.8125rem] text-white/60">
              <Check className="mt-0.5 size-4 shrink-0 text-success" />
              {p.description}
            </p>
          )}
          {action && <div className="px-4 pt-1 pb-4">{action(p)}</div>}
        </li>
      ))}
    </ul>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-3">
      <dt className="text-[0.8rem] text-white/55">{label}</dt>
      <dd className="mt-0.5 font-semibold text-white/95">{value}</dd>
    </div>
  );
}
