/** Draw helpers over an injected `Rng`. */
import type { Rng } from "./rng";

export const chance = (rng: Rng, p: number): boolean => rng.next() < p;

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[rng.int(0, items.length)];
  if (item === undefined) throw new RangeError("pick from an empty list");
  return item;
}

/** Index drawn with probability proportional to its weight. */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = rng.next() * total;
  let lastPositive = weights.length - 1;
  for (const [i, w] of weights.entries()) {
    if (w <= 0) continue;
    lastPositive = i;
    r -= w;
    if (r < 0) return i;
  }
  // Rounding can leave r at a hair above 0; fall back to the last index that had weight.
  return lastPositive;
}

/** `count` distinct indices, each drawn in proportion to its weight. */
export function weightedSample(
  rng: Rng,
  weights: readonly number[],
  count: number,
): number[] {
  const remaining = [...weights];
  const chosen: number[] = [];
  for (let k = 0; k < count; k++) {
    if (remaining.every((w) => w <= 0)) break;
    const i = weightedIndex(rng, remaining);
    chosen.push(i);
    remaining[i] = 0;
  }
  return chosen;
}

/** -1 or 1. */
export const sign = (rng: Rng): number => (rng.next() < 0.5 ? -1 : 1);
