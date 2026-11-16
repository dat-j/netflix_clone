import { expect, test as setup } from "@playwright/test";
import { ACCOUNTS, authFile, hydrated } from "./helpers";

/**
 * Logs each account in ONCE through the real login form (auth endpoints are rate-limited)
 * and stores the cookies for the specs.
 */
for (const name of Object.keys(ACCOUNTS) as (keyof typeof ACCOUNTS)[]) {
  setup(`log in as ${name}`, async ({ page }) => {
    const { email, password } = ACCOUNTS[name];
    await page.goto("/login");
    await hydrated(page);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await page.waitForURL(/\/profiles/);
    await expect(page.getByRole("heading", { name: "Ai đang xem?" })).toBeVisible();
    await page.context().storageState({ path: authFile(name) });
  });
}
