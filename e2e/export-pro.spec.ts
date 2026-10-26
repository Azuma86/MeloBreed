import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import {
  candidate,
  dictionaries,
  expect,
  startBreeding,
  test,
} from "./fixtures";

const { en } = dictionaries;

const proDialog = (page: Page) => page.getByRole("dialog");

test("exports a MIDI file, then offers Pro", async ({ page }) => {
  await startBreeding(page);
  const download = page.waitForEvent("download");
  await candidate(page, 2).exportMidi.click();

  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^melobreed-[a-z]+-[A-G]s?(maj|min|dor|majpent|minpent)-\d+bpm-g1-2\.mid$/,
  );
  const bytes = await readFile(await file.path());
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("MThd");

  await expect(page.getByText(en.export.done)).toBeVisible();
  await page.getByRole("button", { name: en.export.seePro }).click();
  await expect(proDialog(page)).toBeVisible();
});

test("the export notice can be dismissed", async ({ page }) => {
  await startBreeding(page);
  await candidate(page, 1).exportMidi.click();
  await page.getByRole("button", { name: en.export.dismiss }).click();
  await expect(page.getByText(en.export.done)).toBeHidden();
});

test("Pro opens from the header and closes with Escape or the close button", async ({
  page,
}) => {
  await page.goto("/en");
  await page.getByRole("button", { name: en.pro.button }).click();
  await expect(proDialog(page)).toBeVisible();
  await expect(proDialog(page).getByText(en.pro.price)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(proDialog(page)).toBeHidden();

  await page.getByRole("button", { name: en.pro.button }).click();
  await proDialog(page).getByRole("button", { name: en.pro.close }).click();
  await expect(proDialog(page)).toBeHidden();
});

test("the waitlist rejects an invalid email, then accepts a valid one", async ({
  page,
}) => {
  const bodies: unknown[] = [];
  await page.route("**/api/waitlist", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/en");
  await page.getByRole("button", { name: en.pro.button }).click();
  const email = proDialog(page).getByRole("textbox", {
    name: en.pro.emailLabel,
  });
  const submit = proDialog(page).getByRole("button", { name: en.pro.submit });

  await email.fill("not-an-email");
  await submit.click();
  await expect(proDialog(page).getByRole("alert")).toHaveText(
    en.pro.invalidEmail,
  );
  expect(bodies).toEqual([]);

  await email.fill("e2e@example.com");
  await submit.click();
  await expect(proDialog(page).getByText(en.pro.success)).toBeVisible();
  expect(bodies).toEqual([
    {
      email: "e2e@example.com",
      locale: "en",
      source: "header",
      honeypot: "",
    },
  ]);
});

test("the waitlist shows an error when the server fails", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("button", { name: en.pro.button }).click();
  await proDialog(page)
    .getByRole("textbox", { name: en.pro.emailLabel })
    .fill("e2e@example.com");
  await proDialog(page).getByRole("button", { name: en.pro.submit }).click();
  await expect(proDialog(page).getByRole("alert")).toHaveText(en.pro.error);
});
