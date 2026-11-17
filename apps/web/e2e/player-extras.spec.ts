import { expect, test, type Page } from "@playwright/test";
import type { HomeResponse, PlaybackSession, ProfileDto, TitleDetail } from "@app/shared";
import { authFile } from "./helpers";

/**
 * Player behaviours that need a different browser setup than player.spec.ts:
 * default autoplay policy (no flag) and subtitles (injected into the session response,
 * because no seeded title has subtitle tracks yet).
 */
const SHOTS = "../../tmp/screens/player";
test.use({ storageState: authFile("demo") });
test.describe.configure({ mode: "serial" });

let titleId = "";

async function prepare(page: Page) {
  const profiles = (await (await page.request.get("/api/v1/profiles")).json()) as ProfileDto[];
  await page.request.post(`/api/v1/profiles/${(profiles.find((p) => !p.isKids) ?? profiles[0]).id}/select`);
  if (titleId) return;
  const home = (await (await page.request.get("/api/v1/browse/home")).json()) as HomeResponse;
  for (const id of new Set(home.rows.flatMap((r) => r.items.map((t) => t.id)))) {
    const d = (await (await page.request.get(`/api/v1/titles/${id}`)).json()) as TitleDetail;
    if (d.playable && d.type === "MOVIE") {
      titleId = d.id;
      break;
    }
  }
  expect(titleId).toBeTruthy();
}

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
  await page.waitForTimeout(300);
});

test("autoplay refused → clear 'Bấm để phát' state, click starts playback", async ({ page }) => {
  await prepare(page);
  // Force the browser to refuse unmuted autoplay, whatever the headless default is
  await page.addInitScript(() => {
    const orig = HTMLMediaElement.prototype.play;
    let refused = false;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!refused) {
        refused = true;
        return Promise.reject(new DOMException("play() failed because the user didn't interact", "NotAllowedError"));
      }
      return orig.call(this);
    };
  });
  await page.goto(`/watch/${titleId}`);
  const cta = page.getByTestId("autoplay-blocked");
  await expect(cta).toBeVisible({ timeout: 20_000 });
  await expect(cta.getByText("Bấm để phát")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/autoplay-blocked-1440.png` });
  await cta.getByRole("button").click();
  await expect(cta).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => { const v = document.querySelector("video")!; return !v.paused && v.currentTime > 0.5; }), { timeout: 20_000 })
    .toBe(true);
});

test("subtitles: menu lists tracks, cues render as custom styled text, C toggles", async ({ page }) => {
  await prepare(page);
  const VTT = ["WEBVTT", "", ...Array.from({ length: 30 }, (_, i) => [`00:00:${String(i * 2).padStart(2, "0")}.000 --> 00:00:${String(i * 2 + 2).padStart(2, "0")}.000`, `Phụ đề thử nghiệm số ${i + 1}`, "Dòng thứ hai của câu thoại", ""]).flat()].join("\n");
  await page.route("**/__e2e/subs-vi.vtt", (r) => r.fulfill({ status: 200, contentType: "text/vtt", body: VTT, headers: { "access-control-allow-origin": "*" } }));
  await page.route("**/api/v1/playback/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const res = await route.fetch();
    const body = (await res.json()) as PlaybackSession;
    body.subtitles = [
      { id: "vi", language: "vi", label: "Tiếng Việt", url: "http://localhost:3000/__e2e/subs-vi.vtt", isDefault: false, isForced: false },
      { id: "en", language: "en", label: "English", url: "http://localhost:3000/__e2e/subs-vi.vtt", isDefault: false, isForced: false },
    ];
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(`/watch/${titleId}`);
  await expect.poll(() => page.evaluate(() => document.querySelector("video")!.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  // Ensure it plays even if the headless autoplay policy refused
  const cta = page.getByTestId("autoplay-blocked");
  if (await cta.isVisible()) await cta.getByRole("button").click();

  await page.mouse.move(700, 400);
  await page.getByTestId("menu-trigger-audio").click();
  const menu = page.getByTestId("menu-audio");
  await expect(menu.getByText("Phụ đề")).toBeVisible();
  await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/menu-subtitles-1440.png` });
  await menu.getByText("Tiếng Việt").click();
  await expect(page.getByTestId("subtitles")).toContainText("Phụ đề thử nghiệm");
  await page.mouse.move(10, 10);
  await page.waitForTimeout(3800); // chrome hides → subtitles drop to the lower position
  await page.screenshot({ path: `${SHOTS}/subtitles-1440.png` });
  await page.keyboard.press("c");
  await expect(page.getByTestId("subtitles")).toHaveCount(0);
});
