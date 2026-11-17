import { randomInt } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { PayOS, type Webhook } from "@payos/node";
import { ApiException } from "../../common/api-exception.js";
import { PrismaService } from "../../infra/prisma.service.js";
import type { CheckoutInput, CheckoutResult, PaymentProvider, WebhookRequest, WebhookResult } from "./payment-provider.js";
import { paymentAmount } from "./payment-provider.js";

@Injectable()
export class PayOSProvider implements PaymentProvider {
  readonly code = "payos";
  private readonly logger = new Logger("PayOSProvider");

  constructor(private readonly prisma: PrismaService) {}

  private credentials() {
    const clientId = process.env.PAYOS_CLIENT_ID?.trim();
    const apiKey = process.env.PAYOS_API_KEY?.trim();
    const checksumKey = process.env.PAYOS_CHECKSUM_KEY?.trim();
    if (!clientId || !apiKey || !checksumKey) {
      throw new ApiException(503, "PAYMENT_UNAVAILABLE", "Cổng thanh toán chưa được cấu hình");
    }
    return { clientId, apiKey, checksumKey };
  }

  private client() {
    return new PayOS({ ...this.credentials(), logLevel: "error", maxRetries: 1 });
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const credentials = this.credentials();
    const orderCode = randomInt(100_000_000, 999_999_999);
    const amount = paymentAmount(input.plan, input.months);
    if (!Number.isSafeInteger(amount) || amount < 1_000) {
      throw new ApiException(400, "VALIDATION", "Số tiền thanh toán không hợp lệ");
    }

    const payment = await this.prisma.payment.create({
      data: {
        userId: input.userId,
        planId: input.plan.id,
        provider: this.code,
        providerRef: String(orderCode),
        amount,
        currency: input.plan.currency,
        status: "PENDING",
        rawPayload: { months: input.months, orderCode },
      },
    });

    try {
      const client = new PayOS({ ...credentials, logLevel: "error", maxRetries: 1 });
      const checkout = await client.paymentRequests.create({
        orderCode,
        amount,
        description: `LUMIO ${orderCode}`,
        items: [{ name: input.plan.name.slice(0, 50), quantity: 1, price: amount }],
        expiredAt: Math.floor(Date.now() / 1000) + 30 * 60,
        returnUrl: input.returnUrl,
        cancelUrl: input.cancelUrl ?? input.returnUrl,
      });
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { rawPayload: { months: input.months, orderCode, paymentLinkId: checkout.paymentLinkId } },
      });
      return {
        paymentId: payment.id,
        provider: this.code,
        redirectUrl: checkout.checkoutUrl,
        instructions: null,
      };
    } catch (error) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } }).catch(() => undefined);
      this.logger.error(`Tạo link payOS thất bại cho payment ${payment.id}: ${error instanceof Error ? error.message : String(error)}`);
      throw new ApiException(502, "PAYMENT_PROVIDER_ERROR", "Không thể tạo link thanh toán. Vui lòng thử lại sau.");
    }
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookResult> {
    let data;
    try {
      data = await this.client().webhooks.verify(req.body as Webhook);
    } catch {
      throw new ApiException(400, "PAYMENT_SIGNATURE_INVALID", "Chữ ký webhook payOS không hợp lệ");
    }

    const payment = await this.prisma.payment.findFirst({
      where: { provider: this.code, providerRef: String(data.orderCode) },
      select: { id: true, amount: true, status: true },
    });
    if (!payment) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy giao dịch thanh toán");
    if (payment.amount !== data.amount) {
      throw new ApiException(400, "PAYMENT_AMOUNT_MISMATCH", "Số tiền webhook không khớp giao dịch");
    }
    return {
      paymentId: payment.id,
      providerRef: data.reference || data.paymentLinkId || String(data.orderCode),
      status: data.code === "00" ? "SUCCEEDED" : "FAILED",
      amount: data.amount,
      rawPayload: data,
    };
  }
}
