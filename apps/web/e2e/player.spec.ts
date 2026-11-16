import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import type { HomeResponse, PlaybackSession, ProfileDto, TitleDetail } from "@app/shared";
import { authFile } from "./helpers";

/**
 * Player E2E against the live dev stack (web :3000 → API, transcoded sample titles).
 * Run: pnpm --filter @app/web exec playwright test e2e/player.spec.ts --project=chromium
 * Screenshots land in <repo>/tmp/screens/player/.
 */

const SHOTS = "../../tmp/screens/player";

test.use({
  storageState: authFile("demo"),
  launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
});
test.describe.configure({ mode: "serial" });

async function selectProfile(request: APIRequestContext) {
  const profiles = (await (await request.get("/api/v1/profiles")).json()) as ProfileDto[];
  const p = profiles.find((x) => !x.isKids) ?? profiles[0];
  expect((await request.post(`/api/v1/profiles/${p.id}/select`)).ok()).toBeTruthy();
}

async function findTitles(request: APIRequestContext) {
  const home = (await (await request.get("/api/v1/browse/home")).json()) as HomeResponse;
  const ids = [...new Set(home.rows.flatMap((r) => r.items.map((t) => t.id)))];
  let playable: TitleDetail | null = null;
  let notPlayable: TitleDetail | null = null;
  for (const id of ids) {
    const d = (await (await request.get(`/api/v1/titles/${id}`)).json()) as TitleDetail;
    if (d.playable && d.type === "MOVIE" && (!playable || (d.maxAvailableHeight ?? 0) > (playable.maxAvailableHeight ?? 0))) playable = d;
    if (!d.playable && !notPlayable) notPlayable = d;
    if (playable?.maxAvailableHeight === 1080 && notPlayable) break;
  }
  return { playable, notPlayable };
}

const videoState = (page: Page) =>
  page
    .evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>("[data-testid=player-video]");
      return v ? { t: v.currentTime, w: v.videoWidth, paused: v.paused, duration: v.duration } : { t: 0, w: 0, paused: true, duration: 0 };
    })
    // A navigation in flight (dev HMR reload, redirect) — report "not ready" and let expect.poll retry
    .catch(() => ({ t: 0, w: 0, paused: true, duration: 0 }));

async function waitPlaying(page: Page, minTime = 0) {
  await expect
    .poll(async () => {
      const s = await videoState(page);
      return s.w > 0 && !s.paused && s.t > minTime;
    }, { timeout: 30_000 })
    .toBe(true);
}

/** Leave via navigation so pagehide fires the final heartbeat + DELETE (frees the stream slot). */
async function leave(page: Page) {
  await page.goto("about:blank").catch(() => undefined);
}

async function showChrome(page: Page) {
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2 + Math.random() * 20, vp.height / 2);
  await expect(page.getByTestId("player-controls")).toHaveAttribute("data-visible", "true");
}

let titleId = "";
let notPlayableId = "";

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: authFile("demo"), baseURL: "http://localhost:3000" });
  await selectProfile(ctx.request);
  const { playable, notPlayable } = await findTitles(ctx.request);
  expect(playable, "no playable title seeded yet").toBeTruthy();
  titleId = playable!.id;
  notPlayableId = notPlayable?.id ?? "";
  await ctx.close();
});

test.beforeEach(async ({ page }) => {
  await selectProfile(page.request);
});

test.afterEach(async ({ page }) => {
  await leave(page);
  await page.waitForTimeout(300);
});

test("demo user plays a title: video advances, keyboard + scrubber seek, quality levels, preview", async ({ page }) => {
  await page.goto(`/watch/${titleId}`);
  await waitPlaying(page);
  const s0 = await videoState(page);
  await page.waitForTimeout(1500);
  const s1 = await videoState(page);
  expect(s1.t).toBeGreaterThan(s0.t);
  expect(s1.w).toBeGreaterThan(0);

  // Keyboard: → seeks +10 s, ← back; 0 jumps to the start
  await page.keyboard.press("0");
  await expect.poll(async () => (await videoState(page)).t).toBeLessThan(3);
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await videoState(page)).t).toBeGreaterThan(9);
  const afterFwd = (await videoState(page)).t;
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await videoState(page)).t).toBeLessThan(afterFwd - 5);

  // Space pauses / resumes
  await page.keyboard.press(" ");
  await expect.poll(async () => (await videoState(page)).paused).toBe(true);
  await page.keyboard.press(" ");
  await expect.poll(async () => (await videoState(page)).paused).toBe(false);

  // Scrubber click at 75 %
  await showChrome(page);
  const bar = (await page.getByTestId("scrubber").boundingBox())!;
  await page.mouse.click(bar.x + bar.width * 0.75, bar.y + bar.height / 2);
  const { duration } = await videoState(page);
  await expect.poll(async () => (await videoState(page)).t).toBeGreaterThan(duration * 0.7);

  // Hover preview bubble with the sprite frame
  await page.mouse.move(bar.x + bar.width * 0.4, bar.y + bar.height / 2);
  await expect(page.getByTestId("scrub-preview")).toBeVisible();
  await expect(page.getByTestId("scrub-preview").locator("img")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/scrub-preview-1440.png` });

  // Quality menu lists the manifest levels
  await page.getByTestId("menu-trigger-quality").click();
  const menu = page.getByTestId("menu-quality");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("quality-auto")).toBeVisible();
  const items = await menu.getByRole("menuitemradio").allInnerTexts();
  expect(items.length).toBeGreaterThanOrEqual(3);
  expect(items.join(" ")).toMatch(/360p/);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/menu-quality-1440.png` });
  await page.keyboard.press("Escape");
  await page.keyboard.press("1"); // short sample clip: move away from the end before switching
  await showChrome(page);
  await page.getByTestId("menu-trigger-quality").click();
  await menu.getByTestId("quality-360").click();
  await expect
    .poll(() => page.evaluate(() => (document.querySelector("video") as HTMLVideoElement & { __engine?: { hlsInstance?: { autoLevelEnabled: boolean } } }).__engine?.hlsInstance?.autoLevelEnabled))
    .toBe(false);
  await expect.poll(async () => (await videoState(page)).w, { timeout: 20_000 }).toBe(640);
  // back to Auto (and persisted preference cleared)
  await page.keyboard.press("1");
  await showChrome(page);
  await page.getByTestId("menu-trigger-quality").click();
  await page.getByTestId("quality-auto").click();

  // Speed menu
  await showChrome(page);
  await page.getByTestId("menu-trigger-speed").click();
  await expect(page.getByTestId("menu-speed")).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/menu-speed-1440.png` });
  await page.getByTestId("rate-1.25").click();
  await expect.poll(() => page.evaluate(() => document.querySelector("video")!.playbackRate)).toBe(1.25);
  await page.getByTestId("rate-1").click();
  await page.keyboard.press("Escape"); // closes the menu, does not leave
  await expect(page.getByTestId("menu-speed")).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/watch/${titleId}`));
});

test("reload resumes near the last position", async ({ page }) => {
  await page.goto(`/watch/${titleId}`);
  await waitPlaying(page);
  await page.keyboard.press("0");
  await page.waitForTimeout(300);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await videoState(page)).t).toBeGreaterThan(19);
  await page.keyboard.press("k"); // pause → heartbeat with position
  await expect.poll(async () => (await videoState(page)).paused).toBe(true);
  const pos = (await videoState(page)).t;
  await page.waitForTimeout(2500);
  await page.reload();
  await expect
    .poll(async () => {
      const s = await videoState(page);
      return s.w > 0 && s.t > 0 ? s.t : -1;
    }, { timeout: 30_000 })
    .toBeGreaterThan(pos - 4);
  expect((await videoState(page)).t).toBeLessThan(pos + 8);
});

test("screens: controls, menus, paused overlay at 1440 / 768", async ({ page }) => {
  for (const [w, h] of [[1440, 900], [768, 1024]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/watch/${titleId}`);
    await waitPlaying(page);
    await page.keyboard.press("2");
    await page.waitForTimeout(700);
    await showChrome(page);
    await page.screenshot({ path: `${SHOTS}/controls-${w}.png` });

    const bar = (await page.getByTestId("scrubber").boundingBox())!;
    await page.mouse.move(bar.x + bar.width * 0.55, bar.y + bar.height / 2);
    await expect(page.getByTestId("scrub-preview")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/scrub-preview-${w}.png` });

    await page.getByTestId("menu-trigger-quality").click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/menu-quality-${w}.png` });
    await page.keyboard.press("Escape");
    await page.getByTestId("menu-trigger-speed").click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/menu-speed-${w}.png` });
    await page.keyboard.press("Escape");

    // Volume slider expands on hover
    await page.getByTestId("mute-button").hover();
    await expect(page.getByTestId("volume-slider")).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/volume-${w}.png` });

    // Pause, then leave the mouse still → chrome hides → "Bạn đang xem" overlay
    await page.keyboard.press(" ");
    await page.mouse.move(w / 2, h / 3);
    await expect(page.getByTestId("paused-overlay")).toBeVisible({ timeout: 12_000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/paused-overlay-${w}.png` });
    await leave(page);
  }
});

test("end screen with replay", async ({ page }) => {
  await page.goto(`/watch/${titleId}`);
  await waitPlaying(page);
  await page.keyboard.press("9");
  await expect(page.getByTestId("end-screen")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/end-screen-1440.png` });
  await page.getByTestId("replay").click();
  await expect(page.getByTestId("end-screen")).toBeHidden();
  await waitPlaying(page);
  expect((await videoState(page)).t).toBeLessThan(10);
});

test("third concurrent stream gets the too-many-streams screen", async ({ page, context }) => {
  // standard plan = 2 streams: two players in the same account, then a third
  const extra: Page[] = [];
  for (let i = 0; i < 2; i++) {
    const p = await context.newPage();
    await p.goto(`/watch/${titleId}`);
    await waitPlaying(p);
    extra.push(p);
  }
  await page.goto(`/watch/${titleId}`);
  await expect(page.getByTestId("player-screen-TOO_MANY_STREAMS")).toBeVisible();
  await expect(page.getByText("Đang có quá nhiều thiết bị cùng xem")).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/too-many-streams-1440.png` });

  // Stop one stream → retry succeeds
  await leave(extra[0]);
  await page.waitForTimeout(800);
  await page.getByTestId("screen-retry").click();
  await waitPlaying(page);
  for (const p of extra) await leave(p);
});

test("session ended mid-playback stops and explains, then resumes here", async ({ page }) => {
  const sessionPromise = page.waitForResponse((r) => r.url().endsWith("/api/v1/playback/sessions") && r.request().method() === "POST");
  await page.goto(`/watch/${titleId}`);
  const session = (await (await sessionPromise).json()) as PlaybackSession;
  await waitPlaying(page);
  // Simulate the slot being taken away
  expect((await page.request.delete(`/api/v1/playback/sessions/${session.sessionId}`)).status()).toBe(204);
  await expect(page.getByTestId("player-screen-SESSION_ENDED")).toBeVisible({ timeout: 25_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/session-ended-1440.png` });
  await page.getByTestId("screen-retry").click();
  await waitPlaying(page);
});

test("not-playable title shows a clear screen", async ({ page }) => {
  test.skip(!notPlayableId, "every seeded title is playable");
  await page.goto(`/watch/${notPlayableId}`);
  await expect(page.getByTestId("player-screen-NOT_PLAYABLE")).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/not-playable-1440.png` });
});

test.describe("free user", () => {
  test.use({ storageState: authFile("free") });
  test("gets the upsell to /plans", async ({ page }) => {
    await page.goto(`/watch/${titleId}`);
    await expect(page.getByTestId("player-screen-NO_SUBSCRIPTION")).toBeVisible();
    await expect(page.getByTestId("upsell-plans")).toHaveAttribute("href", "/plans");
    for (const [w, h] of [[1440, 900], [768, 1024], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.screenshot({ path: `${SHOTS}/upsell-${w}.png` });
    }
  });
});

test.describe("phone (touch)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("touch layout: tap shows controls, double-tap seeks", async ({ page }) => {
    await page.goto(`/watch/${titleId}`);
    await waitPlaying(page);
    await page.keyboard.press("3");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/portrait-390.png` });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(400);
    const stage = page.getByTestId("player-stage");
    await stage.tap({ position: { x: 422, y: 120 } });
    await expect(page.getByTestId("player-controls")).toHaveAttribute("data-visible", "true");
    await page.screenshot({ path: `${SHOTS}/touch-controls-844x390.png` });
    const before = (await videoState(page)).t;
    await stage.tap({ position: { x: 760, y: 200 } });
    await stage.tap({ position: { x: 760, y: 200 } });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/touch-seek-ripple-844x390.png` });
    await expect.poll(async () => (await videoState(page)).t).toBeGreaterThan(before + 7);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    if ((await page.getByTestId("player-controls").getAttribute("data-visible")) !== "true") await stage.tap({ position: { x: 195, y: 300 } });
    await expect(page.getByTestId("player-controls")).toHaveAttribute("data-visible", "true");
    await page.screenshot({ path: `${SHOTS}/controls-390.png` });
    await page.getByTestId("menu-trigger-speed").click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/menu-speed-390.png` });
  });
});

export type { BrowserContext };
