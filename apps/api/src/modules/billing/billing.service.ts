import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { CheckoutResponse, PaymentDto, PlanDto, PlanInput, SubscriptionDto } from "@app/shared";
import type { Plan, Prisma, Subscription } from "@app/db";
import { ApiException } from "../../common/api-exception.js";
import { PrismaService } from "../../infra/prisma.service.js";
import { toPlanDto, toSubscriptionDto } from "./mappers.js";
import { PAYMENT_PROVIDERS, type PaymentProvider, type WebhookRequest, paymentAmount } from "./payment-provider.js";

export const DEFAULT_MAX_PROFILES = 5;
const EXPIRE_INTERVAL_MS = 5 * 60_000;
const PENDING_PAYMENT_TTL_MS = 30 * 60_000;
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

  /** Xử lý webhook trong một transaction; updateMany(status=PENDING) bảo đảm idempotency khi provider retry song song. */
  async handleWebhook(providerCode: string, req: WebhookRequest): Promise<void> {
    const result = await this.getProvider(providerCode).handleWebhook(req);
    const payment = await this.prisma.payment.findUnique({ where: { id: result.paymentId } });
    if (!payment) return;
    if (result.amount !== undefined && result.amount !== payment.amount) {
      throw new ApiException(400, "PAYMENT_AMOUNT_MISMATCH", "Số tiền thanh toán không khớp");
    }
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: {
          status: result.status,
          paidAt: result.status === "SUCCEEDED" ? now : null,
          rawPayload: { ...(payment.rawPayload as Record<string, unknown> | null), webhook: result.rawPayload as object },
        },
      });
      if (!claimed.count || result.status !== "SUCCEEDED") return;
      const months = Number((payment.rawPayload as { months?: number } | null)?.months ?? 1);
      const plan = await tx.plan.findUniqueOrThrow({ where: { id: payment.planId } });
      const sub = await this.extendSubscriptionInTransaction(tx, payment.userId, plan, months, providerCode, result.providerRef, null);
      await tx.payment.update({ where: { id: payment.id }, data: { subscriptionId: sub.id } });
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
    const stalePayments = await this.prisma.payment.updateMany({
      where: { status: "PENDING", createdAt: { lte: new Date(now.getTime() - PENDING_PAYMENT_TTL_MS) } },
      data: { status: "FAILED" },
    });
    if (count) this.logger.log(`Đã chuyển ${count} thuê bao sang EXPIRED`);
    if (stalePayments.count) this.logger.log(`Đã đóng ${stalePayments.count} giao dịch quá hạn`);
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
  private async extendSubscriptionInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    plan: Plan,
    months: number,
    provider: string,
    providerRef: string | null,
    note: string | null,
  ): Promise<SubWithPlan> {
    // Serialize subscription extensions for one account so concurrent successful payments cannot overwrite each other.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
    const now = new Date();
    const current = await tx.subscription.findFirst({
      where: { userId, status: "ACTIVE", currentPeriodEnd: { gt: now } },
      orderBy: { currentPeriodEnd: "desc" },
    });
    if (current) {
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
  }

  private extendSubscription(
    userId: string, plan: Plan, months: number, provider: string, providerRef: string | null, note: string | null,
  ): Promise<SubWithPlan> {
    return this.prisma.$transaction((tx) =>
      this.extendSubscriptionInTransaction(tx, userId, plan, months, provider, providerRef, note),
    );
  }

  async createCheckout(userId: string, planId: string, requestedMonths?: number): Promise<CheckoutResponse> {
    const plan = await this.prisma.plan.findFirst({ where: { id: planId, isActive: true } });
    if (!plan) throw new ApiException(404, "NOT_FOUND", "Gói này hiện không mở bán");
    const months = requestedMonths ?? plan.intervalMonths;
    if (!Number.isInteger(months) || months < plan.intervalMonths || months > 12 || months % plan.intervalMonths !== 0) {
      throw new ApiException(400, "VALIDATION", "Thời hạn thanh toán không hợp lệ");
    }
    if (plan.currency !== "VND") throw new ApiException(400, "VALIDATION", "Cổng payOS hiện chỉ hỗ trợ gói VND");
    const baseUrl = (process.env.PUBLIC_WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const returnUrl = new URL("/payment/result", baseUrl);
    const cancelUrl = new URL("/plans", baseUrl);
    cancelUrl.searchParams.set("payment", "cancelled");
    const result = await this.getProvider("payos").createCheckout({
      userId, plan, months, returnUrl: returnUrl.toString(), cancelUrl: cancelUrl.toString(),
    });
    return result;
  }

  async listPayments(userId: string): Promise<PaymentDto[]> {
    const rows = await this.prisma.payment.findMany({
      where: { userId },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return rows.map((p) => ({
      id: p.id, plan: toPlanDto(p.plan), amount: p.amount, currency: p.currency,
      status: p.status, provider: p.provider, paidAt: p.paidAt?.toISOString() ?? null, createdAt: p.createdAt.toISOString(),
    }));
  }

  async getPayment(userId: string, id: string): Promise<PaymentDto> {
    const p = await this.prisma.payment.findFirst({ where: { id, userId }, include: { plan: true } });
    if (!p) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy giao dịch");
    return {
      id: p.id, plan: toPlanDto(p.plan), amount: p.amount, currency: p.currency,
      status: p.status, provider: p.provider, paidAt: p.paidAt?.toISOString() ?? null, createdAt: p.createdAt.toISOString(),
    };
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
