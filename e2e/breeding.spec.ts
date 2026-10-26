import {
  candidate,
  dictionaries,
  expect,
  fill,
  generationHeading,
  nextButton,
  startBreeding,
  test,
} from "./fixtures";

const { en } = dictionaries;

test("a first visit starts a session with eight candidates", async ({
  page,
}) => {
  await page.goto("/en");
  await expect(
    page.getByRole("heading", { name: en.hero.title }),
  ).toBeVisible();
  await page.getByRole("button", { name: en.setup.start }).click();

  await expect(generationHeading(page, 1)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Melody \d: Play$/ }),
  ).toHaveCount(8);
  // The landing copy gives way to the melodies.
  await expect(page.getByRole("heading", { name: en.hero.title })).toBeHidden();
  await expect(page.getByText(en.breed.hint)).toBeVisible();
  await expect(nextButton(page)).toBeDisabled();
});

test("up to three candidates can be picked", async ({ page }) => {
  await startBreeding(page);
  for (const n of [1, 2, 3]) await candidate(page, n).pick.click();

  await expect(page.getByText(fill(en.breed.selected, 3))).toBeVisible();
  await expect(page.getByText(en.breed.full)).toBeVisible();
  await expect(candidate(page, 4).pick).toBeDisabled();

  await candidate(page, 2).picked.click();
  await expect(page.getByText(fill(en.breed.selected, 2))).toBeVisible();
  await candidate(page, 4).pick.click();
  await expect(candidate(page, 4).picked).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(nextButton(page)).toBeEnabled();
});

test("breeds to generation 3, resumes after a reload and goes back with picks kept", async ({
  page,
}) => {
  await startBreeding(page);
  await candidate(page, 1).pick.click();
  await nextButton(page).click();
  // The new generation is announced: its heading takes focus.
  await expect(generationHeading(page, 2)).toBeFocused();
  await expect(nextButton(page)).toBeDisabled();

  await candidate(page, 2).pick.click();
  await nextButton(page).click();
  await expect(generationHeading(page, 3)).toBeFocused();

  // The piano roll is the first drawing on the card; the rest are icons.
  const roll = page.locator("#candidate-0 svg").first();
  const before = await roll.innerHTML();
  await page.reload();
  await expect(generationHeading(page, 3)).toBeVisible();
  expect(await roll.innerHTML()).toBe(before);

  await page.getByRole("button", { name: en.breed.back }).click();
  await expect(generationHeading(page, 2)).toBeFocused();
  await expect(candidate(page, 2).picked).toBeVisible();
  await page.getByRole("button", { name: en.breed.back }).click();
  await expect(generationHeading(page, 1)).toBeVisible();
  await expect(candidate(page, 1).picked).toBeVisible();
  await expect(page.getByRole("button", { name: en.breed.back })).toBeHidden();
});

test("starting over can be undone", async ({ page }) => {
  await startBreeding(page);
  await candidate(page, 1).pick.click();
  await nextButton(page).click();
  await expect(generationHeading(page, 2)).toBeVisible();

  await page.getByRole("button", { name: en.breed.startOver }).click();
  await expect(generationHeading(page, 1)).toBeFocused();
  await expect(page.getByText(en.breed.undoMessage)).toBeVisible();

  await page.getByRole("button", { name: en.breed.undo, exact: true }).click();
  await expect(generationHeading(page, 2)).toBeVisible();
  await expect(page.getByText(en.breed.undoMessage)).toBeHidden();
});
