import type { Page } from "@playwright/test";
import {
  candidate,
  dictionaries,
  expect,
  generationHeading,
  nextButton,
  test,
} from "./fixtures";

const { en } = dictionaries;

// posthog-js batches events and sends them every few seconds, so proving that nothing was sent
// means waiting longer than one batch.
const BATCH_WAIT_MS = 5_000;

test.use({ consent: "unset" });

const banner = (page: Page) =>
  page.getByRole("region", { name: en.consent.privacy });

/**
 * Without reloading, does everything that records an event: start, play, pick, export and
 * (optionally) breed.
 */
async function useTheApp(page: Page, { breed = true } = {}) {
  await page.getByRole("button", { name: en.setup.start }).click();
  await expect(generationHeading(page, 1)).toBeVisible();
  await candidate(page, 1).play.click();
  await candidate(page, 1).pick.click();
  const download = page.waitForEvent("download");
  await candidate(page, 1).exportMidi.click();
  await (await download).path();
  if (breed) {
    await nextButton(page).click();
    await expect(generationHeading(page, 2)).toBeVisible();
  }
}

test("sends nothing before the visitor chooses", async ({
  page,
  analyticsRequests,
}) => {
  await page.goto("/en");
  await expect(banner(page)).toBeVisible();
  // The banner covers the bottom bar until a choice is made, so no breeding here.
  await useTheApp(page, { breed: false });
  await page.waitForTimeout(BATCH_WAIT_MS);
  expect(analyticsRequests).toEqual([]);
});

test("sends nothing after Decline, also after a reload", async ({
  page,
  analyticsRequests,
}) => {
  await page.goto("/en");
  await banner(page).getByRole("button", { name: en.consent.decline }).click();
  await expect(banner(page)).toBeHidden();
  await useTheApp(page);
  await page.reload();
  await expect(generationHeading(page, 2)).toBeVisible();
  await expect(banner(page)).toBeHidden();
  await page.waitForTimeout(BATCH_WAIT_MS);
  expect(analyticsRequests).toEqual([]);
});

test("sends events after Allow", async ({ page, analyticsRequests }) => {
  await page.goto("/en");
  await banner(page).getByRole("button", { name: en.consent.accept }).click();
  await expect(banner(page)).toBeHidden();
  await useTheApp(page);
  await expect
    .poll(() => analyticsRequests.length, { timeout: 10_000 })
    .toBeGreaterThan(0);
});

test("Analytics settings reopens the banner; allowing there sends, also after a reload", async ({
  page,
  analyticsRequests,
}) => {
  await page.goto("/en");
  await banner(page).getByRole("button", { name: en.consent.decline }).click();
  await page.getByRole("button", { name: en.footer.analytics }).click();
  await banner(page).getByRole("button", { name: en.consent.accept }).click();
  await useTheApp(page);
  await expect
    .poll(() => analyticsRequests.length, { timeout: 10_000 })
    .toBeGreaterThan(0);

  // The stored choice starts analytics on the next visit.
  await page.reload();
  const sent = analyticsRequests.length;
  await expect(generationHeading(page, 2)).toBeVisible();
  await expect(banner(page)).toBeHidden();
  await candidate(page, 2).play.click();
  await expect
    .poll(() => analyticsRequests.length, { timeout: 10_000 })
    .toBeGreaterThan(sent);
});
