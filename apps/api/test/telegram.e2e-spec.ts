import { randomBytes, randomInt } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { PrismaService } from "../src/infra/prisma.service.js";
import { type MailMessage, MailService } from "../src/modules/auth/mail.service.js";
import { signInitData } from "../src/modules/telegram/init-data.js";
import { CookieJar, createTestApp, setCookies } from "./accounts.helpers.js";

const RUN = `tg-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
const email = (tag: string) => `${RUN}-${tag}@test.local`;
const PASSWORD = "Passw0rd!";
const TOKEN = `${randomInt(1e6, 9e6)}:e2e-${randomBytes(8).toString("hex")}`;
// Telegram id ngẫu nhiên lớn để không đụng dữ liệu dev
const tgId = () => 7_000_000_000 + randomInt(0, 2 ** 31);

function initData(id: number, extra: Record<string, unknown> = {}, token = TOKEN) {
  return signInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "AAE2E",
      user: JSON.stringify({ id, first_name: "Minh", username: `u${id}`, language_code: "vi", ...extra }),
    },
    token,
  );
}

describe("telegram (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  const http = () => request(app.getHttpServer());

  async function register(tag: string) {
    const jar = new CookieJar();
    const res = await http().post("/v1/auth/register").send({ email: email(tag), password: PASSWORD }).expect(201);
    jar.update(res);
    return { jar, userId: res.body.user.id as string };
  }

  beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const mail = app.get(MailService, { strict: false });
    vi.spyOn(mail, "sendInBackground").mockImplementation((_m: MailMessage) => undefined);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
    process.env.TELEGRAM_BOT_TOKEN = prevToken;
    await app.close();
  });

  it("not linked → linked:false and no cookies", async () => {
    const res = await http().post("/v1/auth/telegram").send({ initData: initData(tgId()) }).expect(200);
    expect(res.body).toEqual({ linked: false, telegramUser: { firstName: "Minh", username: expect.stringMatching(/^u\d+$/) } });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects bad initData with 401 and validates body", async () => {
    const bad = initData(tgId(), {}, "1:wrong-token");
    const res = await http().post("/v1/auth/telegram").send({ initData: bad }).expect(401);
    expect(res.body.code).toBe("TELEGRAM_INIT_DATA_INVALID");
    await http().post("/v1/auth/telegram").send({}).expect(400);
  });

  it("link while logged in → login via initData sets session + auto-selects the only profile → unlink", async () => {
    const id = tgId();
    const { jar, userId } = await register("link");

    await http().post("/v1/auth/telegram/link").send({ initData: initData(id) }).expect(401);
    const st0 = await http().get("/v1/auth/telegram/link").set("Cookie", jar.header()).expect(200);
    expect(st0.body).toEqual({ available: true, link: null });

    const linked = await http().post("/v1/auth/telegram/link").set("Cookie", jar.header()).send({ initData: initData(id) }).expect(200);
    expect(linked.body.link).toMatchObject({ telegramUserId: String(id), firstName: "Minh", username: `u${id}` });
    expect(linked.body.profile).toMatchObject({ isKids: false });
    expect(setCookies(linked).pid?.value).toBe(linked.body.profile.id);
    // Idempotent
    await http().post("/v1/auth/telegram/link").set("Cookie", jar.header()).send({ initData: initData(id) }).expect(200);

    const login = await http().post("/v1/auth/telegram").send({ initData: initData(id, { first_name: "Minh2" }) }).expect(200);
    expect(login.body).toMatchObject({ linked: true, user: { id: userId, email: email("link") } });
    expect(login.body.profile).toMatchObject({ isKids: false });
    const cookies = setCookies(login);
    expect(cookies.at?.value).toBeTruthy();
    expect(cookies.rt?.attrs).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookies.rt?.attrs).toMatch(/HttpOnly/i);
    expect(cookies.at?.attrs).toMatch(/SameSite=Lax/i);
    expect(cookies.pid?.value).toBe(login.body.profile.id);

    const tgJar = new CookieJar().update(login);
    const me = await http().get("/v1/auth/me").set("Cookie", tgJar.header()).expect(200);
    expect(me.body.user.id).toBe(userId);
    expect(me.body.profile?.id).toBe(login.body.profile.id);
    // Thông tin hiển thị được cập nhật
    const st1 = await http().get("/v1/auth/telegram/link").set("Cookie", tgJar.header()).expect(200);
    expect(st1.body.link.firstName).toBe("Minh2");

    await http().delete("/v1/auth/telegram/link").set("Cookie", jar.header()).expect(204);
    const after = await http().post("/v1/auth/telegram").send({ initData: initData(id) }).expect(200);
    expect(after.body.linked).toBe(false);
  });

  it("no auto profile when several adult profiles, but keeps a recoverable pid", async () => {
    const id = tgId();
    const { jar } = await register("multi");
    const extra = await http().post("/v1/profiles").set("Cookie", jar.header()).send({ name: "Hai", avatarKey: "avatar-2" }).expect(201);
    await http().post("/v1/auth/telegram/link").set("Cookie", jar.header()).send({ initData: initData(id) }).expect(200);

    const a = await http().post("/v1/auth/telegram").send({ initData: initData(id) }).expect(200);
    expect(a.body).toMatchObject({ linked: true, profile: null });
    expect(setCookies(a).pid).toBeUndefined();

    const b = await http().post("/v1/auth/telegram").set("Cookie", `pid=${extra.body.id}`).send({ initData: initData(id) }).expect(200);
    expect(b.body.profile?.id).toBe(extra.body.id);

    // pid của người khác → bị xóa
    const c = await http().post("/v1/auth/telegram").set("Cookie", "pid=01a1e3ee-0000-7000-8000-000000000000").send({ initData: initData(id) }).expect(200);
    expect(c.body.profile).toBeNull();
    expect(setCookies(c).pid?.attrs).toMatch(/Expires=Thu, 01 Jan 1970/i);
  });

  it("conflicts → 409", async () => {
    const id1 = tgId();
    const id2 = tgId();
    const u1 = await register("c1");
    const u2 = await register("c2");
    await http().post("/v1/auth/telegram/link").set("Cookie", u1.jar.header()).send({ initData: initData(id1) }).expect(200);

    // Telegram id đã gắn user khác
    const r1 = await http().post("/v1/auth/telegram/link").set("Cookie", u2.jar.header()).send({ initData: initData(id1) }).expect(409);
    expect(r1.body.code).toBe("TELEGRAM_LINK_CONFLICT");
    // User đã gắn Telegram id khác
    const r2 = await http().post("/v1/auth/telegram/link").set("Cookie", u1.jar.header()).send({ initData: initData(id2) }).expect(409);
    expect(r2.body.code).toBe("TELEGRAM_LINK_CONFLICT");
  });

  it("disabled user cannot log in via Telegram", async () => {
    const id = tgId();
    const { jar, userId } = await register("dis");
    await http().post("/v1/auth/telegram/link").set("Cookie", jar.header()).send({ initData: initData(id) }).expect(200);
    await prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    const res = await http().post("/v1/auth/telegram").send({ initData: initData(id) }).expect(403);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("AUTH_COOKIE_SAMESITE=none → SameSite=None; Secure; Partitioned + Origin check on writes", async () => {
    const id = tgId();
    const { jar } = await register("xsite");
    await http().post("/v1/auth/telegram/link").set("Cookie", jar.header()).send({ initData: initData(id) }).expect(200);
    const prev = { s: process.env.AUTH_COOKIE_SAMESITE, p: process.env.AUTH_COOKIE_PARTITIONED };
    process.env.AUTH_COOKIE_SAMESITE = "none";
    process.env.AUTH_COOKIE_PARTITIONED = "true";
    try {
      const web = new URL(process.env.PUBLIC_WEB_URL ?? "http://localhost:3000").origin;
      const ok = await http().post("/v1/auth/telegram").set("Origin", web).send({ initData: initData(id) }).expect(200);
      const c = setCookies(ok);
      expect(c.at?.attrs).toMatch(/SameSite=None/i);
      expect(c.at?.attrs).toMatch(/Secure/i);
      expect(c.at?.attrs).toMatch(/Partitioned/i);
      const evil = await http().post("/v1/auth/telegram").set("Origin", "https://evil.example").send({ initData: initData(id) }).expect(403);
      expect(evil.body.code).toBe("FORBIDDEN");
      // GET và request không có Origin (server-to-server) không bị ảnh hưởng
      await http().get("/v1/auth/telegram/link").set("Origin", "https://evil.example").set("Cookie", jar.header()).expect(200);
      await http().post("/v1/auth/telegram").send({ initData: initData(id) }).expect(200);
    } finally {
      process.env.AUTH_COOKIE_SAMESITE = prev.s;
      process.env.AUTH_COOKIE_PARTITIONED = prev.p;
      if (prev.s === undefined) delete process.env.AUTH_COOKIE_SAMESITE;
      if (prev.p === undefined) delete process.env.AUTH_COOKIE_PARTITIONED;
    }
  });

  it("503 when TELEGRAM_BOT_TOKEN is unset; status still works", async () => {
    const { jar } = await register("off");
    process.env.TELEGRAM_BOT_TOKEN = "";
    try {
      const res = await http().post("/v1/auth/telegram").send({ initData: initData(tgId()) }).expect(503);
      expect(res.body).toMatchObject({ statusCode: 503, code: "TELEGRAM_UNAVAILABLE" });
      await http().post("/v1/auth/telegram/link").set("Cookie", jar.header()).send({ initData: initData(tgId()) }).expect(503);
      const st = await http().get("/v1/auth/telegram/link").set("Cookie", jar.header()).expect(200);
      expect(st.body).toEqual({ available: false, link: null });
      await http().post("/v1/auth/login").send({ email: email("off"), password: PASSWORD }).expect(200);
    } finally {
      process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    }
  });
});
