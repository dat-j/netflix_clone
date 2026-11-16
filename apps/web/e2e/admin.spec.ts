import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { authFile } from "./helpers";

/**
 * E2E trang quản trị. Chạy (từ apps/web, khi web :3000 + API đang chạy):
 *   npx playwright test e2e/admin.spec.ts --project=chromium
 * Đăng nhập admin MỘT lần qua API (auth bị giới hạn 20 lần/phút/IP) và tái dùng storage state;
 * tài khoản demo dùng storage state do e2e/auth.setup.ts (project "setup") tạo sẵn.
 * Ảnh chụp lưu vào <repo>/tmp/screens/admin/.
 */
const SHOTS = path.resolve(__dirname, "../../../tmp/screens/admin");
fs.mkdirSync(SHOTS, { recursive: true });
const ADMIN_STATE = path.resolve(__dirname, ".auth/admin-console.json");
const ADMIN = { email: "admin@example.com", password: "Admin@12345" };

test.use({ timezoneId: "Asia/Ho_Chi_Minh", storageState: ADMIN_STATE });
test.describe.configure({ timeout: 120_000 });

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

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1440", width: 1440, height: 900 },
] as const;

async function apiJson<T>(req: APIRequestContext, method: string, url: string, data?: unknown): Promise<T> {
  const res = await req.fetch(`/api/v1${url}`, { method, data });
  if (!res.ok()) throw new Error(`${method} ${url} → ${res.status()} ${await res.text()}`);
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

const SECTIONS = [
  { path: "/admin", heading: "Tổng quan", key: "overview" },
  { path: "/admin/titles", heading: "Phim", key: "titles" },
  { path: "/admin/titles/new", heading: "Thêm phim", key: "title-new" },
  { path: "/admin/source-files", heading: "Kho file nguồn", key: "source-files" },
  { path: "/admin/jobs", heading: "Tác vụ transcode", key: "jobs" },
  { path: "/admin/home", heading: "Trang chủ", key: "home" },
  { path: "/admin/users", heading: "Người dùng", key: "users" },
  { path: "/admin/plans", heading: "Gói cước", key: "plans" },
];

test.describe("as a non-admin", () => {
  test.use({ storageState: authFile("demo") });
  test("non-admin sees a clean 403 screen", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByText("403 · Không có quyền")).toBeVisible();
    await shot(page, "forbidden-1440");
  });
});

test("admin opens every section (screenshots 390/768/1440)", async ({ page }) => {
  test.setTimeout(300_000);
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const s of SECTIONS) {
      await page.goto(s.path);
      await expect(page.getByRole("heading", { level: 1, name: s.heading, exact: true })).toBeVisible();
      // không còn skeleton/lỗi tải
      await expect(page.getByText("Không tải được dữ liệu")).toHaveCount(0, { timeout: 10_000 });
      // các trang có polling nên không chờ networkidle; chờ skeleton biến mất
      await expect(page.locator(".animate-pulse")).toHaveCount(0, { timeout: 10_000 }).catch(() => {});
      await shot(page, `${s.key}-${vp.name}`);
    }
  }
});

test("home manager tabs + dialogs render", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/home");
  await page.getByRole("button", { name: "Thêm hàng" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "home-row-dialog-1440");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Bộ sưu tập" }).click();
  await page.getByRole("button", { name: "Tạo bộ sưu tập" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "collection-dialog-1440");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Billboard" }).click();
  await shot(page, "billboards-1440");
  await page.goto("/admin/plans");
  await page.getByRole("button", { name: "Sửa" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "plan-dialog-1440");
});

test("edit a title and the change persists", async ({ page }) => {
  // Dùng phim có sẵn (seed) nếu có, nếu không thì tạo phim tạm.
  const list = await apiJson<{ items: { id: string; name: string }[] }>(page.request, "GET", "/admin/titles?pageSize=1");
  let id = list.items[0]?.id;
  let temp = false;
  if (!id) {
    id = (await apiJson<{ id: string }>(page.request, "POST", "/admin/titles", { type: "MOVIE", name: "E2E phim tạm" })).id;
    temp = true;
  }
  const before = await apiJson<{ tagline: string | null }>(page.request, "GET", `/admin/titles/${id}`);
  const tagline = `E2E tagline ${Date.now()}`;

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`/admin/titles/${id}`);
    await expect(page.getByLabel("Tên phim *")).toBeVisible();
    await shot(page, `title-editor-${vp.name}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel("Khẩu hiệu (tagline)").fill(tagline);
  await expect(page.getByText("Có thay đổi chưa lưu")).toBeVisible();
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(page.getByText("Đã lưu thay đổi")).toBeVisible();
  await shot(page, "title-editor-saved-1440");
  await page.reload();
  await expect(page.getByLabel("Khẩu hiệu (tagline)")).toHaveValue(tagline);
  const after = await apiJson<{ tagline: string | null; overriddenFields: string[]; tmdbId: number | null }>(page.request, "GET", `/admin/titles/${id}`);
  expect(after.tagline).toBe(tagline);
  if (after.tmdbId) expect(after.overriddenFields).toContain("tagline");

  // Source-file picker dialog
  await page.getByTestId("asset-MAIN").getByRole("button", { name: /file nguồn/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "source-picker-1440");
  await page.keyboard.press("Escape");

  // khôi phục
  if (temp) await apiJson(page.request, "DELETE", `/admin/titles/${id}`);
  else await apiJson(page.request, "PATCH", `/admin/titles/${id}`, { tagline: before.tagline });
});

test("grant then revoke a subscription", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/users");
  await page.getByLabel("Tìm người dùng").fill("free@example.com");
  const row = page.getByRole("row").filter({ hasText: "free@example.com" });
  await expect(row).toHaveCount(1);
  // seed: free user không có thuê bao ACTIVE (có thể còn bản ghi CANCELED từ lần chạy trước)
  await expect(row.getByText("Đang hoạt động")).toHaveCount(0);
  await row.getByRole("button", { name: "Cấp gói" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Gói cước").selectOption({ index: 0 });
  await dlg.getByLabel("Số tháng").fill("2");
  await dlg.getByRole("textbox").last().fill("E2E: cấp thử");
  await shot(page, "grant-dialog-1440");
  await dlg.getByRole("button", { name: "Cấp gói" }).click();
  await expect(page.getByText("Đã cấp thuê bao")).toBeVisible();
  await expect(row.getByText("Đang hoạt động")).toBeVisible();
  await page.reload();
  await page.getByLabel("Tìm người dùng").fill("free@example.com");
  await expect(page.getByRole("row").filter({ hasText: "free@example.com" }).getByText("Đang hoạt động")).toBeVisible();
  await shot(page, "users-granted-1440");

  // Thu hồi để trả lại trạng thái seed (free user không có gói)
  const r2 = page.getByRole("row").filter({ hasText: "free@example.com" });
  await r2.getByRole("button", { name: /Thao tác khác/ }).click();
  await page.getByRole("menuitem", { name: "Thu hồi thuê bao" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Thu hồi gói" }).click();
  await expect(page.getByText("Đã thu hồi thuê bao")).toBeVisible();
  await expect(r2.getByText("Đã huỷ")).toBeVisible();
  await expect(r2.getByRole("button", { name: "Cấp gói" })).toBeVisible();
});

test("attach a source file and watch the transcode job progress", async ({ page }) => {
  test.setTimeout(240_000);
  const files = await apiJson<{ items: { id: string; key: string; probeStatus: string }[] }>(page.request, "GET", "/admin/source-files?status=OK&pageSize=50");
  const file = files.items.find((f) => f.probeStatus === "OK");
  test.skip(!file, "Chưa có file nguồn probe OK trong bucket (worker/scan chưa sẵn sàng)");

  const title = await apiJson<{ id: string }>(page.request, "POST", "/admin/titles", { type: "MOVIE", name: `E2E transcode ${Date.now()}` });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/admin/titles/${title.id}`);
    await page.getByTestId("asset-PREVIEW").getByRole("button", { name: /file nguồn/ }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Chỉ file chưa gắn").uncheck();
    await dlg.getByRole("option").filter({ hasText: file!.key.split("/").pop()! }).first().click();
    await dlg.getByRole("button", { name: "Gắn & transcode" }).click();
    await expect(page.getByText("Đã gắn file và đưa vào hàng đợi transcode")).toBeVisible();

    await page.goto("/admin/jobs");
    const jobRow = page.getByTestId("job-row").filter({ hasText: "E2E transcode" }).first();
    await expect(jobRow).toBeVisible();
    // Theo dõi tiến độ tăng hoặc job hoàn tất
    const seen = new Set<number>();
    const deadline = Date.now() + 180_000;
    let done = false;
    let shotRunning = false;
    while (Date.now() < deadline) {
      const text = await jobRow.innerText();
      const bar = jobRow.getByRole("progressbar");
      if (await bar.count()) seen.add(Number(await bar.getAttribute("aria-valuenow")));
      if (!shotRunning && /Đang chạy/.test(text)) {
        await shot(page, "jobs-running-1440");
        shotRunning = true;
      }
      if (/Hoàn tất|Lỗi/.test(text)) {
        done = true;
        break;
      }
      await page.waitForTimeout(1500);
    }
    await shot(page, "jobs-after-1440");
    console.log("progress values seen:", [...seen].sort((a, b) => a - b).join(","), "done:", done);
    expect(seen.size > 1 || done).toBeTruthy();
    await expect(jobRow.getByText("Hoàn tất")).toBeVisible({ timeout: 5_000 });
    await page.goto(`/admin/titles/${title.id}`);
    await expect(page.getByTestId("asset-PREVIEW").getByText("Sẵn sàng")).toBeVisible();
    await shot(page, "title-media-ready-1440");
  } finally {
    await apiJson(page.request, "DELETE", `/admin/titles/${title.id}`).catch(() => {});
  }
});
