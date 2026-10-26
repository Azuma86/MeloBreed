import {
  candidate,
  dictionaries,
  expect,
  startBreeding,
  test,
} from "./fixtures";

const { en } = dictionaries;

// Headless browsers have no audio output, so these check what the screen shows while playing.

test("a card toggles between play and stop", async ({ page }) => {
  await startBreeding(page);
  await candidate(page, 3).play.click();
  await expect(candidate(page, 3).stop).toBeVisible();
  await candidate(page, 3).stop.click();
  await expect(candidate(page, 3).play).toBeVisible();
});

test("play all can be stopped from the card that is playing", async ({
  page,
}) => {
  await startBreeding(page);
  await page.getByRole("button", { name: en.breed.playAll }).click();
  await expect(
    page.getByRole("button", { name: en.breed.stop, exact: true }),
  ).toBeVisible();

  const playingCard = page.getByRole("button", { name: /^Melody \d: Stop$/ });
  await expect(playingCard).toHaveCount(1);
  await playingCard.click();
  await expect(playingCard).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: en.breed.playAll }),
  ).toBeVisible();
});
