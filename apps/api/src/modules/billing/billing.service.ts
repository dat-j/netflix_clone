import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { PlanDto, PlanInput, SubscriptionDto } from "@app/shared";
import type { Plan, Subscription } from "@app/db";
import { ApiException } from "../../common/api-exception.js";
import { PrismaService } from "../../infra/prisma.service.js";
import { toPlanDto, toSubscriptionDto } from "./mappers.js";
import { PAYMENT_PROVIDERS, type PaymentProvider, type WebhookRequest, paymentAmount } from "./payment-provider.js";

export const DEFAULT_MAX_PROFILES = 5;
const EXPIRE_INTERVAL_MS = 5 * 60_000;
/** Không chạy updateMany hết hạn quá thường xuyên khi gọi lazy. */
const LAZY_EXPIRE_MIN_GAP_MS = 30_000;

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, daysInMonth));
  return d;
}

type SubWithPlan = Subscription & { plan: Plan };

@Injectable()
export class BillingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("BillingService");
  private timer: NodeJS.Timeout | null = null;
  private lastExpireRun = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProvider[],
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.expireDue().catch((e: unknown) => this.logger.warn(`expireDue lỗi: ${String(e)}`));
    }, EXPIRE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ───────── provider ─────────
  getProvider(code: string): PaymentProvider {
    const p = this.providers.find((x) => x.code === code);
    if (!p) throw new ApiException(404, "NOT_FOUND", `Không có cổng thanh toán ${code}`);
    return p;
  }

  /** Điểm vào cho webhook của cổng thật (chưa mở route ở MVP). */
  async handleWebhook(providerCode: string, req: WebhookRequest): Promise<void> {
    const result = await this.getProvider(providerCode).handleWebhook(req);
    const payment = await this.prisma.payment.findUnique({ where: { id: result.paymentId } });
    if (!payment || payment.status !== "PENDING") return; // idempotent
    if (result.status === "FAILED") {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", providerRef: result.providerRef, rawPayload: result.rawPayload as object },
      });
      return;
    }
    const months = Number((payment.rawPayload as { months?: number } | null)?.months ?? 1);
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: payment.planId } });
    const sub = await this.extendSubscription(payment.userId, plan, months, providerCode, result.providerRef, null);
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "SUCCEEDED", paidAt: new Date(), subscriptionId: sub.id,
        providerRef: result.providerRef, rawPayload: result.rawPayload as object,
      },
    });
  }

  // ───────── plans ─────────
  async listPlans(includeInactive = false): Promise<PlanDto[]> {
    const plans = await this.prisma.plan.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { priceAmount: "asc" }],
    });
    return plans.map(toPlanDto);
  }

  async createPlan(input: PlanInput): Promise<PlanDto> {
    const exists = await this.prisma.plan.findUnique({ where: { code: input.code } });
    if (exists) throw new ApiException(409, "CONFLICT", "Mã gói đã tồn tại");
    return toPlanDto(await this.prisma.plan.create({ data: input }));
  }

  async updatePlan(id: string, input: Partial<PlanInput>): Promise<PlanDto> {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy gói");
    if (input.code && input.code !== plan.code) {
      const exists = await this.prisma.plan.findUnique({ where: { code: input.code } });
      if (exists) throw new ApiException(409, "CONFLICT", "Mã gói đã tồn tại");
    }
    return toPlanDto(await this.prisma.plan.update({ where: { id }, data: input }));
  }

  // ───────── subscriptions ─────────
  /** Chuyển ACTIVE → EXPIRED cho các thuê bao đã quá currentPeriodEnd. */
  async expireDue(now = new Date()): Promise<number> {
    this.lastExpireRun = now.getTime();
    const { count } = await this.prisma.subscription.updateMany({
      where: { status: "ACTIVE", currentPeriodEnd: { lte: now } },
      data: { status: "EXPIRED" },
    });
    if (count) this.logger.log(`Đã chuyển ${count} thuê bao sang EXPIRED`);
    return count;
  }

  async expireLazily(): Promise<void> {
    if (Date.now() - this.lastExpireRun > LAZY_EXPIRE_MIN_GAP_MS) await this.expireDue();
  }

  async getActiveSubscription(userId: string): Promise<SubWithPlan | null> {
    return this.prisma.subscription.findFirst({
      where: { userId, status: "ACTIVE", currentPeriodEnd: { gt: new Date() } },
      orderBy: { currentPeriodEnd: "desc" },
      include: { plan: true },
    });
  }

  /**
   * Thuê bao để hiển thị: bản ACTIVE còn hạn nếu có, ngược lại bản gần nhất (EXPIRED/CANCELED…)
   * để UI hiện "đã hết hạn"; null nếu chưa từng có.
   */
  async getCurrentSubscription(userId: string): Promise<SubscriptionDto | null> {
    await this.expireLazily();
    const active = await this.getActiveSubscription(userId);
    if (active) return toSubscriptionDto(active);
    const latest = await this.prisma.subscription.findFirst({
      where: { userId },
      orderBy: [{ currentPeriodEnd: "desc" }, { createdAt: "desc" }],
      include: { plan: true },
    });
    return latest ? toSubscriptionDto(latest) : null;
  }

  async maxProfilesFor(userId: string): Promise<number> {
    const sub = await this.getActiveSubscription(userId);
    return sub?.plan.maxProfiles ?? DEFAULT_MAX_PROFILES;
  }

  /**
   * Gia hạn/kích hoạt: nếu đang có thuê bao ACTIVE còn hạn thì cộng thêm từ currentPeriodEnd
   * (đổi sang gói mới nếu khác), ngược lại tạo thuê bao mới bắt đầu từ bây giờ.
   */
  private async extendSubscription(
    userId: string, plan: Plan, months: number, provider: string, providerRef: string | null, note: string | null,
  ): Promise<SubWithPlan> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const current = await tx.subscription.findFirst({
        where: { userId, status: "ACTIVE", currentPeriodEnd: { gt: now } },
        orderBy: { currentPeriodEnd: "desc" },
      });
      if (current) {
        // Chỉ giữ một thuê bao ACTIVE.
        await tx.subscription.updateMany({
          where: { userId, status: "ACTIVE", id: { not: current.id } },
          data: { status: "CANCELED", currentPeriodEnd: now },
        });
        return tx.subscription.update({
          where: { id: current.id },
          data: {
            planId: plan.id,
            currentPeriodEnd: addMonths(current.currentPeriodEnd, months),
            cancelAtPeriodEnd: false,
            provider,
            providerRef,
            note: note ?? current.note,
          },
          include: { plan: true },
        });
      }
      await tx.subscription.updateMany({ where: { userId, status: "ACTIVE" }, data: { status: "EXPIRED" } });
      return tx.subscription.create({
        data: {
          userId, planId: plan.id, status: "ACTIVE", currentPeriodStart: now,
          currentPeriodEnd: addMonths(now, months), provider, providerRef, note,
        },
        include: { plan: true },
      });
    });
  }

  /** Admin cấp/gia hạn thủ công (ManualProvider), ghi Payment SUCCEEDED để có lịch sử. */
  async grant(userId: string, planCode: string, months: number, note?: string): Promise<SubscriptionDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy người dùng");
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy gói");
    const provider = this.getProvider("manual");
    const sub = await this.extendSubscription(userId, plan, months, provider.code, null, note ?? null);
    await this.prisma.payment.create({
      data: {
        userId, planId: plan.id, subscriptionId: sub.id, provider: provider.code,
        amount: paymentAmount(plan, months), currency: plan.currency, status: "SUCCEEDED",
        paidAt: new Date(), rawPayload: { months, note: note ?? null, grantedBy: "admin" },
      },
    });
    return toSubscriptionDto(sub);
  }

  /** Thu hồi ngay mọi thuê bao ACTIVE. */
  async revoke(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy người dùng");
    await this.prisma.subscription.updateMany({
      where: { userId, status: "ACTIVE" },
      data: { status: "CANCELED", currentPeriodEnd: new Date() },
    });
  }
}
