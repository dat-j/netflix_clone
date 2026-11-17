import { Body, Controller, Delete, Get, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import { SkipThrottle, Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { TelegramAuthResponse, TelegramLinkResult, TelegramLinkStatus } from "@app/shared";
import type { Response } from "express";
import { z } from "zod";
import { type AppRequest, AuthGuard, CurrentUser, PROFILE_COOKIE, type RequestUser } from "../../common/auth.js";
import { STRICT, clientInfo } from "../auth/auth.controller.js";
import { AuthService } from "../auth/auth.service.js";
import { clearProfileCookie, setAuthCookies, setProfileCookie } from "../auth/cookies.js";
import { parseOrThrow } from "../auth/validation.js";
import { TelegramService } from "./telegram.service.js";

const initDataSchema = z.object({ initData: z.string().min(1).max(8192) });
/**
 * Mini App sign-in runs on every launch and many Telegram users share carrier NAT IPs, while there is nothing to
 * brute-force (initData is HMAC-signed). So it gets a looser per-IP limit than password login; linking keeps STRICT.
 */
const LAUNCH = { default: { limit: 60, ttl: 60_000 } };

@Controller("auth/telegram")
@UseGuards(ThrottlerGuard)
export class TelegramController {
  constructor(
    private readonly telegram: TelegramService,
    private readonly auth: AuthService,
  ) {}

  /** Đăng nhập bằng initData của Mini App. Chưa liên kết → `{ linked: false }` và không set cookie. */
  @Post()
  @HttpCode(200)
  @Throttle(LAUNCH)
  async login(@Body() body: unknown, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response): Promise<TelegramAuthResponse> {
    const { initData } = parseOrThrow(initDataSchema, body);
    const { user: tgUser } = this.telegram.verify(initData);
    const linked = await this.telegram.findLinkedUser(tgUser);
    if (!linked) return { linked: false, telegramUser: { firstName: tgUser.firstName, username: tgUser.username } };

    const tokens = await this.auth.issueSessionForUser(linked.userId, clientInfo(req));
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    const profile = await this.telegram.pickProfile(linked.userId, req.cookies?.[PROFILE_COOKIE]);
    if (profile) setProfileCookie(res, profile.id);
    else if (req.cookies?.[PROFILE_COOKIE]) clearProfileCookie(res);
    return { linked: true, user: tokens.user, profile };
  }

  @Get("link")
  @SkipThrottle()
  @UseGuards(AuthGuard)
  status(@CurrentUser() user: RequestUser): Promise<TelegramLinkStatus> {
    return this.telegram.status(user.id);
  }

  @Post("link")
  @HttpCode(200)
  @Throttle(STRICT)
  @UseGuards(AuthGuard)
  async link(
    @CurrentUser() user: RequestUser, @Body() body: unknown,
    @Req() req: AppRequest, @Res({ passthrough: true }) res: Response,
  ): Promise<TelegramLinkResult> {
    const { initData } = parseOrThrow(initDataSchema, body);
    const { user: tgUser } = this.telegram.verify(initData);
    const status = await this.telegram.link(user.id, tgUser);
    const current = req.cookies?.[PROFILE_COOKIE];
    const profile = await this.telegram.pickProfile(user.id, current);
    if (profile && profile.id !== current) setProfileCookie(res, profile.id);
    return { ...status, profile };
  }

  @Delete("link")
  @HttpCode(204)
  @Throttle(STRICT)
  @UseGuards(AuthGuard)
  async unlink(@CurrentUser() user: RequestUser): Promise<void> {
    await this.telegram.unlink(user.id);
  }
}
