import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { AdminSeason, AdminTitle, Paginated, SourceFileDto } from "@app/shared";
import fs from "node:fs";
import path from "node:path";

/**
 * Admin "Mùa & tập" panel. Creates a throw-away SERIES title, builds a season + episodes through the UI, edits
 * markers, attaches a source file to an episode, then deletes the title.
 * Run (web :3000 + API up): pnpm exec playwright test e2e/series-admin.spec.ts --project=chromium --output=<private dir>
 * Screenshots → <repo>/tmp/screens/series/.
 */
const SHOTS = path.resolve(__dirname, "../../../tmp/screens/series");
fs.mkdirSync(SHOTS, { recursive: true });
const ADMIN_STATE = path.resolve(__dirname, ".auth/admin-console.json");
const ADMIN = { email: "admin@example.com", password: "Admin@12345" };

test.use({ timezoneId: "Asia/Ho_Chi_Minh", storageState: ADMIN_STATE });
test.describe.configure({ mode: "serial", timeout: 180_000 });

test.beforeAll(async ({ playwright, baseURL }) => {
  fs.mkdirSync(path.dirname(ADMIN_STATE), { recursive: true });
  const fresh = fs.existsSync(ADMIN_STATE) && Date.now() - fs.statSync(ADMIN_STATE).mtimeMs < 10 * 60_000;
  if (fresh) return;
  const ctx = await playwright.request.newContext({ baseURL });
  const res = await ctx.post("/api/v1/auth/login", { data: ADMIN });
  expect(res.ok(), `admin login: ${res.status()}`).toBeTruthy();
  await ctx.storageState({ path: ADMIN_STATE });
  await ctx.dispose();
});

async function apiJson<T>(req: APIRequestContext, method: string, url: string, data?: unknown): Promise<T> {
  const res = await req.fetch(`/api/v1${url}`, { method, data });
  if (!res.ok()) throw new Error(`${method} ${url} → ${res.status()} ${await res.text()}`);
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}

test("admin builds a season with episodes, edits markers and attaches a source", async ({ page }) => {
  const title = await apiJson<AdminTitle>(page.request, "POST", "/admin/titles", { type: "SERIES", name: `E2E Phim bộ ${Date.now()}` });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/admin/titles/${title.id}`);
    const panel = page.getByTestId("seasons-panel");
    await expect(panel.getByText("Chưa có mùa nào")).toBeVisible();
    // Series publish rule is explained and the button is disabled
    await expect(page.getByTestId("publish-blocked")).toContainText("ít nhất 1 tập đã xuất bản");
    await expect(page.getByTestId("title-publish")).toBeDisabled();
    // Titles table shows the counts column for series
    await shot(page, "admin-empty-1440");

    // ── add season 1
    await page.getByTestId("add-season").first().click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByLabel("Số mùa")).toHaveValue("1");
    await dlg.getByLabel("Tên mùa").fill("Mùa đầu tiên");
    await dlg.getByTestId("season-save").click();
    await expect(page.getByTestId("season-tab-1")).toContainText("Mùa đầu tiên");

    // ── bulk add 3 empty episodes
    await page.getByTestId("bulk-episodes").click();
    await dlg.getByLabel("Số lượng").fill("3");
    await expect(dlg.getByText("Sẽ tạo tập 1 → 3.")).toBeVisible();
    await dlg.getByTestId("bulk-save").click();
    await expect(page.getByTestId("episode-row")).toHaveCount(3);

    // ── add one more → its inline editor opens; set name + markers
    await page.getByTestId("add-episode").click();
    await expect(page.getByTestId("episode-row")).toHaveCount(4);
    const editor = page.getByTestId("episode-editor");
    await expect(editor).toBeVisible();
    await editor.getByLabel("Tên tập").fill("Tập kiểm thử");
    await editor.getByLabel("Thời lượng (phút)").fill("42");
    await editor.getByLabel("Intro bắt đầu").fill("0:05");
    await editor.getByLabel("Intro kết thúc").fill("0:02"); // invalid: before the start
    await editor.getByTestId("episode-save").click();
    await expect(editor.getByText("Phải sau mốc bắt đầu intro")).toBeVisible();
    await editor.getByLabel("Intro kết thúc").fill("1:20");
    await editor.getByLabel("Credits bắt đầu").fill("40:00");
    await shot(page, "admin-episode-editor-1440");
    await editor.getByTestId("episode-save").click();
    await expect(editor).toBeHidden();
    const row4 = page.locator('[data-testid="episode-row"][data-episode-number="4"]');
    await expect(row4).toContainText("Tập kiểm thử");
    await expect(row4).toContainText("Intro 0:05–1:20");
    await expect(row4).toContainText("Credits 40:00");

    const seasons = await apiJson<AdminSeason[]>(page.request, "GET", `/admin/titles/${title.id}/seasons`);
    const ep4 = seasons[0].episodes.find((e) => e.episodeNumber === 4)!;
    expect(ep4).toMatchObject({ name: "Tập kiểm thử", runtimeMinutes: 42, introStartSec: 5, introEndSec: 80, creditsStartSec: 2400 });

    // ── attach a source to episode 1 (reuses the source-file picker)
    const files = await apiJson<Paginated<SourceFileDto>>(page.request, "GET", "/admin/source-files?status=OK&pageSize=50");
    const file = [...files.items].filter((f) => f.probeStatus === "OK").sort((a, b) => (a.durationSec ?? 1e9) - (b.durationSec ?? 1e9))[0];
    const row1 = page.locator('[data-testid="episode-row"][data-episode-number="1"]');
    if (file) {
      await row1.getByTestId("episode-attach").click();
      await expect(dlg).toBeVisible();
      await dlg.getByLabel("Chỉ file chưa gắn").uncheck();
      await dlg.getByRole("option").filter({ hasText: file.key.split("/").pop()! }).first().click();
      await dlg.getByRole("button", { name: "Gắn & transcode" }).click();
      await expect(page.getByText("Đã gắn video cho tập 1")).toBeVisible();
      // live status: the asset badge appears and polls (queued → transcoding → ready)
      await expect(row1.getByTestId("episode-media")).toContainText(/Trong hàng đợi|Đang transcode|Sẵn sàng|Chờ/);
      await expect(row1.getByTestId("episode-attach")).toContainText("Đổi video");
      // Not ready yet → publish disabled with a reason
      if (!(await row1.getByText("Sẵn sàng").isVisible())) await expect(row1.getByTestId("episode-publish")).toBeDisabled();
    } else {
      console.log("no probed source file — attach step skipped");
    }
    await shot(page, "admin-panel-1440");
    await shot(page, "admin-panel-full-1440", true);

    for (const [w, h] of [[768, 1024], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.getByTestId("seasons-panel").scrollIntoViewIfNeeded();
      await shot(page, `admin-panel-${w}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await row4.getByTestId("episode-edit").click();
    await page.getByTestId("episode-editor").scrollIntoViewIfNeeded();
    await shot(page, "admin-episode-editor-390");

    // ── titles table shows season / episode counts
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/admin/titles`);
    await page.getByLabel("Tìm phim").fill(title.name);
    await expect(page.getByTestId("series-counts").first()).toContainText("1 mùa · 4 tập");
    await shot(page, "admin-titles-table-1440");
  } finally {
    await apiJson(page.request, "DELETE", `/admin/titles/${title.id}`).catch((e) => console.log("cleanup:", String(e)));
  }
});
