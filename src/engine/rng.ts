/** Source of randomness for the engine. Inject it so evolution runs are reproducible. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max). */
  int(min: number, max: number): number;
}

/**
 * Deterministic RNG (mulberry32): the same seed always yields the same sequence.
 * The seed must be an integer in [0, 2^32).
 */
export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(
      `createRng(${seed}): expected an integer in [0, 2^32)`,
    );
  }
  let state = seed;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max <= min) {
        throw new RangeError(
          `int(${min}, ${max}): expected integers with min < max`,
        );
      }
      return min + Math.floor(next() * (max - min));
    },
  };
}
