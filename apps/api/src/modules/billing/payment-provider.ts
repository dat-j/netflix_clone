/**
 * Provider thanh toán có thể thay thế độc lập. Chỉ webhook đã xác minh mới kích hoạt subscription.
 */
import { Injectable } from "@nestjs/common";
import type { Plan } from "@app/db";
import { ApiException } from "../../common/api-exception.js";
import { PrismaService } from "../../infra/prisma.service.js";

export interface CheckoutInput {
  userId: string;
  plan: Plan;
  months: number;
  returnUrl: string;
  cancelUrl?: string;
}
export interface CheckoutResult {
  paymentId: string;
  provider: string;
  redirectUrl: string | null;
  instructions: string | null;
}
export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  rawBody?: Buffer;
}
export interface WebhookResult {
  paymentId: string;
  providerRef: string | null;
  status: "SUCCEEDED" | "FAILED";
  amount?: number;
  rawPayload: unknown;
}
export interface PaymentProvider {
  readonly code: string;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  handleWebhook(req: WebhookRequest): Promise<WebhookResult>;
}
export const PAYMENT_PROVIDERS = Symbol("PAYMENT_PROVIDERS");

export function paymentAmount(plan: Plan, months: number): number {
  return Math.round((plan.priceAmount * months) / Math.max(1, plan.intervalMonths));
}

@Injectable()
export class ManualProvider implements PaymentProvider {
  readonly code = "manual";
  constructor(private readonly prisma: PrismaService) {}

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const payment = await this.prisma.payment.create({
      data: {
        userId: input.userId, planId: input.plan.id, provider: this.code,
        amount: paymentAmount(input.plan, input.months), currency: input.plan.currency,
        status: "PENDING", rawPayload: { months: input.months },
      },
    });
    return {
      paymentId: payment.id, provider: this.code, redirectUrl: null,
      instructions: "Liên hệ quản trị viên để kích hoạt gói sau khi thanh toán.",
    };
  }

  handleWebhook(_req: WebhookRequest): Promise<WebhookResult> {
    return Promise.reject(new ApiException(404, "NOT_FOUND", "Provider manual không hỗ trợ webhook"));
  }
}
