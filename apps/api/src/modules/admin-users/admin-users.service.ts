import { Injectable } from "@nestjs/common";
import type { AdminUser, Paginated, UserRole } from "@app/shared";
import type { Plan, Prisma, Subscription, User } from "@app/db";
import { ApiException } from "../../common/api-exception.js";
import { PrismaService } from "../../infra/prisma.service.js";
import { toUserDto } from "../auth/mappers.js";
import { BillingService } from "../billing/billing.service.js";
import { toSubscriptionDto } from "../billing/mappers.js";

type UserRow = User & { subscriptions: (Subscription & { plan: Plan })[]; _count: { profiles: number } };

const userInclude = {
  // Thuê bao ACTIVE còn hạn luôn có currentPeriodEnd lớn nhất (bản đã hủy/hết hạn có end ≤ now).
  subscriptions: { orderBy: [{ currentPeriodEnd: "desc" }, { createdAt: "desc" }], take: 1, include: { plan: true } },
  _count: { select: { profiles: true } },
} satisfies Prisma.UserInclude;

function toAdminUser(u: UserRow): AdminUser {
  const sub = u.subscriptions[0];
  return {
    ...toUserDto(u),
    disabled: u.disabledAt !== null,
    profileCount: u._count.profiles,
    subscription: sub ? toSubscriptionDto(sub) : null,
  };
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  async list(q: string | undefined, page: number, pageSize: number): Promise<Paginated<AdminUser>> {
    await this.billing.expireLazily();
    const where: Prisma.UserWhereInput = q ? { email: { contains: q, mode: "insensitive" } } : {};
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where, include: userInclude, orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize, take: pageSize,
      }),
    ]);
    return { items: rows.map(toAdminUser), page, pageSize, total, hasMore: page * pageSize < total };
  }

  async get(id: string): Promise<AdminUser> {
    const u = await this.prisma.user.findUnique({ where: { id }, include: userInclude });
    if (!u) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy người dùng");
    return toAdminUser(u);
  }

  async update(actorId: string, id: string, input: { disabled?: boolean; role?: UserRole }): Promise<AdminUser> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, disabledAt: true } });
    if (!user) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy người dùng");
    if (id === actorId && (input.disabled === true || input.role === "USER")) {
      throw new ApiException(409, "CONFLICT", "Không thể tự khóa hoặc tự hạ quyền chính mình");
    }
    const data: Prisma.UserUpdateInput = {};
    if (input.role) data.role = input.role;
    if (input.disabled !== undefined) data.disabledAt = input.disabled ? (user.disabledAt ?? new Date()) : null;
    await this.prisma.user.update({ where: { id }, data });
    // Khóa hoặc đổi quyền → buộc đăng nhập lại để access token mang role mới.
    if (input.disabled === true || input.role) {
      await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return this.get(id);
  }
}
