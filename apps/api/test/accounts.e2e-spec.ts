import { randomBytes } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { PrismaService } from "../src/infra/prisma.service.js";
import { RedisService } from "../src/infra/redis.service.js";
import { BillingService } from "../src/modules/billing/billing.service.js";
import { type MailMessage, MailService } from "../src/modules/auth/mail.service.js";
import { CookieJar, createTestApp, setCookies } from "./accounts.helpers.js";

const RUN = `acct-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
const email = (tag: string) => `${RUN}-${tag}@test.local`;
const PASSWORD = "Passw0rd!";

describe("accounts (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  const mails: MailMessage[] = [];
  const createdPlanCodes: string[] = [];

  const http = () => request(app.getHttpServer());
  const tokenFromMail = (to: string, path: string): string => {
    const msg = [...mails].reverse().find((m) => m.to === to && m.text.includes(path));
    expect(msg, `mail ${path} tới ${to}`).toBeDefined();
    const m = /token=([A-Za-z0-9_%-]+)/.exec(msg!.text);
    return decodeURIComponent(m![1]!);
  };

  async function register(tag: string) {
    const jar = new CookieJar();
    const res = await http().post("/v1/auth/register").send({ email: email(tag), password: PASSWORD }).expect(201);
    jar.update(res);
    return { jar, res, email: email(tag), userId: res.body.user.id as string };
  }
  async function login(addr: string, password = PASSWORD) {
    const jar = new CookieJar();
    const res = await http().post("/v1/auth/login").send({ email: addr, password });
    jar.update(res);
    return { jar, res };
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    const mail = app.get(MailService, { strict: false });
    vi.spyOn(mail, "sendInBackground").mockImplementation((m: MailMessage) => { mails.push(m); });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
    if (createdPlanCodes.length) await prisma.plan.deleteMany({ where: { code: { in: createdPlanCodes } } });
    await app.close();
  });

  describe("auth", () => {
    it("register → cookies → me, default profile, verify email", async () => {
      const { jar, res, email: addr } = await register("reg");
      expect(res.body.user).toMatchObject({ email: addr, role: "USER", emailVerified: false });
      const cookies = setCookies(res);
      expect(cookies.at!.attrs).toMatch(/Path=\//);
      expect(cookies.at!.attrs).toMatch(/HttpOnly/);
      expect(cookies.at!.attrs).toMatch(/SameSite=Lax/);
      expect(cookies.rt!.attrs).toMatch(/Path=\/api\/v1\/auth/);

      const me = await http().get("/v1/auth/me").set("Cookie", jar.header()).expect(200);
      expect(me.body).toMatchObject({ user: { email: addr }, subscription: null, profile: null });

      const profiles = await http().get("/v1/profiles").set("Cookie", jar.header()).expect(200);
      expect(profiles.body).toHaveLength(1);
      expect(profiles.body[0].name.toLowerCase()).toContain("reg");
      expect(profiles.body[0].avatarUrl).toMatch(/^\/avatars\/avatar-[1-8]\.svg$/);

      const token = tokenFromMail(addr, "/verify-email?token=");
      await http().post("/v1/auth/verify-email").send({ token }).expect(204);
      await http().post("/v1/auth/verify-email").send({ token }).expect(400).expect((r) => expect(r.body.code).toBe("TOKEN_INVALID"));
      const me2 = await http().get("/v1/auth/me").set("Cookie", jar.header()).expect(200);
      expect(me2.body.user.emailVerified).toBe(true);
    });

    it("rejects duplicate email, weak password, unauthenticated me", async () => {
      await register("dup");
      const dup = await http().post("/v1/auth/register").send({ email: email("dup").toUpperCase(), password: PASSWORD }).expect(409);
      expect(dup.body.code).toBe("EMAIL_TAKEN");
      const weak = await http().post("/v1/auth/register").send({ email: email("weak"), password: "short" }).expect(400);
      expect(weak.body.code).toBe("VALIDATION");
      await http().get("/v1/auth/me").expect(401).expect((r) => expect(r.body.code).toBe("UNAUTHENTICATED"));
    });

    it("login with wrong password → 401 INVALID_CREDENTIALS", async () => {
      await register("login");
      const bad = await login(email("login"), "wrong-password");
      expect(bad.res.status).toBe(401);
      expect(bad.res.body.code).toBe("INVALID_CREDENTIALS");
      const unknown = await login(email("nobody"), PASSWORD);
      expect(unknown.res.status).toBe(401);
      const ok = await login(email("login"));
      expect(ok.res.status).toBe(200);
      expect(ok.jar.get("at")).toBeTruthy();
    });

    it("refresh rotates the token and detects reuse", async () => {
      const { jar } = await register("refresh");
      const rt1 = jar.get("rt")!;
      const r1 = await http().post("/v1/auth/refresh").set("Cookie", `rt=${rt1}`).expect(200);
      const rt2 = setCookies(r1).rt!.value;
      expect(rt2).not.toBe(rt1);
      expect(setCookies(r1).at!.value).toBeTruthy();

      // Request song song dùng lại rt1 ngay lập tức → được trả cùng rt2 (cửa sổ ân hạn).
      const graceRes = await http().post("/v1/auth/refresh").set("Cookie", `rt=${rt1}`).expect(200);
      expect(setCookies(graceRes).rt!.value).toBe(rt2);

      const r2 = await http().post("/v1/auth/refresh").set("Cookie", `rt=${rt2}`).expect(200);
      const rt3 = setCookies(r2).rt!.value;

      // Hết cửa sổ ân hạn: dùng lại rt1 → thu hồi cả phiên, rt3 cũng chết.
      const keys = await redis.keys("rt:grace:*");
      if (keys.length) await redis.del(...keys);
      await http().post("/v1/auth/refresh").set("Cookie", `rt=${rt1}`).expect(401);
      await http().post("/v1/auth/refresh").set("Cookie", `rt=${rt3}`).expect(401);
      await http().post("/v1/auth/refresh").expect(401);
    });

    it("logout revokes the session and clears cookies", async () => {
      const { jar } = await register("logout");
      const res = await http().post("/v1/auth/logout").set("Cookie", jar.header()).expect(204);
      const cleared = setCookies(res);
      expect(cleared.at!.value).toBe("");
      expect(cleared.rt!.value).toBe("");
      await http().post("/v1/auth/refresh").set("Cookie", `rt=${jar.get("rt")}`).expect(401);
      await http().get("/v1/auth/me").set("Cookie", jar.header()).expect(401);
    });

    it("lists and revokes device sessions", async () => {
      const { jar } = await register("sessions");
      const other = await login(email("sessions"));
      const list = await http().get("/v1/auth/sessions").set("Cookie", jar.header()).expect(200);
      expect(list.body).toHaveLength(2);
      expect(list.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
      const otherSession = list.body.find((s: { current: boolean }) => !s.current);
      await http().delete(`/v1/auth/sessions/${otherSession.id}`).set("Cookie", jar.header()).expect(204);
      await http().post("/v1/auth/refresh").set("Cookie", `rt=${other.jar.get("rt")}`).expect(401);
      const after = await http().get("/v1/auth/sessions").set("Cookie", jar.header()).expect(200);
      expect(after.body).toHaveLength(1);
      await http().delete(`/v1/auth/sessions/${otherSession.id}`).set("Cookie", jar.header()).expect(404);
    });

    it("forgot → reset password flow revokes all sessions", async () => {
      const { jar, email: addr } = await register("reset");
      await http().post("/v1/auth/forgot-password").send({ email: email("unknown") }).expect(204);
      await http().post("/v1/auth/forgot-password").send({ email: addr }).expect(204);
      const token = tokenFromMail(addr, "/reset-password?token=");

      await http().post("/v1/auth/reset-password").send({ token, password: "short" }).expect(400);
      await http().post("/v1/auth/reset-password").send({ token, password: "NewPassw0rd!" }).expect(204);
      await http().post("/v1/auth/reset-password").send({ token, password: "Another0rd!" }).expect(400)
        .expect((r) => expect(r.body.code).toBe("TOKEN_INVALID"));

      await http().post("/v1/auth/refresh").set("Cookie", `rt=${jar.get("rt")}`).expect(401);
      expect((await login(addr)).res.status).toBe(401);
      const ok = await login(addr, "NewPassw0rd!");
      expect(ok.res.status).toBe(200);
      expect(ok.res.body.user.emailVerified).toBe(true);
    });
  });

  describe("profiles", () => {
    it("CRUD, limit, select, delete rules", async () => {
      const { jar } = await register("profiles");
      const auth = () => jar.header();

      const avatars = await http().get("/v1/profiles/avatars").set("Cookie", auth()).expect(200);
      expect(avatars.body).toHaveLength(8);
      expect(avatars.body[0]).toEqual({ key: "avatar-1", url: "/avatars/avatar-1.svg" });

      await http().post("/v1/profiles").set("Cookie", auth()).send({ name: "X", avatarKey: "nope" }).expect(400);
      await http().post("/v1/profiles").set("Cookie", auth()).send({ name: "", avatarKey: "avatar-1" }).expect(400);

      const created: string[] = [];
      for (let i = 2; i <= 5; i++) {
        const r = await http().post("/v1/profiles").set("Cookie", auth())
          .send({ name: `P${i}`, avatarKey: `avatar-${i}`, isKids: i === 5 }).expect(201);
        expect(r.body).toMatchObject({ name: `P${i}`, avatarKey: `avatar-${i}`, isKids: i === 5, language: "vi" });
        created.push(r.body.id);
      }
      const limit = await http().post("/v1/profiles").set("Cookie", auth()).send({ name: "P6", avatarKey: "avatar-6" }).expect(409);
      expect(limit.body.code).toBe("PROFILE_LIMIT");

      const patched = await http().patch(`/v1/profiles/${created[0]}`).set("Cookie", auth())
        .send({ name: "Renamed", language: "en" }).expect(200);
      expect(patched.body).toMatchObject({ name: "Renamed", language: "en", avatarKey: "avatar-2" });

      // select → cookie pid, me trả profile
      const sel = await http().post(`/v1/profiles/${created[1]}/select`).set("Cookie", auth()).expect(200);
      expect(sel.body.id).toBe(created[1]);
      expect(setCookies(sel).pid!.attrs).toMatch(/Path=\/;.*HttpOnly|HttpOnly.*Path=\//);
      jar.update(sel);
      expect(jar.get("pid")).toBe(created[1]);
      const me = await http().get("/v1/auth/me").set("Cookie", auth()).expect(200);
      expect(me.body.profile.id).toBe(created[1]);

      // profile của user khác → 404
      const other = await register("profiles-other");
      await http().post(`/v1/profiles/${created[0]}/select`).set("Cookie", other.jar.header()).expect(404);
      await http().delete(`/v1/profiles/${created[0]}`).set("Cookie", other.jar.header()).expect(404);

      // xóa profile đang chọn → xóa cookie pid
      const del = await http().delete(`/v1/profiles/${created[1]}`).set("Cookie", auth()).expect(204);
      expect(setCookies(del).pid!.value).toBe("");
      jar.update(del);

      const remaining = (await http().get("/v1/profiles").set("Cookie", auth()).expect(200)).body as { id: string }[];
      for (const p of remaining.slice(1)) await http().delete(`/v1/profiles/${p.id}`).set("Cookie", auth()).expect(204);
      const last = await http().delete(`/v1/profiles/${remaining[0]!.id}`).set("Cookie", auth()).expect(409);
      expect(last.body.code).toBe("CONFLICT");
      await http().get("/v1/profiles").set("Cookie", auth()).expect(200).expect((r) => expect(r.body).toHaveLength(1));
    });
  });

  describe("billing + admin", () => {
    let adminJar: CookieJar;
    let userJar: CookieJar;
    let userId: string;

    beforeAll(async () => {
      const admin = await register("admin");
      await prisma.user.update({ where: { id: admin.userId }, data: { role: "ADMIN" } });
      adminJar = (await login(admin.email)).jar;
      const user = await register("subscriber");
      userJar = user.jar;
      userId = user.userId;
      // Đảm bảo có gói (seed có thể chưa chạy trên DB test).
      for (const [code, sortOrder] of [["basic", 1], ["standard", 2]] as const) {
        const exists = await prisma.plan.findUnique({ where: { code } });
        if (!exists) {
          await prisma.plan.create({ data: { code, name: code, priceAmount: 1000 * sortOrder, maxHeight: 1080, maxConcurrentStreams: sortOrder, sortOrder } });
          createdPlanCodes.push(code);
        }
      }
    });

    it("GET /plans is public, active only, sorted", async () => {
      const r = await http().get("/v1/plans").expect(200);
      expect(r.body.length).toBeGreaterThan(0);
      expect(r.body.every((p: { isActive: boolean }) => p.isActive)).toBe(true);
      const orders = r.body.map((p: { sortOrder: number }) => p.sortOrder);
      expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    });

    it("non-admin gets 403 on admin routes, anonymous 401", async () => {
      await http().get("/v1/admin/users").set("Cookie", userJar.header()).expect(403)
        .expect((r) => expect(r.body.code).toBe("FORBIDDEN"));
      await http().post(`/v1/admin/users/${userId}/subscription`).set("Cookie", userJar.header())
        .send({ planCode: "standard", months: 1 }).expect(403);
      await http().get("/v1/admin/plans").set("Cookie", userJar.header()).expect(403);
      await http().get("/v1/admin/users").expect(401);
    });

    it("admin grants, extends and revokes a subscription", async () => {
      await http().get("/v1/subscription").set("Cookie", userJar.header()).expect(200).expect((r) => expect(r.body).toBeNull());

      const g1 = await http().post(`/v1/admin/users/${userId}/subscription`).set("Cookie", adminJar.header())
        .send({ planCode: "standard", months: 1, note: "test" }).expect(200);
      expect(g1.body).toMatchObject({ status: "ACTIVE", provider: "manual", plan: { code: "standard" } });

      const sub = await http().get("/v1/subscription").set("Cookie", userJar.header()).expect(200);
      expect(sub.body).toMatchObject({ id: g1.body.id, status: "ACTIVE", plan: { code: "standard" } });
      const me = await http().get("/v1/auth/me").set("Cookie", userJar.header()).expect(200);
      expect(me.body.subscription.status).toBe("ACTIVE");

      // Gia hạn: cộng từ currentPeriodEnd hiện tại.
      const g2 = await http().post(`/v1/admin/users/${userId}/subscription`).set("Cookie", adminJar.header())
        .send({ planCode: "standard", months: 2 }).expect(200);
      expect(g2.body.id).toBe(g1.body.id);
      const end1 = new Date(g1.body.currentPeriodEnd).getTime();
      const end2 = new Date(g2.body.currentPeriodEnd).getTime();
      expect(end2 - end1).toBeGreaterThan(58 * 86_400_000);
      expect(end2 - end1).toBeLessThan(63 * 86_400_000);

      await http().post(`/v1/admin/users/${userId}/subscription`).set("Cookie", adminJar.header())
        .send({ planCode: "nope", months: 1 }).expect(404);
      await http().post(`/v1/admin/users/${userId}/subscription`).set("Cookie", adminJar.header())
        .send({ planCode: "standard", months: 0 }).expect(400);

      const list = await http().get("/v1/admin/users").query({ q: `${RUN}-subscriber`, page: 1 }).set("Cookie", adminJar.header()).expect(200);
      expect(list.body).toMatchObject({ page: 1, total: 1, hasMore: false });
      expect(list.body.items[0]).toMatchObject({ id: userId, disabled: false, profileCount: 1, subscription: { status: "ACTIVE" } });

      await http().delete(`/v1/admin/users/${userId}/subscription`).set("Cookie", adminJar.header()).expect(204);
      const after = await http().get("/v1/subscription").set("Cookie", userJar.header()).expect(200);
      expect(after.body.status).toBe("CANCELED");
    });

    it("expires subscriptions past their period end", async () => {
      const g = await http().post(`/v1/admin/users/${userId}/subscription`).set("Cookie", adminJar.header())
        .send({ planCode: "basic", months: 1 }).expect(200);
      await prisma.subscription.update({ where: { id: g.body.id }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
      expect(await app.get(BillingService).expireDue()).toBeGreaterThanOrEqual(1);
      const s = await prisma.subscription.findUniqueOrThrow({ where: { id: g.body.id } });
      expect(s.status).toBe("EXPIRED");
    });

    it("admin disables a user and changes role", async () => {
      const victim = await register("victim");
      const r = await http().patch(`/v1/admin/users/${victim.userId}`).set("Cookie", adminJar.header()).send({ disabled: true }).expect(200);
      expect(r.body.disabled).toBe(true);
      await http().post("/v1/auth/refresh").set("Cookie", `rt=${victim.jar.get("rt")}`).expect(401);
      expect((await login(victim.email)).res.status).toBe(403);
      await http().patch(`/v1/admin/users/${victim.userId}`).set("Cookie", adminJar.header()).send({ disabled: false, role: "ADMIN" }).expect(200)
        .expect((x) => expect(x.body).toMatchObject({ disabled: false, role: "ADMIN" }));
      const me = (await http().get("/v1/auth/me").set("Cookie", adminJar.header()).expect(200)).body;
      await http().patch(`/v1/admin/users/${me.user.id}`).set("Cookie", adminJar.header()).send({ disabled: true }).expect(409);
    });

    it("admin manages plans", async () => {
      const code = `t${randomBytes(4).toString("hex")}`;
      createdPlanCodes.push(code);
      const body = { code, name: "Test", description: null, priceAmount: 1000, currency: "VND", intervalMonths: 1, maxHeight: 720, maxConcurrentStreams: 1, maxProfiles: 2, isActive: false, sortOrder: 99 };
      const c = await http().post("/v1/admin/plans").set("Cookie", adminJar.header()).send(body).expect(201);
      expect(c.body).toMatchObject(body);
      await http().post("/v1/admin/plans").set("Cookie", adminJar.header()).send(body).expect(409);
      const all = await http().get("/v1/admin/plans").set("Cookie", adminJar.header()).expect(200);
      expect(all.body.some((p: { code: string }) => p.code === code)).toBe(true);
      const pub = await http().get("/v1/plans").expect(200);
      expect(pub.body.some((p: { code: string }) => p.code === code)).toBe(false);
      const u = await http().patch(`/v1/admin/plans/${c.body.id}`).set("Cookie", adminJar.header()).send({ priceAmount: 2000, isActive: true }).expect(200);
      expect(u.body).toMatchObject({ priceAmount: 2000, isActive: true });
    });
  });
});
