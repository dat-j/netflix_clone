import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import type { PlanDto, SubscriptionDto, PaymentDto, CheckoutResponse } from "@app/shared";
import { z } from "zod";
import { AuthGuard, CurrentUser, type RequestUser } from "../../common/auth.js";
import { ApiException } from "../../common/api-exception.js";
import { BillingService } from "./billing.service.js";

const checkoutSchema = z.object({
  planId: z.string().uuid(),
  months: z.number().int().min(1).max(12).optional(),
});

@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get("plans")
  plans(): Promise<PlanDto[]> {
    return this.billing.listPlans(false);
  }

  @Get("subscription")
  @UseGuards(AuthGuard)
  async subscription(@CurrentUser() user: RequestUser, @Res() res: Response): Promise<void> {
    const sub: SubscriptionDto | null = await this.billing.getCurrentSubscription(user.id);
    res.status(200).json(sub);
  }

  @Post("billing/checkout")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async checkout(@CurrentUser() user: RequestUser, @Body() body: unknown): Promise<CheckoutResponse> {
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) throw new ApiException(400, "VALIDATION", "Thông tin chọn gói không hợp lệ");
    return this.billing.createCheckout(user.id, parsed.data.planId, parsed.data.months);
  }

  @Get("billing/payments")
  @UseGuards(AuthGuard)
  payments(@CurrentUser() user: RequestUser): Promise<PaymentDto[]> {
    return this.billing.listPayments(user.id);
  }

  @Get("billing/payments/:id")
  @UseGuards(AuthGuard)
  payment(@CurrentUser() user: RequestUser, @Param("id") id: string): Promise<PaymentDto> {
    return this.billing.getPayment(user.id, id);
  }
}

@Controller("webhooks")
export class PaymentWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Post("payos")
  @HttpCode(200)
  async payos(@Body() body: unknown): Promise<{ received: true }> {
    await this.billing.handleWebhook("payos", { headers: {}, body });
    return { received: true };
  }
}
