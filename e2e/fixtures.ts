/**
 * Shared setup for the end-to-end tests. Every test:
 * - answers analytics (`/ingest/**`, posthog.com, beacons) and waitlist requests inside the
 *   browser, and records the analytics ones. As a second guard, the test build does not relay
 *   `/ingest` to PostHog (`MELOBREED_E2E` in playwright.config.ts and next.config.ts);
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
 * WebKit logs "Fetch API cannot load <url> due to access control checks" when a request is
 * cancelled by a reload or by the page closing, and Playwright reports that as a page error.
 * Seen for link prefetches (`?_rsc=`), the MIDI blob and analytics; the app is unaffected.
 * Only same-origin URLs are ignored: a real CORS failure would name another origin.
 */
const isCancelledRequest = (message: string, host: string) =>
  message.includes("due to access control checks") && message.includes(host);

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
        // posthog-js flushes on pagehide with keepalive fetches or beacons, which the browser
        // may send after the page is gone, past page.route. Make them plain fetches, which the
        // route below answers (or which die with the page).
        const fetchWithKeepalive = window.fetch;
        window.fetch = (input, init) =>
          fetchWithKeepalive(input, init && { ...init, keepalive: false });
        navigator.sendBeacon = (url, data) => {
          fetch(url, { method: "POST", body: data ?? null }).catch(() => {});
          return true;
        };
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
      // Leave the page while the route is still in place: WebKit sends what posthog-js flushes
      // on pagehide unrouted if that happens as the context closes.
      await page.goto("about:blank").catch(() => {});
    },
    { auto: true },
  ],
  page: async ({ page, consent, baseURL }, provide) => {
    const host = new URL(baseURL ?? "http://localhost").host;
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      if (!isCancelledRequest(error.message, host)) errors.push(error.message);
    });
    // Tests that submit the waitlist register their own handler, which takes precedence.
    await page.route("**/api/waitlist", (route) =>
      route.fulfill({ status: 503 }),
    );
    if (consent !== "unset") {
      await page.addInitScript((value) => {
        // Not on the about:blank page left to at the end, which has no storage.
        if (location.protocol.startsWith("http")) {
          localStorage.setItem("melobreed.consent", value);
        }
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
