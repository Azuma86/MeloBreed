#!/usr/bin/env node
// Takes screenshots of the running app with Playwright, for UI review.
// Needs the browsers once: `npx playwright install chromium webkit`.
//
//   node scripts/screenshot.mjs <steps.json> <out-dir>
//
// steps.json is an array run in order; each step may combine these keys:
//   { "browser": "webkit", "device": "iPhone SE (3rd gen)" }
//                                                start a fresh browser (default chromium at
//                                                375×812); `device` is a Playwright device name
//                                                and adds its touch, user agent and pixel ratio
//                                                (and its browser, unless `browser` is given).
//                                                Storage starts empty, so put it first.
//   { "viewport": [375, 812], "dark": false }   viewport size and colour scheme
//   { "url": "http://localhost:3000/ja" }        navigate (then wait `waitAfter` ms, default 1000)
//   { "click": "text" }                          click the first button or link whose accessible
//                                                name is that text (exact match wins, then a
//                                                partial one), else the first element with it
//   { "press": "Tab" }                           press a key (Playwright key names)
//   { "eval": "js expression" }                  run in the page and print the result
//   { "aria": "main" }                           print the accessibility tree under a CSS selector
//   { "wait": 500 }                              pause
//   { "shot": "name", "full": true }             save <out-dir>/name.png (full = whole page)
// Page errors are printed at the end.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices, webkit } from "@playwright/test";

const [stepsFile, outDir] = process.argv.slice(2);
if (!stepsFile || !outDir) {
  console.error("usage: node scripts/screenshot.mjs <steps.json> <out-dir>");
  process.exit(2);
}
const steps = JSON.parse(readFileSync(stepsFile, "utf8"));
mkdirSync(outDir, { recursive: true });

const browsers = { chromium, webkit };
const errors = [];
let browser;
let page;

async function open(browserName, deviceName) {
  await browser?.close();
  const device = deviceName ? devices[deviceName] : undefined;
  if (deviceName && !device) throw new Error(`unknown device "${deviceName}"`);
  browserName ??= device?.defaultBrowserType ?? "chromium";
  const type = browsers[browserName];
  if (!type) throw new Error(`browser must be chromium or webkit`);
  browser = await type.launch(
    browserName === "chromium"
      ? { args: ["--autoplay-policy=no-user-gesture-required"] }
      : {},
  );
  const context = await browser.newContext(
    device ?? { viewport: { width: 375, height: 812 } },
  );
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
}

/** The first button or link named `text`, or failing that the first element containing it. */
async function find(text) {
  const candidates = [
    page.getByRole("button", { name: text, exact: true }),
    page.getByRole("link", { name: text, exact: true }),
    page.getByRole("button", { name: text }),
    page.getByRole("link", { name: text }),
    page.getByText(text),
  ];
  for (const locator of candidates) {
    if ((await locator.count()) > 0) return locator.first();
  }
  return undefined;
}

try {
  for (const step of steps) {
    if (!page || step.browser || step.device) {
      await open(step.browser, step.device);
    }
    if (step.viewport) {
      const [width, height] = step.viewport;
      await page.setViewportSize({ width, height });
    }
    if (step.dark !== undefined) {
      await page.emulateMedia({ colorScheme: step.dark ? "dark" : "light" });
    }
    if (step.url) {
      await page.goto(step.url);
      await page.waitForTimeout(step.waitAfter ?? 1000);
    }
    if (step.click) {
      const target = await find(step.click);
      if (target) {
        await target.click();
        await page.waitForTimeout(step.waitAfter ?? 400);
      } else {
        console.log(`click: no element matches "${step.click}"`);
      }
    }
    if (step.press) await page.keyboard.press(step.press);
    if (step.eval) {
      console.log("eval:", JSON.stringify(await page.evaluate(step.eval)));
    }
    if (step.aria) {
      console.log(
        `aria ${step.aria}:\n${await page.locator(step.aria).first().ariaSnapshot()}`,
      );
    }
    if (step.wait) await page.waitForTimeout(step.wait);
    if (step.shot) {
      const path = join(outDir, `${step.shot}.png`);
      await page.screenshot({ path, fullPage: !!step.full });
      console.log(`shot: ${path}`);
    }
  }
} finally {
  for (const error of errors) {
    console.log("page error:", error.slice(0, 400));
  }
  await browser?.close();
}
