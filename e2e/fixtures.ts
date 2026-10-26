/**
 * Shared setup for the end-to-end tests. Every test:
 * - answers analytics (`/ingest/**`, posthog.com) and waitlist requests inside the browser, so
 *   nothing reaches PostHog or Supabase, and records the analytics ones;
 * - fails on an uncaught exception in the page;
 * - starts with analytics declined, so the consent banner stays out of the way (override with
 *   `test.use({ consent: "unset" })`).
 */
import { test as base, expect, type Page } from "@playwright/test";
import en from "../src/app/[lang]/dictionaries/en.json";
import ja from "../src/app/[lang]/dictionaries/ja.json";

export { expect };
export const dictionaries = { en, ja };
export type Lang = keyof typeof dictionaries;

/** Fills `{n}` in a dictionary template. */
export const fill = (template: string, n: number) =>
  template.replace("{n}", String(n));

interface Fixtures {
  /** The stored analytics choice when the page loads; "unset" shows the banner. */
  consent: "denied" | "unset";
  /** URLs of the analytics requests the page made (answered locally, never sent). */
  analyticsRequests: string[];
}

/**
 * WebKit occasionally reports a cancelled Next.js link prefetch (`?_rsc=`) as an uncaught
 * "access control checks" error (about 1 run in 100). The links still navigate normally.
 */
const isAbortedPrefetch = (message: string) =>
  message.includes("due to access control checks") && message.includes("_rsc=");

// Fixture bodies name their callback `provide`: `use` trips the React hooks lint rule.
export const test = base.extend<Fixtures>({
  consent: ["denied", { option: true }],
  analyticsRequests: [
    async ({ page }, provide) => {
      // posthog-js drops events from automated and headless browsers (navigator.webdriver, the
      // "HeadlessChrome" brand), which would make "nothing was sent" pass for the wrong reason.
      // Look like a person, so consent alone decides. The app reads neither property.
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "webdriver", {
          get: () => false,
        });
        Object.defineProperty(Navigator.prototype, "userAgentData", {
          get: () => undefined,
        });
      });
      const requests: string[] = [];
      await page.route(
        (url) =>
          url.pathname.startsWith("/ingest/") ||
          url.hostname.endsWith("posthog.com"),
        (route) => {
          requests.push(route.request().url());
          return route.fulfill({ json: {} });
        },
      );
      await provide(requests);
    },
    { auto: true },
  ],
  page: async ({ page, consent }, provide) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      if (!isAbortedPrefetch(error.message)) errors.push(error.message);
    });
    // Tests that submit the waitlist register their own handler, which takes precedence.
    await page.route("**/api/waitlist", (route) =>
      route.fulfill({ status: 503 }),
    );
    if (consent !== "unset") {
      await page.addInitScript((value) => {
        localStorage.setItem("melobreed.consent", value);
      }, consent);
    }
    await provide(page);
    expect(errors, "uncaught exceptions in the page").toEqual([]);
  },
});

/** Opens the app and starts a session with the default settings. */
export async function startBreeding(page: Page, lang: Lang = "en") {
  const dict = dictionaries[lang];
  await page.goto(`/${lang}`);
  await page.getByRole("button", { name: dict.setup.start }).click();
  await expect(generationHeading(page, 1, lang)).toBeVisible();
}

export const generationHeading = (page: Page, n: number, lang: Lang = "en") =>
  page.getByRole("heading", {
    level: 1,
    name: fill(dictionaries[lang].breed.generation, n),
  });

/** The controls of candidate `n` (1-based, as shown on the card). */
export function candidate(page: Page, n: number) {
  const card = page.locator(`#candidate-${n - 1}`);
  const name = (action: string) => ({
    name: `${fill(en.card.label, n)}: ${action}`,
    exact: true,
  });
  return {
    play: card.getByRole("button", name(en.card.play)),
    stop: card.getByRole("button", name(en.card.stop)),
    pick: card.getByRole("button", name(en.card.pick)),
    picked: card.getByRole("button", name(en.card.picked)),
    exportMidi: card.getByRole("button", name(en.card.exportLabel)),
  };
}

export const nextButton = (page: Page) =>
  page.getByRole("button", { name: en.breed.next });
