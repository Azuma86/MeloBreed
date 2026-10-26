import { describe, expect, it } from "vitest";
import { createRng } from "@/engine/rng";

const draw = (seed: number, count: number): number[] => {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.next());
};

describe("createRng", () => {
  it("repeats the same sequence for the same seed", () => {
    expect(draw(42, 20)).toEqual(draw(42, 20));
  });

  it("produces different sequences for different seeds", () => {
    expect(draw(1, 20)).not.toEqual(draw(2, 20));
  });

  // Saved evolution runs replay from their seed, so the algorithm must not change silently.
  it("matches the reference mulberry32 output", () => {
    expect(draw(42, 3)).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099,
    ]);
  });

  // A missing or corrupted stored seed must fail loudly, not replay as another seed.
  it("rejects seeds that are not 32-bit unsigned integers", () => {
    for (const seed of [Number.NaN, -1, 1.5, 2 ** 32]) {
      expect(() => createRng(seed)).toThrow(RangeError);
    }
    expect(() => createRng(0)).not.toThrow();
    expect(() => createRng(2 ** 32 - 1)).not.toThrow();
  });

  it("returns floats in [0, 1)", () => {
    for (const value of draw(7, 10_000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  describe("int", () => {
    it("returns integers in [min, max) and reaches every value", () => {
      const rng = createRng(3);
      const seen = new Set<number>();
      for (let i = 0; i < 1_000; i++) {
        const value = rng.int(-2, 3);
        expect(Number.isInteger(value)).toBe(true);
        seen.add(value);
      }
      expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
    });

    it("rejects empty or non-integer ranges", () => {
      const rng = createRng(0);
      expect(() => rng.int(5, 5)).toThrow(RangeError);
      expect(() => rng.int(5, 1)).toThrow(RangeError);
      expect(() => rng.int(0, 1.5)).toThrow(RangeError);
    });
  });
});
