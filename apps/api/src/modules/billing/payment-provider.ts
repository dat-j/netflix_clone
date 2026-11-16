/**
 * Cổng thanh toán cắm được. MVP chỉ có `ManualProvider` (admin kích hoạt tay);
 * PayOS / VNPay / MoMo / Stripe sẽ implement cùng interface rồi đăng ký vào `PAYMENT_PROVIDERS`.
 *
 * Luồng chuẩn:
 *   1. createCheckout → tạo Payment PENDING, trả URL/hướng dẫn thanh toán cho client.
 *   2. Cổng gọi webhook → handleWebhook xác thực chữ ký, trả về kết quả chuẩn hóa.
 *   3. BillingService.applyPaymentResult đánh dấu Payment SUCCEEDED và gia hạn Subscription.
 */
import { Injectable } from "@nestjs/common";
import type { Plan } from "@app/db";
import { ApiException } from "../../common/api-exception.js";
import { PrismaService } from "../../infra/prisma.service.js";

export interface CheckoutInput {
  userId: string;
  plan: Plan;
  months: number;
  returnUrl?: string;
}

export interface CheckoutResult {
  paymentId: string;
  provider: string;
  /** URL chuyển hướng tới trang thanh toán của cổng (null với manual) */
  redirectUrl: string | null;
  /** Hướng dẫn hiển thị cho người dùng (vd. chuyển khoản thủ công) */
  instructions: string | null;
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  rawBody?: Buffer;
}

export interface WebhookResult {
  /** Payment.providerRef hoặc Payment.id đã được cổng xác nhận */
  paymentId: string;
  providerRef: string | null;
  status: "SUCCEEDED" | "FAILED";
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
        userId: input.userId,
        planId: input.plan.id,
        provider: this.code,
        amount: paymentAmount(input.plan, input.months),
        currency: input.plan.currency,
        status: "PENDING",
        rawPayload: { months: input.months },
      },
    });
    return {
      paymentId: payment.id,
      provider: this.code,
      redirectUrl: null,
      instructions: "Liên hệ quản trị viên để kích hoạt gói sau khi thanh toán.",
    };
  }

  handleWebhook(_req: WebhookRequest): Promise<WebhookResult> {
    // Manual không có webhook — admin kích hoạt qua /admin/users/:id/subscription.
    return Promise.reject(new ApiException(404, "NOT_FOUND", "Provider manual không hỗ trợ webhook"));
  }
}
