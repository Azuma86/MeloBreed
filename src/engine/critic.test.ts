import { describe, expect, it } from "vitest";
import {
  differsEnough,
  distance,
  editAmount,
  quality,
  qualityBreakdown,
  sharesHalf,
} from "@/engine/critic";
import type { Melody, Note } from "@/engine/melody";
import { defaultSettings } from "@/engine/presets";

// C major, J-pop range 62–83: degree 7 = C4 (60), 14 = C5 (72).
const settings = {
  ...defaultSettings("jpop"),
  key: 0,
  scale: "major" as const,
};

const melody = (
  notes: [number, number, number][],
  progression = 0,
): Melody => ({
  progression,
  notes: notes.map(([degree, start, duration]): Note => ({
    degree,
    start,
    duration,
  })),
});

// Stepwise, repeats its first bar's rhythm, ends on a held tonic.
const singable = melody([
  [9, 0, 4],
  [10, 4, 4],
  [11, 8, 4],
  [10, 12, 4],
  [9, 16, 4],
  [10, 20, 4],
  [11, 24, 4],
  [12, 28, 4],
  [11, 32, 4],
  [10, 36, 4],
  [9, 40, 8],
  [10, 48, 4],
  [8, 52, 4],
  [14, 56, 8],
]);

// Wide leaps that never turn back, monotone rhythm, ends off the tonic triad.
const awkward = melody([
  [8, 0, 2],
  [15, 2, 2],
  [9, 4, 2],
  [17, 6, 2],
  [10, 8, 2],
  [19, 10, 2],
  [8, 12, 2],
  [16, 14, 2],
  [9, 16, 2],
  [18, 18, 2],
  [12, 20, 2],
]);

const replaceDegree = (m: Melody, index: number, degree: number): Melody => ({
  ...m,
  notes: m.notes.map((n, i) => (i === index ? { ...n, degree } : n)),
});

describe("sharesHalf", () => {
  const parent = melody(Array.from({ length: 8 }, (_, i) => [9, i * 8, 8]));
  const changed = (count: number) =>
    Array.from({ length: count }, (_, i) => i).reduce(
      (m, i) => replaceDegree(m, i, 12),
      parent,
    );

  it("holds at exactly half shared and fails below", () => {
    expect(sharesHalf(changed(4), parent)).toBe(true);
    expect(sharesHalf(changed(5), parent)).toBe(false);
  });

  it("measures the edit amount against the closest parent", () => {
    expect(editAmount(changed(2), [parent])).toBe(0.25);
    expect(editAmount(changed(2), [changed(5), parent])).toBe(0.25);
  });
});

describe("differsEnough", () => {
  const withDurations = (m: Melody, indices: number[]): Melody => ({
    ...m,
    notes: m.notes.map((n, i) =>
      indices.includes(i) ? { ...n, duration: n.duration - 1 } : n,
    ),
  });

  it("needs a pitch or start change, or two duration changes", () => {
    expect(differsEnough(singable, singable)).toBe(false);
    expect(differsEnough(withDurations(singable, [0]), singable)).toBe(false);
    expect(differsEnough(withDurations(singable, [0, 1]), singable)).toBe(true);
    expect(differsEnough(replaceDegree(singable, 3, 11), singable)).toBe(true);
  });
});

describe("distance", () => {
  it("is 0 for identical melodies, symmetric, and within [0, 1]", () => {
    expect(distance(singable, singable)).toBe(0);
    expect(distance(singable, awkward)).toBe(distance(awkward, singable));
    expect(distance(singable, awkward)).toBeGreaterThan(0);
    expect(distance(singable, awkward)).toBeLessThanOrEqual(1);
  });

  it("rates a one-step change closer than a different melody", () => {
    expect(distance(singable, replaceDegree(singable, 2, 12))).toBeLessThan(
      distance(singable, awkward),
    );
  });
});

describe("quality", () => {
  it("prefers a stepwise melody with a held tonic ending over leaps", () => {
    expect(quality(singable, settings)).toBeGreaterThan(
      quality(awkward, settings) + 0.2,
    );
  });

  it("scores every rule within [0, 1] without NaN, even for tiny melodies", () => {
    for (const m of [singable, awkward, melody([[9, 0, 1]]), melody([])]) {
      for (const value of Object.values(qualityBreakdown(m, settings))) {
        expect(Number.isNaN(value)).toBe(false);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("rewards ending on the tonic over ending elsewhere", () => {
    const offTonic = replaceDegree(singable, singable.notes.length - 1, 13);
    expect(qualityBreakdown(singable, settings).cadence).toBeGreaterThan(
      qualityBreakdown(offTonic, settings).cadence,
    );
  });
});
