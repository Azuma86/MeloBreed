import type { Page } from "@playwright/test";
import {
  dictionaries,
  expect,
  startBreeding,
  test,
  type Lang,
} from "./fixtures";

const WIDTH = 375;

/**
 * Compares with the width we set, not innerWidth: mobile Chromium widens the layout viewport to
 * fit overflowing content, so innerWidth grows with it.
 */
const pageWidth = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth);

for (const lang of ["ja", "en"] as const satisfies Lang[]) {
  test(`fits a 375px screen without sideways scrolling (${lang})`, async ({
    page,
  }) => {
    const dict = dictionaries[lang];
    await page.setViewportSize({ width: WIDTH, height: 667 });
    await page.goto(`/${lang}`);
    expect(await pageWidth(page)).toBeLessThanOrEqual(WIDTH);

    await startBreeding(page, lang);
    expect(await pageWidth(page)).toBeLessThanOrEqual(WIDTH);
    // The bottom bar keeps the next step on screen.
    await expect(
      page.getByRole("button", { name: dict.breed.next }),
    ).toBeInViewport();
  });
}

test("the root redirects by the browser language", async ({ request }) => {
  for (const [header, lang] of [
    ["ja,en;q=0.8", "ja"],
    ["en-US,en;q=0.9", "en"],
  ] as const) {
    const response = await request.get("/", {
      headers: { "accept-language": header },
      maxRedirects: 0,
    });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(
      new URL(response.headers().location ?? "", "http://x").pathname,
    ).toBe(`/${lang}`);
  }
});

test("the footer switches to the same page in the other language", async ({
  page,
}) => {
  await page.goto("/en/privacy");
  await page
    .getByRole("link", { name: dictionaries.en.footer.language })
    .click();
  await expect(page).toHaveURL(/\/ja\/privacy$/);
  await expect(
    page.getByRole("heading", { name: dictionaries.ja.privacy.title }),
  ).toBeVisible();
});
