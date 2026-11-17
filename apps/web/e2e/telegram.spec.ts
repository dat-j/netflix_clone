import { createHmac, randomBytes, randomInt } from "node:crypto";
import path from "node:path";
import type { HomeResponse, ProfileDto, TitleDetail } from "@app/shared";
import { type BrowserContext, expect, test } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { ACCOUNTS, hydrated } from "./helpers";

/**
 * Telegram Mini App flows against the running dev servers, with a fake `window.Telegram.WebApp` whose initData is
 * signed with the API's TELEGRAM_BOT_TOKEN (a local test value in the root .env). Self-contained: no setup project.
 *   pnpm exec playwright test e2e/telegram.spec.ts --project=chromium --no-deps
 */
loadEnv({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });
const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TITLE_SLUG = process.env.E2E_TG_TITLE_SLUG ?? "mua-hoa-gao-do";
const PASSWORD = "Passw0rd!tg";

function signInitData(user: Record<string, unknown>) {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `AAE${randomBytes(6).toString("hex")}`,
    user: JSON.stringify(user),
  };
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  return new URLSearchParams({ ...fields, hash: createHmac("sha256", secret).update(dcs).digest("hex") }).toString();
}

/** Minimal stand-in for telegram-web-app.js; records calls in window.__tgCalls. */
async function fakeTelegram(context: BrowserContext, initData: string) {
  await context.addInitScript((data: string) => {
    const calls: string[] = [];
    const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    const back = {
      isVisible: false,
      show() { back.isVisible = true; calls.push("BackButton.show"); return back; },
      hide() { back.isVisible = false; calls.push("BackButton.hide"); return back; },
      onClick() { return back; },
      offClick() { return back; },
    };
    const wa = {
      initData: data,
      initDataUnsafe: {},
      version: "8.0",
      platform: "android",
      colorScheme: "dark",
      themeParams: {},
      isExpanded: false,
      isFullscreen: false,
      isVersionAtLeast: (v: string) => Number(v) <= 8,
      ready: () => calls.push("ready"),
      expand: () => calls.push("expand"),
      close: () => calls.push("close"),
      requestFullscreen: () => {
        wa.isFullscreen = true;
        calls.push("requestFullscreen");
        for (const h of handlers.fullscreenChanged ?? []) h();
      },
      exitFullscreen: () => {
        wa.isFullscreen = false;
        calls.push("exitFullscreen");
        for (const h of handlers.fullscreenChanged ?? []) h();
      },
      disableVerticalSwipes: () => calls.push("disableVerticalSwipes"),
      enableVerticalSwipes: () => calls.push("enableVerticalSwipes"),
      setHeaderColor: (c: string) => calls.push(`setHeaderColor:${c}`),
      setBackgroundColor: (c: string) => calls.push(`setBackgroundColor:${c}`),
      setBottomBarColor: () => undefined,
      openLink: (u: string) => calls.push(`openLink:${u}`),
      onEvent: (e: string, h: () => void) => { (handlers[e] ??= []).push(h); },
      offEvent: (e: string, h: () => void) => { handlers[e] = (handlers[e] ?? []).filter((x) => x !== h); },
      BackButton: back,
    };
    Object.assign(window, { Telegram: { WebApp: wa }, __tgCalls: calls });
  }, initData);
}

test.describe("Telegram Mini App", () => {
  test.skip(!TOKEN, "TELEGRAM_BOT_TOKEN must be set in the root .env (and in the running API)");
  test.use({ viewport: { width: 400, height: 800 } });

  const tgUser = { id: 8_000_000_000 + randomInt(0, 2 ** 30), first_name: "Playwright", username: "pw_tester", language_code: "vi" };
  const email = `tg-e2e-${Date.now().toString(36)}@test.local`;

  test("outside Telegram → friendly message with a link to the website", async ({ page }) => {
    await page.goto("/tg?to=%2Fbrowse");
    await expect(page.getByRole("heading", { name: "Mở BoxPhim từ Telegram" })).toBeVisible();
    await expect(page.getByTestId("tg-website")).toHaveAttribute("href", "/browse");
    await expect(page.getByTestId("tg-open-bot")).toHaveAttribute("href", /^https:\/\/t\.me\/[A-Za-z0-9_]+$/);
  });

  test("link a new account from the Mini App, then auto sign-in, open-redirect guards", async ({ browser }) => {
    test.setTimeout(120_000);
    // ── 1st launch: not linked → sign up → link → lands on the requested title
    const ctx1 = await browser.newContext();
    await fakeTelegram(ctx1, signInitData(tgUser));
    const page = await ctx1.newPage();
    await page.goto(`/tg?to=${encodeURIComponent(`/title/${TITLE_SLUG}`)}`);
    await expect(page.getByRole("heading", { name: "Liên kết tài khoản BoxPhim" })).toBeVisible();
    await expect(page.getByText("Chào Playwright!")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __tgCalls: string[] }).__tgCalls)).toEqual(
      expect.arrayContaining(["ready", "expand", "setHeaderColor:#141414"]),
    );

    await page.getByTestId("tg-signup").click();
    await page.waitForURL(/\/signup\?next=/);
    await hydrated(page);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Nhập lại mật khẩu").fill(PASSWORD);
    await page.getByRole("button", { name: "Tiếp theo" }).click();
    await page.waitForURL(new RegExp(`/title/${TITLE_SLUG}$`), { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    // Mini App mode survives the hard navigation (sessionStorage flag) and the compact header is applied
    await expect(page.locator("html")).toHaveAttribute("data-tg", "android");
    await expect.poll(() => page.evaluate(() => (window as unknown as { Telegram: { WebApp: { BackButton: { isVisible: boolean } } } }).Telegram.WebApp.BackButton.isVisible)).toBe(true);

    // The account page shows the link
    await page.goto("/account");
    await expect(page.getByTestId("telegram-linked")).toContainText("@pw_tester");
    await ctx1.close();

    // ── 2nd launch in a fresh webview (no cookies): auto sign-in straight to the target
    const ctx2 = await browser.newContext();
    await fakeTelegram(ctx2, signInitData(tgUser));
    const p2 = await ctx2.newPage();
    await p2.goto("/tg?to=%2Fmy-list");
    await p2.waitForURL(/\/my-list$/, { timeout: 30_000 });
    const cookies = await ctx2.cookies();
    expect(cookies.map((c) => c.name)).toEqual(expect.arrayContaining(["at", "rt", "pid"]));

    // ── Open-redirect attempts all fall back to /browse (full matrix: src/lib/mini-app-path.test.ts)
    for (const evil of ["https://evil.example/x", "//evil.example", "/\\evil.example", "/admin"]) {
      await p2.goto(`/tg?to=${encodeURIComponent(evil)}`);
      await p2.waitForURL((u) => u.pathname === "/browse" || u.hostname !== "localhost", { timeout: 30_000 });
      expect(new URL(p2.url()).host, `to=${evil}`).toBe("localhost:3000");
      expect(new URL(p2.url()).pathname, `to=${evil}`).toBe("/browse");
    }
    // Allowed search path keeps its query
    await p2.goto(`/tg?to=${encodeURIComponent("/search?q=mưa hoa")}`);
    await p2.waitForURL(/\/search\?q=/);
    expect(new URL(p2.url()).searchParams.get("q")).toBe("mưa hoa");
    await ctx2.close();
  });

  test("existing account: sign in from the Mini App → link → title; unlink from /account", async ({ browser, request }) => {
    test.setTimeout(90_000);
    const user = { ...tgUser, id: tgUser.id + 1, username: "pw_login" };
    const addr = `tg-e2e-login-${Date.now().toString(36)}@test.local`;
    expect((await request.post("/api/v1/auth/register", { data: { email: addr, password: PASSWORD } })).ok()).toBeTruthy();

    const ctx = await browser.newContext();
    await fakeTelegram(ctx, signInitData(user));
    const page = await ctx.newPage();
    await page.goto(`/tg?to=${encodeURIComponent(`/title/${TITLE_SLUG}`)}`);
    await page.getByTestId("tg-login").click();
    await page.waitForURL(/\/login\?next=/);
    await hydrated(page);
    await page.getByLabel("Email").fill(addr);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await page.waitForURL(new RegExp(`/title/${TITLE_SLUG}$`), { timeout: 30_000 });

    await page.goto("/account");
    await page.getByTestId("telegram-linked").getByRole("button", { name: "Hủy liên kết" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Hủy liên kết" }).click();
    await expect(page.getByTestId("telegram-unlinked")).toBeVisible();
    // Still signed in on this webview, but Telegram is no longer linked → the entry offers to link this account
    await page.goto("/tg");
    await expect(page.getByTestId("tg-link-current")).toBeVisible();
    await expect(page.getByText(addr)).toBeVisible();
    await ctx.close();
  });

  test("player inside Telegram uses WebApp.requestFullscreen and the native BackButton", async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await fakeTelegram(ctx, signInitData({ ...tgUser, id: tgUser.id + 2 }));
    await ctx.addInitScript(() => sessionStorage.setItem("bp_tg", "1"));
    const req = ctx.request;
    expect((await req.post("/api/v1/auth/login", { data: ACCOUNTS.demo })).ok()).toBeTruthy();
    const profiles = (await (await req.get("/api/v1/profiles")).json()) as ProfileDto[];
    const prof = profiles.find((x) => !x.isKids) ?? profiles[0]!;
    expect((await req.post(`/api/v1/profiles/${prof.id}/select`)).ok()).toBeTruthy();
    const home = (await (await req.get("/api/v1/browse/home")).json()) as HomeResponse;
    let titleId: string | null = null;
    for (const id of new Set(home.rows.flatMap((r) => r.items.map((t) => t.id)))) {
      const d = (await (await req.get(`/api/v1/titles/${id}`)).json()) as TitleDetail;
      if (d.playable && d.type === "MOVIE") {
        titleId = d.id;
        break;
      }
    }
    test.skip(!titleId, "no playable title in the dev catalog");

    const page = await ctx.newPage();
    await page.goto(`/watch/${titleId}`);
    await expect(page.getByTestId("player")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-tg", "android");
    await expect(page.getByTestId("player-back")).toBeHidden();
    const calls = () => page.evaluate(() => (window as unknown as { __tgCalls: string[] }).__tgCalls);
    await expect.poll(calls).toEqual(expect.arrayContaining(["BackButton.show", "disableVerticalSwipes"]));

    await page.mouse.move(640, 400);
    await page.mouse.move(650, 420);
    await page.getByTestId("fullscreen").click();
    await expect.poll(calls).toContain("requestFullscreen");
    await expect(page.getByTestId("fullscreen")).toHaveAccessibleName(/Thoát toàn màn hình/);
    await page.getByTestId("fullscreen").click();
    await expect.poll(calls).toContain("exitFullscreen");
    await page.goto("about:blank");
    await ctx.close();
  });

  test("tampered initData is rejected", async ({ browser }) => {
    const ctx = await browser.newContext();
    const data = new URLSearchParams(signInitData(tgUser));
    data.set("user", JSON.stringify({ ...tgUser, id: 1 }));
    await fakeTelegram(ctx, data.toString());
    const page = await ctx.newPage();
    await page.goto("/tg");
    await expect(page.getByTestId("tg-error")).toContainText("Phiên Telegram không hợp lệ");
    expect((await ctx.cookies()).map((c) => c.name)).not.toContain("at");
    await ctx.close();
  });
});
