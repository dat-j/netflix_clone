import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { authFile } from "./helpers";

/**
 * Visual sweep at 390 / 768 / 1440: `npx playwright test --project=screens`.
 * Writes <repo>/tmp/screens/site/<width>-<screen>.png
 */
const OUT = path.resolve(__dirname, "../../../tmp/screens/site");
fs.mkdirSync(OUT, { recursive: true });

const WIDTHS = [
  { w: 390, h: 844, touch: true },
  { w: 768, h: 1024, touch: true },
  { w: 1440, h: 900, touch: false },
] as const;

const shot = (page: Page, w: number, name: string, fullPage = false) =>
  page.screenshot({ path: path.join(OUT, `${w}-${name}.png`), fullPage, animations: "disabled" });

async function settle(page: Page, ms = 1200) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(ms);
}

async function selectProfile(page: Page) {
  const profiles = (await (await page.request.get("/api/v1/profiles")).json()) as { id: string; isKids: boolean }[];
  const p = profiles.find((x) => !x.isKids) ?? profiles[0];
  await page.request.post(`/api/v1/profiles/${p.id}/select`);
}

for (const { w, h, touch } of WIDTHS) {
  test.describe(`${w}px`, () => {
    test.use({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: w < 500 });

    test.describe("khách", () => {
      test(`landing + đăng nhập @${w}`, async ({ page }) => {
        await page.goto("/");
        await settle(page);
        await shot(page, w, "landing");
        await shot(page, w, "landing-full", true);
        await page.goto("/login");
        await settle(page, 600);
        await shot(page, w, "login");
        await page.getByRole("button", { name: "Đăng nhập" }).click();
        await shot(page, w, "login-errors");
        await page.goto("/plans");
        await settle(page);
        await shot(page, w, "plans", true);
      });
    });

    test.describe("thành viên", () => {
      test.use({ storageState: authFile("demo") });

      test(`trong ứng dụng @${w}`, async ({ page }) => {
        await page.goto("/profiles");
        await settle(page);
        await shot(page, w, "profiles");
        await page.getByRole("button", { name: "Quản lý hồ sơ" }).click();
        await page.getByTestId("profile-tile").first().click();
        await settle(page, 600);
        await shot(page, w, "profile-edit");
        await page.keyboard.press("Escape");

        await selectProfile(page);
        await page.goto("/browse");
        await expect(page.getByTestId("browse-row").first()).toBeVisible();
        await settle(page, 2000);
        await shot(page, w, "browse-top");
        await page.mouse.wheel(0, Math.round(h * 0.75));
        await settle(page, 1200);
        await shot(page, w, "browse-scrolled");

        const card = page.getByTestId("browse-row").nth(1).getByTestId("title-card").nth(1);
        await card.scrollIntoViewIfNeeded();
        if (!touch) {
          await card.hover();
          await expect(page.getByTestId("hover-card")).toBeVisible();
          await page.waitForTimeout(700);
          await shot(page, w, "hover-card");
          await page.mouse.move(2, 2);
        }
        await card.click();
        await expect(page.getByTestId("title-detail")).toBeVisible();
        await settle(page, 1500);
        await shot(page, w, "detail-modal");
        await page.getByTestId("detail-modal").evaluate((el) => el.scrollTo({ top: 900 }));
        await page.waitForTimeout(800);
        await shot(page, w, "detail-modal-similar");
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("detail-modal")).toBeHidden();

        await page.goto("/search?q=nguoi");
        await settle(page);
        await shot(page, w, "search");

        await page.goto("/browse/series");
        await settle(page, 1500);
        await shot(page, w, "series");

        await page.goto("/my-list");
        await settle(page);
        await shot(page, w, "my-list");

        await page.goto("/account");
        await settle(page);
        await shot(page, w, "account");
        await shot(page, w, "account-full", true);
      });
    });
  });
}
