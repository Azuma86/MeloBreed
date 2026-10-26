/**
 * Deterministic seed derivation. Seeds are mixed with a 32-bit hash, never by adding: in mulberry32,
 * seeds `s` and `s + 0x6d2b79f5` yield the same stream shifted by one draw.
 */
import { CANDIDATES, MAX_PARENTS } from "./presets";

/** murmur3's finaliser: a bijective 32-bit mix. */
const fmix32 = (h: number): number => {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

const hashWords = (...words: number[]): number =>
  words.reduce(
    (h, word) => fmix32(Math.imul(h ^ (word >>> 0), 0x9e3779b1)),
    0x811c9dc5,
  );

/** Checks a parent selection: 1–3 distinct candidate indices. */
export function isValidSelection(selected: readonly number[]): boolean {
  return (
    selected.length >= 1 &&
    selected.length <= MAX_PARENTS &&
    new Set(selected).size === selected.length &&
    selected.every((i) => Number.isInteger(i) && i >= 0 && i < CANDIDATES)
  );
}

/**
 * Seed of the generation bred from `selected` candidates of the generation with `seed`.
 * Independent of selection order, so picking [2, 0] breeds the same children as [0, 2].
 * `attempt` leaves room for a future "reroll" without changing existing results.
 */
export function deriveSeed(
  seed: number,
  selected: readonly number[],
  attempt = 0,
): number {
  if (!isValidSelection(selected)) {
    throw new RangeError(`invalid selection [${selected.join(", ")}]`);
  }
  const mask = selected.reduce((m, i) => m | (1 << i), 0);
  return hashWords(0x4d420001, seed, mask, attempt);
}

/** Seed of the `index`-th candidate in a generation's pool, so one child's retries never shift another. */
export const childSeed = (generationSeed: number, index: number): number =>
  hashWords(0x4d420002, generationSeed, index);
