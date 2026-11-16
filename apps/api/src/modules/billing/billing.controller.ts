import { Controller, Get, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import type { PlanDto, SubscriptionDto } from "@app/shared";
import { AuthGuard, CurrentUser, type RequestUser } from "../../common/auth.js";
import { BillingService } from "./billing.service.js";

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
    // Gửi tường minh để `null` thành body JSON `null` (Nest bỏ trống body khi handler trả null).
    const sub: SubscriptionDto | null = await this.billing.getCurrentSubscription(user.id);
    res.status(200).json(sub);
  }
}
