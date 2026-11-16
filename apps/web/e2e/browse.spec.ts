import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS, authFile, hydrated } from "./helpers";

/** Select the first adult profile through the API (keeps the auth rate limit untouched). */
async function selectProfile(page: Page) {
  const res = await page.request.get("/api/v1/profiles");
  expect(res.ok()).toBeTruthy();
  const profiles = (await res.json()) as { id: string; isKids: boolean }[];
  const p = profiles.find((x) => !x.isKids) ?? profiles[0];
  expect((await page.request.post(`/api/v1/profiles/${p.id}/select`)).ok()).toBeTruthy();
}

test.describe("thành viên có gói (demo)", () => {
  test.use({ storageState: authFile("demo") });

  test("chọn hồ sơ → trang chủ có billboard và các hàng phim", async ({ page }) => {
    await page.goto("/profiles");
    await expect(page.getByRole("heading", { name: "Ai đang xem?" })).toBeVisible();
    await page.getByRole("button", { name: "Chọn hồ sơ Demo" }).click();
    await page.waitForURL("**/browse");
    await expect(page.getByTestId("billboard")).toBeVisible();
    await expect(page.getByTestId("billboard").getByRole("link", { name: /Phát|Tiếp tục/ })).toBeVisible();
    await expect(page.getByTestId("browse-row").first()).toBeVisible();
    expect(await page.getByTestId("browse-row").count()).toBeGreaterThan(2);
    await expect(page.getByTestId("title-card").first()).toBeVisible();
  });

  test("rê chuột lên thẻ phim → hiện mini-card", async ({ page }) => {
    await selectProfile(page);
    await page.goto("/browse");
    const card = page.getByTestId("browse-row").nth(1).getByTestId("title-card").nth(1);
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    const mini = page.getByTestId("hover-card");
    await expect(mini).toBeVisible();
    await expect(mini.getByRole("link", { name: /^Phát / })).toBeVisible();
    await expect(mini.getByRole("button", { name: /Danh sách của tôi/ })).toBeVisible();
    await expect(mini.getByText(/phù hợp/)).toBeVisible();
    // leaving the mini-card closes it
    await page.mouse.move(5, 5);
    await expect(mini).toBeHidden();
  });

  test("mở modal chi tiết qua URL riêng và đóng bằng Esc", async ({ page }) => {
    await selectProfile(page);
    await page.goto("/browse");
    await page.getByTestId("browse-row").first().getByTestId("title-card").first().click();
    await expect(page).toHaveURL(/\/title\//);
    const modal = page.getByTestId("detail-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId("title-detail")).toBeVisible();
    await expect(page.getByTestId("billboard")).toBeAttached(); // browse stays underneath
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
    await expect(page).toHaveURL(/\/browse$/);
  });

  test("tải trực tiếp /title/[slug] hiển thị trang đầy đủ (không phải modal)", async ({ page }) => {
    await selectProfile(page);
    const home = await (await page.request.get("/api/v1/browse/home")).json();
    const slug = home.rows[0].items[0].slug as string;
    await page.goto(`/title/${slug}`);
    await expect(page.getByTestId("title-detail")).toBeVisible();
    await expect(page.getByTestId("detail-modal")).toHaveCount(0);
  });

  test("thêm vào Danh sách của tôi rồi thấy trên /my-list", async ({ page }) => {
    await selectProfile(page);
    // start from a title that is not in the list yet
    const home = await (await page.request.get("/api/v1/browse/home")).json();
    const all = home.rows.flatMap((r: { items: { id: string; slug: string; name: string; inMyList: boolean }[] }) => r.items);
    const target = all.find((t: { inMyList: boolean }) => !t.inMyList) ?? all[0];
    await page.request.delete(`/api/v1/my-list/${target.id}`);

    await page.goto(`/browse`);
    await page.goto(`/title/${target.slug}`);
    const detail = page.getByTestId("title-detail");
    await detail.getByRole("button", { name: "Thêm vào Danh sách của tôi" }).first().click();
    await expect(detail.getByRole("button", { name: "Xóa khỏi Danh sách của tôi" }).first()).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Đã thêm" })).toBeVisible();

    await page.goto("/my-list");
    await expect(page.getByRole("heading", { name: "Danh sách của tôi" })).toBeVisible();
    await expect(page.getByRole("link", { name: target.name, exact: true })).toBeVisible();

    await page.request.delete(`/api/v1/my-list/${target.id}`); // cleanup
  });

  test("tìm kiếm không dấu tìm được phim có dấu, URL đồng bộ", async ({ page }) => {
    await selectProfile(page);
    await page.goto("/browse");
    await hydrated(page);
    await page.getByRole("button", { name: "Tìm kiếm" }).click();
    await page.getByTestId("search-input").fill("nguoi gac den");
    await expect(page).toHaveURL(/\/search\?q=nguoi(\+|%20)gac(\+|%20)den/);
    await expect(page.getByRole("link", { name: "Người Gác Đèn Biển" })).toBeVisible();
    // clearing returns to where the search started
    await page.getByRole("button", { name: "Xóa tìm kiếm" }).click();
    await expect(page).toHaveURL(/\/browse$/);
  });

  test("trang tài khoản hiển thị gói đang hoạt động và thiết bị", async ({ page }) => {
    await page.goto("/account");
    await expect(page.getByTestId("membership-active")).toBeVisible();
    await expect(page.getByText(ACCOUNTS.demo.email)).toBeVisible();
    await expect(page.getByTestId("device-sessions")).toBeVisible();
  });
});

test.describe("tài khoản chưa có gói (free)", () => {
  test.use({ storageState: authFile("free") });

  test("vẫn duyệt được, thấy banner kích hoạt gói và trạng thái trên trang tài khoản", async ({ page }) => {
    await page.goto("/browse");
    await expect(page).toHaveURL(/\/profiles/); // no profile picked yet → profile gate
    await page.getByTestId("profile-tile").first().click();
    await page.waitForURL("**/browse");
    await expect(page.getByTestId("no-subscription-banner")).toBeVisible();
    await page.goto("/account");
    await expect(page.getByTestId("membership-inactive")).toBeVisible();
    await expect(page.getByRole("link", { name: "Liên hệ kích hoạt" })).toBeVisible();
  });
});

test.describe("khách chưa đăng nhập", () => {
  test("bị chuyển về đăng nhập / landing", async ({ page }) => {
    await page.goto("/browse");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?next=%2Faccount/);
    await page.goto("/title/bat-ky");
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("plan-cards")).toBeVisible();
  });

  test("email ở landing chuyển sang đăng ký, form báo lỗi tiếng Việt", async ({ page }) => {
    await page.goto("/");
    await hydrated(page);
    await page.getByLabel("Địa chỉ email").first().fill("ban@vidu.vn");
    await page.getByRole("button", { name: "Bắt đầu" }).first().click();
    await expect(page).toHaveURL(/\/signup\?email=ban%40vidu\.vn/);
    await page.getByRole("button", { name: "Tiếp theo" }).click();
    await expect(page.getByText("Mật khẩu phải có ít nhất 8 ký tự.")).toBeVisible();
  });
});

test("đăng xuất", async ({ page }) => {
  // its own login: signing out revokes the session, so never reuse the shared storage state here
  await page.goto("/login");
  await hydrated(page);
  await page.getByLabel("Email").fill(ACCOUNTS.demo.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(ACCOUNTS.demo.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL(/\/profiles/);
  await page.getByRole("button", { name: "Chọn hồ sơ Demo" }).click();
  await page.waitForURL("**/browse");
  await page.getByTestId("profile-menu-trigger").click();
  await page.getByTestId("sign-out").click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.goto("/browse");
  await expect(page).toHaveURL(/\/login$/);
});
