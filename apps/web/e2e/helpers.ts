import type { Page } from "@playwright/test";

export const ACCOUNTS = {
  demo: { email: "demo@example.com", password: "Demo@12345" },
  free: { email: "free@example.com", password: "Free@12345" },
} as const;

export const authFile = (name: keyof typeof ACCOUNTS) => `e2e/.auth/${name}.json`;

/** Pick the first non-kids profile on /profiles (or the first one). */
export async function pickProfile(page: Page, name?: string) {
  await page.waitForURL(/\/profiles/);
  const tile = name ? page.getByRole("button", { name: `Chọn hồ sơ ${name}` }) : page.getByTestId("profile-tile").first();
  await tile.click();
  await page.waitForURL(/\/browse/);
}

/** Wait until the client bundle has hydrated (forms are controlled React inputs). */
export async function hydrated(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => {
    const el = document.querySelector("form, main, body > div");
    return !!el && Object.keys(el).some((k) => k.startsWith("__react"));
  });
}
