import { Injectable, Logger } from "@nestjs/common";
import type { ProfileDto, TelegramLinkDto, TelegramLinkStatus, TelegramNotificationPreferences } from "@app/shared";
import type { TelegramAccount } from "@app/db";
import { z } from "zod";
import { ApiException } from "../../common/api-exception.js";
import { PrismaService } from "../../infra/prisma.service.js";
import { toProfileDto } from "../profiles/profiles.service.js";
import { InitDataError, type TelegramWebAppUser, type VerifiedInitData, verifyInitData } from "./init-data.js";

export function toTelegramLinkDto(a: TelegramAccount): TelegramLinkDto {
  return {
    telegramUserId: a.telegramUserId.toString(),
    username: a.username,
    firstName: a.firstName,
    lastName: a.lastName,
    photoUrl: a.photoUrl,
    linkedAt: a.linkedAt.toISOString(),
    lastSeenAt: a.lastSeenAt.toISOString(),
  };
}

const conflict = (message: string) => new ApiException(409, "TELEGRAM_LINK_CONFLICT", message);

@Injectable()
export class TelegramService {
  private readonly logger = new Logger("TelegramService");

  constructor(private readonly prisma: PrismaService) {}

  /** Đọc mỗi lần gọi để đổi env/test không cần khởi động lại module. */
  private botToken(): string {
    return (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  }

  get available(): boolean {
    return this.botToken().length > 0;
  }

  /** 503 nếu chưa cấu hình bot; 401 nếu initData sai/hết hạn. */
  verify(initData: string): VerifiedInitData {
    const token = this.botToken();
    if (!token) throw new ApiException(503, "TELEGRAM_UNAVAILABLE", "Đăng nhập qua Telegram chưa được bật trên máy chủ");
    try {
      const data = verifyInitData(initData, token);
      if (data.user.isBot) throw new InitDataError("NO_USER");
      return data;
    } catch (e) {
      if (e instanceof InitDataError) {
        // Chỉ log lý do, không log initData
        this.logger.debug(`Từ chối initData: ${e.reason}`);
        throw new ApiException(
          401, "TELEGRAM_INIT_DATA_INVALID",
          e.reason === "EXPIRED" ? "Phiên Telegram đã hết hạn, hãy mở lại Mini App" : "Dữ liệu Telegram không hợp lệ",
        );
      }
      throw e;
    }
  }

  private profileFields(u: TelegramWebAppUser) {
    return { username: u.username, firstName: u.firstName, lastName: u.lastName, languageCode: u.languageCode, photoUrl: u.photoUrl };
  }

  /** Tìm user đã liên kết + cập nhật thông tin hiển thị/lastSeenAt. */
  async findLinkedUser(u: TelegramWebAppUser): Promise<{ userId: string } | null> {
    const acc = await this.prisma.telegramAccount.findUnique({ where: { telegramUserId: u.id }, select: { id: true, userId: true } });
    if (!acc) return null;
    await this.prisma.telegramAccount.update({ where: { id: acc.id }, data: { ...this.profileFields(u), lastSeenAt: new Date() } });
    return { userId: acc.userId };
  }

  /**
   * Profile để tự chọn khi đăng nhập qua Telegram:
   * 1) profile đang chọn (cookie `pid`) nếu vẫn thuộc user; 2) nếu user có đúng một profile người lớn (không PIN) → profile đó.
   * Ngược lại null → web đưa qua màn "Ai đang xem?".
   */
  async pickProfile(userId: string, currentPid: string | undefined): Promise<ProfileDto | null> {
    if (currentPid && z.uuid().safeParse(currentPid).success) {
      const p = await this.prisma.profile.findFirst({ where: { id: currentPid, userId } });
      if (p) return toProfileDto(p);
    }
    const adults = await this.prisma.profile.findMany({ where: { userId, isKids: false }, take: 2 });
    if (adults.length === 1 && !adults[0]!.pinHash) return toProfileDto(adults[0]!);
    return null;
  }

  async status(userId: string): Promise<TelegramLinkStatus> {
    const acc = await this.prisma.telegramAccount.findUnique({ where: { userId } });
    return { available: this.available, link: acc ? toTelegramLinkDto(acc) : null };
  }

  async link(userId: string, u: TelegramWebAppUser): Promise<TelegramLinkStatus> {
    const [byTg, byUser] = await Promise.all([
      this.prisma.telegramAccount.findUnique({ where: { telegramUserId: u.id } }),
      this.prisma.telegramAccount.findUnique({ where: { userId } }),
    ]);
    if (byTg && byTg.userId !== userId) {
      throw conflict("Tài khoản Telegram này đã được liên kết với một tài khoản BoxPhim khác");
    }
    if (byUser && byUser.telegramUserId !== u.id) {
      throw conflict("Tài khoản BoxPhim của bạn đã liên kết với một tài khoản Telegram khác. Hãy hủy liên kết trước.");
    }
    let acc: TelegramAccount;
    try {
      acc = byUser
        ? await this.prisma.telegramAccount.update({ where: { id: byUser.id }, data: { ...this.profileFields(u), lastSeenAt: new Date() } })
        : await this.prisma.telegramAccount.create({ data: { telegramUserId: u.id, userId, ...this.profileFields(u) } });
    } catch (e) {
      // Hai request liên kết chạy song song
      if ((e as { code?: string }).code === "P2002") throw conflict("Tài khoản Telegram hoặc BoxPhim đã được liên kết");
      throw e;
    }
    this.logger.log(`User ${userId} đã liên kết Telegram`);
    return { available: this.available, link: toTelegramLinkDto(acc) };
  }

  async notificationPreferences(userId: string): Promise<TelegramNotificationPreferences> {
    const account = await this.prisma.telegramAccount.findUnique({
      where: { userId }, select: { notifyNewTitles: true, notifyNewEpisodes: true },
    });
    if (!account) throw new ApiException(409, "CONFLICT", "Hãy liên kết Telegram trước");
    return account;
  }

  async updateNotificationPreferences(userId: string, input: TelegramNotificationPreferences): Promise<TelegramNotificationPreferences> {
    const account = await this.prisma.telegramAccount.findUnique({ where: { userId }, select: { id: true } });
    if (!account) throw new ApiException(409, "CONFLICT", "Hãy liên kết Telegram trước");
    return this.prisma.telegramAccount.update({
      where: { userId },
      data: input,
      select: { notifyNewTitles: true, notifyNewEpisodes: true },
    });
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
  }

  private async sendNotification(chatId: bigint, text: string): Promise<void> {
    const token = this.botToken();
    if (!token) return;
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId.toString(), text, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Telegram API trả về HTTP ${response.status}`);
  }

  /** Gửi thông báo phim mới cho những tài khoản đã bật tùy chọn. Không để lỗi Telegram chặn thao tác xuất bản. */
  async notifyNewTitle(titleId: string): Promise<void> {
    if (!this.available) return;
    try {
      const title = await this.prisma.title.findUnique({ where: { id: titleId }, select: { name: true, slug: true, status: true } });
      if (!title || title.status !== "PUBLISHED") return;
      const accounts = await this.prisma.telegramAccount.findMany({
        where: { notifyNewTitles: true }, select: { telegramUserId: true },
      });
      const message = `🎬 <b>Phim mới trên Lumio</b>\n${this.escapeHtml(title.name)}\n<a href="${(process.env.PUBLIC_WEB_URL ?? "http://localhost:3000").replace(/\/$/, "")}/title/${encodeURIComponent(title.slug)}">Xem phim</a>`;
      const results = await Promise.allSettled(accounts.map((a) => this.sendNotification(a.telegramUserId, message)));
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed) this.logger.warn(`Thông báo phim mới: ${failed}/${accounts.length} gửi thất bại`);
    } catch (error) {
      this.logger.warn(`Không gửi được thông báo phim mới: ${String(error)}`);
    }
  }

  /** Gửi một thông báo gộp khi admin xuất bản một hoặc nhiều tập cùng lúc. */
  async notifyNewEpisodes(titleId: string, episodeIds: string[]): Promise<void> {
    if (!this.available || !episodeIds.length) return;
    try {
      const [title, episodes, accounts] = await Promise.all([
        this.prisma.title.findUnique({ where: { id: titleId }, select: { name: true, slug: true, status: true } }),
        this.prisma.episode.findMany({
          where: { id: { in: episodeIds }, titleId, status: "PUBLISHED" },
          orderBy: [{ season: { seasonNumber: "asc" } }, { episodeNumber: "asc" }],
          select: { episodeNumber: true, season: { select: { seasonNumber: true } }, name: true },
        }),
        this.prisma.telegramAccount.findMany({ where: { notifyNewEpisodes: true }, select: { telegramUserId: true } }),
      ]);
      if (!title || title.status !== "PUBLISHED" || !episodes.length) return;
      const list = episodes.slice(0, 8).map((e) =>
        `• S${e.season.seasonNumber}E${e.episodeNumber}${e.name ? ` · ${this.escapeHtml(e.name)}` : ""}`,
      ).join("\n");
      const more = episodes.length > 8 ? `\n…và ${episodes.length - 8} tập khác` : "";
      const message = `📺 <b>${this.escapeHtml(title.name)} có tập mới</b>\n${list}${more}\n<a href="${(process.env.PUBLIC_WEB_URL ?? "http://localhost:3000").replace(/\/$/, "")}/title/${encodeURIComponent(title.slug)}">Xem ngay</a>`;
      const results = await Promise.allSettled(accounts.map((a) => this.sendNotification(a.telegramUserId, message)));
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed) this.logger.warn(`Thông báo tập mới: ${failed}/${accounts.length} gửi thất bại`);
    } catch (error) {
      this.logger.warn(`Không gửi được thông báo tập mới: ${String(error)}`);
    }
  }

  async unlink(userId: string): Promise<void> {
    await this.prisma.telegramAccount.deleteMany({ where: { userId } });
  }
}
