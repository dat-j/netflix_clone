import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { AdminUser, Paginated, PlanDto, SubscriptionDto } from "@app/shared";
import { z } from "zod";
import { AuthGuard, CurrentUser, type RequestUser, Roles, RolesGuard } from "../../common/auth.js";
import { parseId, parseOrThrow } from "../auth/validation.js";
import { BillingService } from "../billing/billing.service.js";
import { AdminUsersService } from "./admin-users.service.js";

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const grantSchema = z.object({
  planCode: z.string().trim().min(1),
  months: z.number().int().min(1).max(120),
  note: z.string().trim().max(500).optional(),
});
const patchUserSchema = z
  .object({ disabled: z.boolean().optional(), role: z.enum(["USER", "ADMIN"]).optional() })
  .refine((v) => v.disabled !== undefined || v.role !== undefined, { message: "Không có gì để cập nhật" });

const planSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, { message: "Mã gói chỉ gồm a-z, 0-9, _ , -" }),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).nullable().optional().transform((v) => v ?? null),
  priceAmount: z.number().int().min(0),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).default("VND"),
  intervalMonths: z.number().int().min(1).max(36).default(1),
  maxHeight: z.number().int().refine((v) => [360, 480, 720, 1080, 1440, 2160].includes(v), { message: "maxHeight không hợp lệ" }),
  maxConcurrentStreams: z.number().int().min(1).max(10),
  maxProfiles: z.number().int().min(1).max(10).default(5),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
const planPatchSchema = z.object({
  code: planSchema.shape.code.optional(),
  name: planSchema.shape.name.optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  priceAmount: planSchema.shape.priceAmount.optional(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  intervalMonths: z.number().int().min(1).max(36).optional(),
  maxHeight: planSchema.shape.maxHeight.optional(),
  maxConcurrentStreams: planSchema.shape.maxConcurrentStreams.optional(),
  maxProfiles: z.number().int().min(1).max(10).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

@Controller("admin/users")
@Roles("ADMIN")
@UseGuards(AuthGuard, RolesGuard)
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly billing: BillingService,
  ) {}

  @Get()
  list(@Query() query: unknown): Promise<Paginated<AdminUser>> {
    const { q, page, pageSize } = parseOrThrow(listQuery, query);
    return this.users.list(q || undefined, page, pageSize);
  }

  @Patch(":id")
  update(@CurrentUser() actor: RequestUser, @Param("id") id: string, @Body() body: unknown): Promise<AdminUser> {
    return this.users.update(actor.id, parseId(id), parseOrThrow(patchUserSchema, body));
  }

  @Post(":id/subscription")
  @HttpCode(200)
  grant(@Param("id") id: string, @Body() body: unknown): Promise<SubscriptionDto> {
    const { planCode, months, note } = parseOrThrow(grantSchema, body);
    return this.billing.grant(parseId(id), planCode, months, note);
  }

  @Delete(":id/subscription")
  @HttpCode(204)
  async revoke(@Param("id") id: string): Promise<void> {
    await this.billing.revoke(parseId(id));
  }
}

@Controller("admin/plans")
@Roles("ADMIN")
@UseGuards(AuthGuard, RolesGuard)
export class AdminPlansController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  list(): Promise<PlanDto[]> {
    return this.billing.listPlans(true);
  }

  @Post()
  create(@Body() body: unknown): Promise<PlanDto> {
    return this.billing.createPlan(parseOrThrow(planSchema, body));
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: unknown): Promise<PlanDto> {
    return this.billing.updatePlan(parseId(id), parseOrThrow(planPatchSchema, body));
  }
}
