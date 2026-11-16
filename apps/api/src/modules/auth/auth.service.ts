import { createHash, createHmac, randomBytes } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { DeviceSession, MeResponse, UserDto } from "@app/shared";
import type { EmailTokenType, User } from "@app/db";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { ApiException } from "../../common/api-exception.js";
import type { AccessTokenPayload } from "../../common/auth.js";
import { env } from "../../env.js";
import { PrismaService } from "../../infra/prisma.service.js";
import { RedisService } from "../../infra/redis.service.js";
import { BillingService } from "../billing/billing.service.js";
import { ProfilesService } from "../profiles/profiles.service.js";
import { ACCESS_TTL_SEC, REFRESH_TTL_SEC } from "./cookies.js";
import { MailService } from "./mail.service.js";
import { toUserDto } from "./mappers.js";

export interface ClientInfo { userAgent: string | null; ip: string | null }
export interface IssuedTokens { accessToken: string; refreshToken: string; user: UserDto }

const VERIFY_TTL_MS = 24 * 3600_000;
const RESET_TTL_MS = 3600_000;
/** Cửa sổ ân hạn cho các request refresh song song dùng cùng refresh token cũ. */
const REFRESH_GRACE_SEC = 30;
const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const randomToken = () => randomBytes(32).toString("base64url");

export function describeDevice(ua: string | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  if (browser && os) return `${browser} trên ${os}`;
  return browser ?? os ?? ua.slice(0, 60);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger("AuthService");
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly profiles: ProfilesService,
    private readonly billing: BillingService,
  ) {}

  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON_OPTS);
  }

  private hashRefresh(token: string): string {
    return createHmac("sha256", env("JWT_REFRESH_SECRET")).update(token).digest("hex");
  }

  private signAccess(user: Pick<User, "id" | "role" | "email">, sessionId: string): string {
    const payload: AccessTokenPayload = { sub: user.id, sid: sessionId, role: user.role, email: user.email };
    return jwt.sign(payload, env("JWT_ACCESS_SECRET"), { algorithm: "HS256", expiresIn: ACCESS_TTL_SEC });
  }

  private newRefreshToken(sessionId: string) {
    const token = `${sessionId}.${randomToken()}`;
    return { token, hash: this.hashRefresh(token) };
  }

  private async createSession(user: User, client: ClientInfo): Promise<IssuedTokens> {
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: `pending:${randomToken()}`,
        userAgent: client.userAgent?.slice(0, 500) ?? null,
        deviceName: describeDevice(client.userAgent),
        ip: client.ip,
        expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
      },
    });
    const rt = this.newRefreshToken(session.id);
    await this.prisma.session.update({ where: { id: session.id }, data: { refreshTokenHash: rt.hash } });
    return { accessToken: this.signAccess(user, session.id), refreshToken: rt.token, user: toUserDto(user) };
  }

  // ───────── đăng ký / đăng nhập ─────────
  async register(email: string, password: string, client: ClientInfo): Promise<IssuedTokens> {
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ApiException(409, "EMAIL_TAKEN", "Email đã được sử dụng");
    let user: User;
    try {
      user = await this.prisma.user.create({ data: { email, passwordHash: await this.hashPassword(password) } });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new ApiException(409, "EMAIL_TAKEN", "Email đã được sử dụng");
      throw e;
    }
    await this.profiles.createDefault(user.id, email);
    await this.sendVerifyEmail(user);
    return this.createSession(user, client);
  }

  async login(email: string, password: string, client: ClientInfo): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Giữ thời gian phản hồi tương đương để không dò được email.
      this.dummyHash ??= this.hashPassword(randomToken());
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      throw new ApiException(401, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng");
    }
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) throw new ApiException(401, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng");
    if (user.disabledAt) throw new ApiException(403, "FORBIDDEN", "Tài khoản đã bị khóa");
    return this.createSession(user, client);
  }

  // ───────── refresh xoay vòng ─────────
  async refresh(token: string | undefined, client: ClientInfo): Promise<IssuedTokens> {
    const invalid = () => new ApiException(401, "UNAUTHENTICATED", "Phiên đăng nhập không hợp lệ");
    if (!token) throw invalid();
    const sid = token.split(".")[0] ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(sid)) throw invalid();
    const session = await this.prisma.session.findUnique({ where: { id: sid }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw invalid();
    if (session.user.disabledAt) {
      await this.revokeSession(session.id);
      throw invalid();
    }

    const presentedHash = this.hashRefresh(token);
    if (presentedHash === session.refreshTokenHash) {
      const next = this.newRefreshToken(session.id);
      const { count } = await this.prisma.session.updateMany({
        where: { id: session.id, refreshTokenHash: presentedHash, revokedAt: null },
        data: {
          refreshTokenHash: next.hash,
          lastUsedAt: new Date(),
          expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
          ip: client.ip ?? session.ip,
          userAgent: client.userAgent?.slice(0, 500) ?? session.userAgent,
        },
      });
      if (count === 1) {
        await this.redis.set(`rt:grace:${presentedHash}`, next.token, "EX", REFRESH_GRACE_SEC).catch(() => undefined);
        return { accessToken: this.signAccess(session.user, session.id), refreshToken: next.token, user: toUserDto(session.user) };
      }
      // Một request song song vừa xoay token → rơi xuống nhánh ân hạn.
    }

    const graceToken = await this.redis.get(`rt:grace:${presentedHash}`).catch(() => null);
    if (graceToken) {
      return { accessToken: this.signAccess(session.user, session.id), refreshToken: graceToken, user: toUserDto(session.user) };
    }

    // Token cũ bị dùng lại ngoài cửa sổ ân hạn → nghi bị đánh cắp, thu hồi cả phiên.
    this.logger.warn(`Phát hiện dùng lại refresh token, thu hồi phiên ${session.id}`);
    await this.revokeSession(session.id);
    throw invalid();
  }

  async logout(refreshToken: string | undefined, accessSessionId: string | undefined): Promise<void> {
    let sid: string | undefined;
    if (refreshToken) {
      const s = await this.prisma.session.findUnique({
        where: { refreshTokenHash: this.hashRefresh(refreshToken) }, select: { id: true },
      });
      sid = s?.id;
    }
    sid ??= accessSessionId;
    if (sid && /^[0-9a-f-]{36}$/i.test(sid)) await this.revokeSession(sid);
  }

  private async revokeSession(id: string) {
    await this.prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllSessions(userId: string) {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Đọc sid từ access token (không bắt buộc hợp lệ hạn) — dùng cho logout. */
  sessionIdFromAccess(token: string | undefined): string | undefined {
    if (!token) return undefined;
    try {
      const p = jwt.verify(token, env("JWT_ACCESS_SECRET"), { algorithms: ["HS256"], ignoreExpiration: true }) as AccessTokenPayload;
      return p.sid;
    } catch {
      return undefined;
    }
  }

  // ───────── me / thiết bị ─────────
  async me(userId: string, sessionId: string, profileId: string | undefined): Promise<MeResponse> {
    const [user, session] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.session.findUnique({ where: { id: sessionId }, select: { revokedAt: true } }),
    ]);
    if (!user || user.disabledAt || !session || session.revokedAt) {
      throw new ApiException(401, "UNAUTHENTICATED", "Phiên đăng nhập không hợp lệ");
    }
    const [subscription, profile] = await Promise.all([
      this.billing.getCurrentSubscription(userId),
      this.profiles.findOwned(userId, profileId),
    ]);
    return { user: toUserDto(user), subscription, profile };
  }

  async listSessions(userId: string, currentSessionId: string): Promise<DeviceSession[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" },
    });
    return rows.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      userAgent: s.userAgent,
      ip: s.ip,
      lastUsedAt: s.lastUsedAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  async revokeOwnSession(userId: string, id: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy phiên");
    const { count } = await this.prisma.session.updateMany({
      where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() },
    });
    if (!count) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy phiên");
  }

  // ───────── email token ─────────
  private async issueEmailToken(userId: string, type: EmailTokenType, ttlMs: number): Promise<string> {
    // Mỗi lần phát hành mới vô hiệu các token cùng loại chưa dùng.
    await this.prisma.emailToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
    const token = randomToken();
    await this.prisma.emailToken.create({
      data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  /** Đánh dấu đã dùng (một lần) và trả về userId, hoặc ném TOKEN_INVALID. */
  private async consumeEmailToken(token: string, type: EmailTokenType): Promise<string> {
    const invalid = new ApiException(400, "TOKEN_INVALID", "Liên kết không hợp lệ hoặc đã hết hạn");
    const row = await this.prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.type !== type || row.usedAt || row.expiresAt <= new Date()) throw invalid;
    const { count } = await this.prisma.emailToken.updateMany({
      where: { id: row.id, usedAt: null }, data: { usedAt: new Date() },
    });
    if (!count) throw invalid;
    return row.userId;
  }

  private async sendVerifyEmail(user: Pick<User, "id" | "email">) {
    const token = await this.issueEmailToken(user.id, "VERIFY_EMAIL", VERIFY_TTL_MS);
    const link = this.mail.webUrl(`/verify-email?token=${encodeURIComponent(token)}`);
    this.mail.sendInBackground({
      to: user.email,
      subject: "Xác nhận địa chỉ email",
      text: `Chào bạn,\n\nNhấn vào liên kết sau để xác nhận email (hiệu lực 24 giờ):\n${link}\n`,
      html: `<p>Chào bạn,</p><p>Nhấn vào liên kết sau để xác nhận email (hiệu lực 24 giờ):</p><p><a href="${link}">${link}</a></p>`,
    });
  }

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.consumeEmailToken(token, "VERIFY_EMAIL");
    await this.prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, email: true, disabledAt: true } });
    if (!user || user.disabledAt) return;
    const token = await this.issueEmailToken(user.id, "RESET_PASSWORD", RESET_TTL_MS);
    const link = this.mail.webUrl(`/reset-password?token=${encodeURIComponent(token)}`);
    this.mail.sendInBackground({
      to: user.email,
      subject: "Đặt lại mật khẩu",
      text: `Chào bạn,\n\nNhấn vào liên kết sau để đặt lại mật khẩu (hiệu lực 1 giờ):\n${link}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.\n`,
      html: `<p>Chào bạn,</p><p>Nhấn vào liên kết sau để đặt lại mật khẩu (hiệu lực 1 giờ):</p><p><a href="${link}">${link}</a></p><p>Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>`,
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const userId = await this.consumeEmailToken(token, "RESET_PASSWORD");
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.hashPassword(password) },
    });
    // Đã chứng minh sở hữu hộp thư → coi như đã xác thực email.
    await this.prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
    await this.revokeAllSessions(userId);
  }
}
