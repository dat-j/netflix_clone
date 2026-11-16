import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { SkipThrottle, Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { AuthResponse, DeviceSession, MeResponse } from "@app/shared";
import type { Response } from "express";
import { z } from "zod";
import {
  ACCESS_COOKIE, type AppRequest, AuthGuard, CurrentUser, PROFILE_COOKIE, REFRESH_COOKIE, type RequestUser,
} from "../../common/auth.js";
import { type ClientInfo, AuthService, type IssuedTokens } from "./auth.service.js";
import { clearAuthCookies, setAuthCookies } from "./cookies.js";
import { emailSchema, parseOrThrow, passwordSchema } from "./validation.js";

const credentialsSchema = z.object({ email: emailSchema, password: passwordSchema });
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) });
const tokenSchema = z.object({ token: z.string().min(10).max(200) });
const forgotSchema = z.object({ email: emailSchema });
const resetSchema = z.object({ token: z.string().min(10).max(200), password: passwordSchema });

/** Giới hạn chặt cho các endpoint nhạy cảm (đoán mật khẩu, spam mail). */
const STRICT = { default: { limit: 20, ttl: 60_000 } };

function clientInfo(req: AppRequest): ClientInfo {
  const ua = req.headers["user-agent"];
  return { userAgent: typeof ua === "string" ? ua : null, ip: req.ip ?? null };
}

@Controller("auth")
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private respond(res: Response, tokens: IssuedTokens): AuthResponse {
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return { user: tokens.user };
  }

  @Post("register")
  @Throttle(STRICT)
  async register(@Body() body: unknown, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    const { email, password } = parseOrThrow(credentialsSchema, body);
    return this.respond(res, await this.auth.register(email, password, clientInfo(req)));
  }

  @Post("login")
  @HttpCode(200)
  @Throttle(STRICT)
  async login(@Body() body: unknown, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    const { email, password } = parseOrThrow(loginSchema, body);
    return this.respond(res, await this.auth.login(email, password, clientInfo(req)));
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    try {
      return this.respond(res, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], clientInfo(req)));
    } catch (e) {
      clearAuthCookies(res);
      throw e;
    }
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE], this.auth.sessionIdFromAccess(req.cookies?.[ACCESS_COOKIE]));
    clearAuthCookies(res);
  }

  @Get("me")
  @SkipThrottle()
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: RequestUser, @Req() req: AppRequest): Promise<MeResponse> {
    const header = req.headers["x-profile-id"];
    const pid: string | undefined = req.cookies?.[PROFILE_COOKIE] ?? (typeof header === "string" ? header : undefined);
    return this.auth.me(user.id, user.sessionId, pid);
  }

  @Post("verify-email")
  @HttpCode(204)
  @Throttle(STRICT)
  async verifyEmail(@Body() body: unknown): Promise<void> {
    await this.auth.verifyEmail(parseOrThrow(tokenSchema, body).token);
  }

  @Post("forgot-password")
  @HttpCode(204)
  @Throttle(STRICT)
  async forgotPassword(@Body() body: unknown): Promise<void> {
    await this.auth.forgotPassword(parseOrThrow(forgotSchema, body).email);
  }

  @Post("reset-password")
  @HttpCode(204)
  @Throttle(STRICT)
  async resetPassword(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<void> {
    const { token, password } = parseOrThrow(resetSchema, body);
    await this.auth.resetPassword(token, password);
    clearAuthCookies(res);
  }

  @Get("sessions")
  @SkipThrottle()
  @UseGuards(AuthGuard)
  sessions(@CurrentUser() user: RequestUser): Promise<DeviceSession[]> {
    return this.auth.listSessions(user.id, user.sessionId);
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async revokeSession(
    @CurrentUser() user: RequestUser, @Param("id") id: string, @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.revokeOwnSession(user.id, id);
    if (id === user.sessionId) clearAuthCookies(res);
  }
}
