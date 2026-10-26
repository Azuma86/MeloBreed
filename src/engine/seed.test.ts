import { describe, expect, it } from "vitest";
import { childSeed, deriveSeed, isValidSelection } from "@/engine/seed";

describe("deriveSeed", () => {
  it("does not depend on the order of the selection", () => {
    expect(deriveSeed(7, [2, 0])).toBe(deriveSeed(7, [0, 2]));
    expect(deriveSeed(7, [5, 1, 3])).toBe(deriveSeed(7, [1, 3, 5]));
  });

  it("changes with the seed, the selection and the attempt", () => {
    const seeds = new Set([
      deriveSeed(7, [0]),
      deriveSeed(8, [0]),
      deriveSeed(7, [1]),
      deriveSeed(7, [0, 1]),
      deriveSeed(7, [0], 1),
    ]);
    expect(seeds.size).toBe(5);
  });

  it("returns 32-bit unsigned integers that createRng accepts", () => {
    for (let seed = 0; seed < 200; seed++) {
      const derived = deriveSeed(seed, [seed % 8]);
      expect(Number.isInteger(derived)).toBe(true);
      expect(derived).toBeGreaterThanOrEqual(0);
      expect(derived).toBeLessThan(2 ** 32);
    }
  });

  it("rejects invalid selections", () => {
    for (const bad of [[], [0, 0], [0, 1, 2, 3], [8], [-1], [1.5]]) {
      expect(() => deriveSeed(1, bad)).toThrow(RangeError);
      expect(isValidSelection(bad)).toBe(false);
    }
  });

  // Saved sessions record seeds, so the derivation must not change silently.
  it("matches the reference values", () => {
    expect([
      deriveSeed(42, [0]),
      deriveSeed(42, [0, 2]),
      deriveSeed(42, [1, 3, 7]),
      childSeed(42, 0),
      childSeed(42, 1),
    ]).toEqual([2990893251, 1713659914, 4085810474, 3352979289, 2483797696]);
  });
});

describe("childSeed", () => {
  it("gives each pool index its own seed", () => {
    const seeds = new Set(
      Array.from({ length: 256 }, (_, i) => childSeed(9, i)),
    );
    expect(seeds.size).toBe(256);
  });
});
