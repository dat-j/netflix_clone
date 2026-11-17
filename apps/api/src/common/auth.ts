/**
 * Guard + decorator xác thực dùng chung cho mọi module.
 *
 * Access token: JWT HS256 ký bằng JWT_ACCESS_SECRET, payload `AccessTokenPayload`, nằm ở cookie `at`
 * (hoặc header `Authorization: Bearer` cho client không phải trình duyệt).
 * Profile đang chọn: cookie `pid` (hoặc header `x-profile-id`).
 *
 * Cách dùng:
 *   @UseGuards(AuthGuard)                                   → cần đăng nhập
 *   @UseGuards(AuthGuard, ProfileGuard)                     → cần đăng nhập + đã chọn profile
 *   @UseGuards(AuthGuard, ProfileGuard, SubscriptionGuard)  → nạp quyền phát theo gói hoặc quyền miễn phí
 *   @Roles("ADMIN") @UseGuards(AuthGuard, RolesGuard)       → admin
 */
import {
  type CanActivate, type ExecutionContext, Injectable, SetMetadata, createParamDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { UserRole } from "@app/shared";
import type { Request } from "express";
import jwt from "jsonwebtoken";
import { env } from "../env.js";
import { PrismaService } from "../infra/prisma.service.js";
import { ApiException } from "./api-exception.js";

export const ACCESS_COOKIE = "at";
export const REFRESH_COOKIE = "rt";
export const PROFILE_COOKIE = "pid";

export interface AccessTokenPayload { sub: string; sid: string; role: UserRole; email: string }
export interface RequestUser { id: string; sessionId: string; role: UserRole; email: string }
export interface RequestProfile { id: string; userId: string; name: string; isKids: boolean; language: string }
export interface Entitlement {
  subscriptionId: string;
  planCode: string;
  maxHeight: number;
  maxConcurrentStreams: number;
  currentPeriodEnd: Date;
}

export interface AppRequest extends Request {
  user?: RequestUser;
  profile?: RequestProfile;
  entitlement?: Entitlement;
}

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined;
    const token: string | undefined = req.cookies?.[ACCESS_COOKIE] ?? bearer;
    if (!token) throw new ApiException(401, "UNAUTHENTICATED", "Chưa đăng nhập");
    try {
      const payload = jwt.verify(token, env("JWT_ACCESS_SECRET"), { algorithms: ["HS256"] }) as AccessTokenPayload;
      req.user = { id: payload.sub, sessionId: payload.sid, role: payload.role, email: payload.email };
      return true;
    } catch {
      throw new ApiException(401, "UNAUTHENTICATED", "Phiên đăng nhập hết hạn");
    }
  }
}

export const ROLES_KEY = "roles";
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.user || !roles.includes(req.user.role)) throw new ApiException(403, "FORBIDDEN", "Không có quyền");
    return true;
  }
}

/** Phải đặt sau AuthGuard. */
@Injectable()
export class ProfileGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const header = req.headers["x-profile-id"];
    const profileId: string | undefined = req.cookies?.[PROFILE_COOKIE] ?? (typeof header === "string" ? header : undefined);
    if (!req.user || !profileId || !/^[0-9a-f-]{36}$/i.test(profileId)) {
      throw new ApiException(403, "PROFILE_REQUIRED", "Chưa chọn hồ sơ");
    }
    const profile = await this.prisma.profile.findFirst({
      where: { id: profileId, userId: req.user.id },
      select: { id: true, userId: true, name: true, isKids: true, language: true },
    });
    if (!profile) throw new ApiException(403, "PROFILE_REQUIRED", "Hồ sơ không hợp lệ");
    req.profile = profile;
    return true;
  }
}

/** Phải đặt sau AuthGuard. Admin dùng quyền cao nhất; user không có gói nhận entitlement miễn phí 720p. */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.user) throw new ApiException(401, "UNAUTHENTICATED", "Chưa đăng nhập");
    const sub = await this.prisma.subscription.findFirst({
      where: { userId: req.user.id, status: "ACTIVE", currentPeriodEnd: { gt: new Date() } },
      orderBy: { currentPeriodEnd: "desc" },
      include: { plan: true },
    });
    if (sub) {
      req.entitlement = {
        subscriptionId: sub.id,
        planCode: sub.plan.code,
        maxHeight: sub.plan.maxHeight,
        maxConcurrentStreams: sub.plan.maxConcurrentStreams,
        currentPeriodEnd: sub.currentPeriodEnd,
      };
      return true;
    }
    if (req.user.role === "ADMIN") {
      req.entitlement = {
        subscriptionId: "admin", planCode: "admin", maxHeight: 2160, maxConcurrentStreams: 4,
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      };
      return true;
    }

    // Tài khoản miễn phí vẫn xem được nội dung. Subscription chỉ mở khóa chất lượng cao hơn
    // và thêm số luồng đồng thời, không còn là điều kiện bắt buộc để bắt đầu phát.
    req.entitlement = {
      subscriptionId: "free",
      planCode: "free",
      maxHeight: 720,
      maxConcurrentStreams: 1,
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    };
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestUser => {
  return ctx.switchToHttp().getRequest<AppRequest>().user!;
});
export const CurrentProfile = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestProfile => {
  return ctx.switchToHttp().getRequest<AppRequest>().profile!;
});
export const CurrentEntitlement = createParamDecorator((_: unknown, ctx: ExecutionContext): Entitlement => {
  return ctx.switchToHttp().getRequest<AppRequest>().entitlement!;
});
