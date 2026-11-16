/**
 * Seed idempotent: gói thuê bao + tài khoản demo. Chạy: `pnpm db:seed`.
 * Chạy lại nhiều lần an toàn (upsert theo code/email; profile/thuê bao chỉ tạo khi còn thiếu).
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";
import argon2 from "argon2";
import { createPrismaClient, type UserRole } from "../src/index.js";

loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

const prisma = createPrismaClient();

const PLANS = [
  {
    code: "basic", name: "Cơ bản", description: "Xem trên 1 thiết bị cùng lúc, chất lượng SD (480p).",
    priceAmount: 79_000, maxHeight: 480, maxConcurrentStreams: 1, sortOrder: 1,
  },
  {
    code: "standard", name: "Tiêu chuẩn", description: "Xem trên 2 thiết bị cùng lúc, chất lượng Full HD (1080p).",
    priceAmount: 149_000, maxHeight: 1080, maxConcurrentStreams: 2, sortOrder: 2,
  },
  {
    code: "premium", name: "Cao cấp", description: "Xem trên 4 thiết bị cùng lúc, chất lượng Full HD (1080p).",
    priceAmount: 219_000, maxHeight: 1080, maxConcurrentStreams: 4, sortOrder: 3,
  },
] as const;

interface SeedUser {
  email: string;
  password: string;
  role: UserRole;
  profiles: { name: string; avatarKey: string; isKids?: boolean }[];
  planCode?: string;
}

const USERS: SeedUser[] = [
  { email: "admin@example.com", password: "Admin@12345", role: "ADMIN", profiles: [{ name: "Admin", avatarKey: "avatar-1" }] },
  {
    email: "demo@example.com", password: "Demo@12345", role: "USER", planCode: "standard",
    profiles: [{ name: "Demo", avatarKey: "avatar-2" }, { name: "Trẻ em", avatarKey: "avatar-5", isKids: true }],
  },
  { email: "free@example.com", password: "Free@12345", role: "USER", profiles: [{ name: "Free", avatarKey: "avatar-3" }] },
];

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

async function main() {
  for (const p of PLANS) {
    await prisma.plan.upsert({
      where: { code: p.code },
      create: { ...p, currency: "VND", intervalMonths: 1, maxProfiles: 5, isActive: true },
      update: { ...p },
    });
  }
  console.log(`✓ ${PLANS.length} gói`);

  for (const u of USERS) {
    const passwordHash = await argon2.hash(u.password, { type: argon2.argon2id });
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, passwordHash, role: u.role, emailVerifiedAt: new Date() },
      update: { passwordHash, role: u.role, disabledAt: null },
    });
    if (!user.emailVerifiedAt) await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });

    const profileCount = await prisma.profile.count({ where: { userId: user.id } });
    if (profileCount === 0) {
      for (const p of u.profiles) {
        await prisma.profile.create({ data: { userId: user.id, name: p.name, avatarKey: p.avatarKey, isKids: p.isKids ?? false } });
      }
    }

    if (u.planCode) {
      const now = new Date();
      const plan = await prisma.plan.findUniqueOrThrow({ where: { code: u.planCode } });
      const active = await prisma.subscription.findFirst({
        where: { userId: user.id, status: "ACTIVE", currentPeriodEnd: { gt: now } },
      });
      if (!active) {
        await prisma.subscription.create({
          data: {
            userId: user.id, planId: plan.id, status: "ACTIVE", currentPeriodStart: now,
            currentPeriodEnd: addMonths(now, 12), provider: "manual", note: "seed",
          },
        });
      }
    }
    console.log(`✓ ${u.email} / ${u.password} (${u.role}${u.planCode ? `, gói ${u.planCode}` : ""})`);
  }
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
