import { Injectable } from "@nestjs/common";
import type { AvatarOption, ProfileDto } from "@app/shared";
import type { Profile } from "@app/db";
import { z } from "zod";
import { ApiException } from "../../common/api-exception.js";
import { PrismaService } from "../../infra/prisma.service.js";
import { BillingService } from "../billing/billing.service.js";

export const AVATAR_KEYS = Array.from({ length: 8 }, (_, i) => `avatar-${i + 1}`) as [string, ...string[]];
export const avatarUrl = (key: string) => `/avatars/${key}.svg`;
export const AVATARS: AvatarOption[] = AVATAR_KEYS.map((key) => ({ key, url: avatarUrl(key) }));

export const profileInputSchema = z.object({
  name: z.string().trim().min(1, { message: "Tên không được trống" }).max(40, { message: "Tên tối đa 40 ký tự" }),
  avatarKey: z.enum(AVATAR_KEYS, { message: "Avatar không hợp lệ" }),
  isKids: z.boolean().optional(),
  language: z.string().trim().regex(/^[a-z]{2}(-[A-Za-z]{2})?$/, { message: "Mã ngôn ngữ không hợp lệ" }).optional(),
});
export const profilePatchSchema = profileInputSchema.partial();

export function toProfileDto(p: Profile): ProfileDto {
  return { id: p.id, name: p.name, avatarKey: p.avatarKey, avatarUrl: avatarUrl(p.avatarKey), isKids: p.isKids, language: p.language };
}

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  async list(userId: string): Promise<ProfileDto[]> {
    const rows = await this.prisma.profile.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    return rows.map(toProfileDto);
  }

  async findOwned(userId: string, id: string | undefined | null): Promise<ProfileDto | null> {
    if (!id || !z.uuid().safeParse(id).success) return null;
    const p = await this.prisma.profile.findFirst({ where: { id, userId } });
    return p ? toProfileDto(p) : null;
  }

  private async getOwnedOrThrow(userId: string, id: string): Promise<Profile> {
    if (!z.uuid().safeParse(id).success) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy hồ sơ");
    const p = await this.prisma.profile.findFirst({ where: { id, userId } });
    if (!p) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy hồ sơ");
    return p;
  }

  async create(userId: string, input: z.infer<typeof profileInputSchema>): Promise<ProfileDto> {
    const [count, max] = await Promise.all([
      this.prisma.profile.count({ where: { userId } }),
      this.billing.maxProfilesFor(userId),
    ]);
    if (count >= max) throw new ApiException(409, "PROFILE_LIMIT", `Tối đa ${max} hồ sơ`);
    const p = await this.prisma.profile.create({
      data: { userId, name: input.name, avatarKey: input.avatarKey, isKids: input.isKids ?? false, language: input.language ?? "vi" },
    });
    return toProfileDto(p);
  }

  /** Profile mặc định khi đăng ký: tên lấy từ phần trước @ của email. */
  async createDefault(userId: string, email: string): Promise<ProfileDto> {
    const local = email.split("@")[0] ?? "";
    const name = (local.replace(/[._+-]+/g, " ").trim() || "Tôi").slice(0, 40);
    const pretty = name.charAt(0).toUpperCase() + name.slice(1);
    const avatarKey = AVATAR_KEYS[Math.floor(Math.random() * AVATAR_KEYS.length)]!;
    const p = await this.prisma.profile.create({ data: { userId, name: pretty, avatarKey } });
    return toProfileDto(p);
  }

  async update(userId: string, id: string, input: z.infer<typeof profilePatchSchema>): Promise<ProfileDto> {
    await this.getOwnedOrThrow(userId, id);
    const p = await this.prisma.profile.update({ where: { id }, data: input });
    return toProfileDto(p);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.getOwnedOrThrow(userId, id);
    const count = await this.prisma.profile.count({ where: { userId } });
    if (count <= 1) throw new ApiException(409, "CONFLICT", "Không thể xóa hồ sơ cuối cùng");
    await this.prisma.profile.delete({ where: { id } });
  }

  async select(userId: string, id: string): Promise<ProfileDto> {
    return toProfileDto(await this.getOwnedOrThrow(userId, id));
  }
}
