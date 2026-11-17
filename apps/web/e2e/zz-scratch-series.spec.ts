import { expect, test } from "@playwright/test";
import type { HomeResponse, PlaybackSession, ProfileDto, SeasonDto, TitleDetail } from "@app/shared";
import { authFile } from "./helpers";

// TEMPORARY scratch spec (mocked series data on top of a real movie stream) — delete before handing off.
const SHOTS = "../../tmp/screens/series-scratch";
test.use({ storageState: authFile("demo"), launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });
test.describe.configure({ mode: "serial" });

let movie: TitleDetail;
const ep = (s: number, e: number, playable = true) => ({
  id: `ep-${s}-${e}`,
  episodeNumber: e,
  seasonNumber: s,
  name: e === 3 ? null : `Tên tập số ${e} của mùa ${s}`,
  overview: "Một đêm mưa, thám tử nhận được cuộc gọi lạ dẫn anh vào con hẻm cũ — nơi mọi manh mối đều chỉ về quá khứ của chính mình.",
  runtimeMinutes: 42 + e,
  still: null,
  progress: s === 1 && e === 2 ? { positionSec: 900, durationSec: 2600, ratio: 0.35, completed: false, episodeId: `ep-1-2`, updatedAt: "" } : s === 1 && e === 1 ? { positionSec: 2600, durationSec: 2600, ratio: 1, completed: true, episodeId: "ep-1-1", updatedAt: "" } : null,
  playable,
  airDate: playable ? null : "2026-12-24",
});
const season = (n: number, count: number, withEps: boolean): SeasonDto => ({
  id: `season-${n}`,
  seasonNumber: n,
  name: null,
  overview: n === 2 ? "Mùa 2: vụ án mới ở phố cổ." : null,
  episodeCount: count,
  episodes: withEps ? Array.from({ length: count }, (_, i) => ep(n, i + 1, !(n === 2 && i >= 3))) : [],
});

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: authFile("demo"), baseURL: "http://localhost:3000" });
  const profiles = (await (await ctx.request.get("/api/v1/profiles")).json()) as ProfileDto[];
  await ctx.request.post(`/api/v1/profiles/${(profiles.find((p) => !p.isKids) ?? profiles[0]).id}/select`);
  const home = (await (await ctx.request.get("/api/v1/browse/home")).json()) as HomeResponse;
  for (const id of new Set(home.rows.flatMap((r) => r.items.map((t) => t.id)))) {
    const d = (await (await ctx.request.get(`/api/v1/titles/${id}`)).json()) as TitleDetail;
    if (d.playable && d.type === "MOVIE") {
      movie = d;
      break;
    }
  }
  await ctx.close();
});

async function mock(page: import("@playwright/test").Page) {
  await page.route(new RegExp(`/api/v1/titles/(${movie.id}|${movie.slug})$`), async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as TitleDetail;
    Object.assign(body, {
      type: "SERIES",
      seasons: [season(1, 6, true), season(2, 5, false)],
      seasonCount: 2,
      episodeCount: 11,
      resumeEpisode: { id: "ep-1-2", seasonNumber: 1, episodeNumber: 2, name: "Tên tập số 2 của mùa 1", still: null, runtimeMinutes: 44 },
      progress: { positionSec: 900, durationSec: 2600, ratio: 0.35, completed: false, episodeId: "ep-1-2", updatedAt: "" },
    });
    await route.fulfill({ response: res, json: body });
  });
  await page.route(`**/api/v1/titles/${movie.id}/episodes?season=*`, async (route) => {
    const n = Number(new URL(route.request().url()).searchParams.get("season"));
    await new Promise((r) => setTimeout(r, 400));
    await route.fulfill({ json: season(n, n === 1 ? 6 : 5, true) });
  });
  let count = 0;
  await page.route("**/api/v1/playback/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const req = route.request().postDataJSON() as { episodeId?: string };
    const res = await route.fetch({ postData: JSON.stringify({ titleId: movie.id }) });
    const body = (await res.json()) as PlaybackSession;
    const id = req.episodeId ?? "ep-1-2";
    const [, s, e] = id.split("-").map(Number);
    count++;
    body.title.type = "SERIES";
    body.episode = { id, seasonNumber: s, episodeNumber: e, name: `Tên tập số ${e} của mùa ${s}` };
    body.markers = { introStartSec: 2, introEndSec: 12, creditsStartSec: null };
    body.nextEpisode = { id: `ep-${s}-${e + 1}`, seasonNumber: s, episodeNumber: e + 1, name: `Tên tập số ${e + 1} của mùa ${s}`, still: movie.backdrop, runtimeMinutes: 45 };
    body.resumePositionSec = 0;
    await route.fulfill({ response: res, json: body });
  });
  return () => count;
}

test.describe("touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("phone player overlays", async ({ page }) => {
    const profiles = (await (await page.request.get("/api/v1/profiles")).json()) as ProfileDto[];
    await page.request.post(`/api/v1/profiles/${(profiles.find((p) => !p.isKids) ?? profiles[0]).id}/select`);
    await mock(page);
    await page.goto(`/watch/${movie.id}?episode=ep-1-2`);
    await expect(page.getByTestId("skip-intro")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/phone-skip-intro-390.png` });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.getByTestId("player-stage").tap({ position: { x: 422, y: 120 } });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/phone-controls-844.png` });
    await page.getByTestId("menu-trigger-episodes").tap();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/phone-episodes-844.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/phone-episodes-390.png` });
    await page.mouse.click(5, 5);
    const dur = await page.evaluate(() => document.querySelector("video")!.duration);
    await page.evaluate((d) => { document.querySelector("video")!.currentTime = d - 15; }, dur);
    await expect(page.getByTestId("next-episode-card")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/phone-next-up-390.png` });
    await page.getByTestId("next-episode-cancel").tap();
    await page.waitForTimeout(16_000);
    await page.screenshot({ path: `${SHOTS}/phone-ended-390.png` });
  });
});

test("detail modal + player overlays (mocked series)", async ({ page }) => {
  test.setTimeout(180_000);
  const profiles = (await (await page.request.get("/api/v1/profiles")).json()) as ProfileDto[];
  await page.request.post(`/api/v1/profiles/${(profiles.find((p) => !p.isKids) ?? profiles[0]).id}/select`);
  await mock(page);
  for (const [w, h] of [[1440, 900], [768, 1024], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/title/${movie.slug}`);
    await expect(page.getByTestId("episode-list")).toBeVisible();
    await page.getByTestId("episodes").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/detail-episodes-${w}.png` });
    await page.getByTestId("season-select").click();
    await page.screenshot({ path: `${SHOTS}/detail-season-menu-${w}.png` });
    await page.getByTestId("season-option-2").click();
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${SHOTS}/detail-season2-loading-${w}.png` });
    await expect(page.locator('[data-testid="episode-row"]')).toHaveCount(5);
    await page.screenshot({ path: `${SHOTS}/detail-season2-${w}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/title/${movie.slug}`);
  await page.screenshot({ path: `${SHOTS}/detail-top-1440.png` });

  await page.goto(`/watch/${movie.id}?episode=ep-1-2`);
  await expect(page.getByTestId("skip-intro")).toBeVisible({ timeout: 30_000 });
  await page.mouse.move(700, 400);
  await page.screenshot({ path: `${SHOTS}/player-skip-intro-1440.png` });
  await page.keyboard.press("s");
  await expect(page.getByTestId("skip-intro")).toBeHidden();
  await expect(page.getByTestId("player-episode")).toHaveText("T1:E2 · Tên tập số 2 của mùa 1");
  // episodes panel
  await page.mouse.move(700, 410);
  await page.getByTestId("menu-trigger-episodes").click();
  await expect(page.getByTestId("episodes-panel")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/player-episodes-1440.png` });
  await page.keyboard.press("Escape");
  // jump near the end → next-up card
  const dur = await page.evaluate(() => document.querySelector("video")!.duration);
  await page.evaluate((d) => { document.querySelector("video")!.currentTime = d - 15; }, dur);
  await expect(page.getByTestId("next-episode-card")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${SHOTS}/player-next-up-1440.png` });
  await page.mouse.move(10, 10);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${SHOTS}/player-next-up-hidden-chrome-1440.png` });
  await expect(page).toHaveURL(/episode=ep-1-3/, { timeout: 20_000 });
  await expect(page.getByTestId("player-episode")).toHaveText(/^T1:E3/);
  await page.screenshot({ path: `${SHOTS}/player-after-advance-1440.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/player-390.png` });
});
