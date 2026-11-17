import { Injectable, Logger } from "@nestjs/common";
import type { ProfileDto, TelegramLinkDto, TelegramLinkStatus } from "@app/shared";
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

  async unlink(userId: string): Promise<void> {
    await this.prisma.telegramAccount.deleteMany({ where: { userId } });
  }
}
