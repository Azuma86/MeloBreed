import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chrome",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    { name: "android-chrome", use: { ...devices["Pixel 7"] } },
    // The smallest current iPhone (375×667); WebKit stands in for iOS Safari.
    { name: "iphone-webkit", use: { ...devices["iPhone SE (3rd gen)"] } },
  ],
  webServer: {
    // A production build, as deployed. The PostHog key is a placeholder so the consent tests can
    // see analytics requests; the tests intercept them in the browser, so nothing leaves.
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}/en`,
    env: { NEXT_PUBLIC_POSTHOG_KEY: "phc_e2e_placeholder" },
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
