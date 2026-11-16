import type { PlanDto, SubscriptionDto } from "@app/shared";
import type { Plan, Subscription } from "@app/db";

export function toPlanDto(p: Plan): PlanDto {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    priceAmount: p.priceAmount,
    currency: p.currency,
    intervalMonths: p.intervalMonths,
    maxHeight: p.maxHeight,
    maxConcurrentStreams: p.maxConcurrentStreams,
    maxProfiles: p.maxProfiles,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
  };
}

export function toSubscriptionDto(s: Subscription & { plan: Plan }): SubscriptionDto {
  return {
    id: s.id,
    status: s.status,
    plan: toPlanDto(s.plan),
    currentPeriodStart: s.currentPeriodStart.toISOString(),
    currentPeriodEnd: s.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    provider: s.provider,
  };
}
