import { describe, expect, it } from "vitest";
import { breed, breedWithOrigins } from "@/engine/breed";
import { sharesHalf } from "@/engine/critic";
import { generateInitial } from "@/engine/generate";
import {
  degreeRange,
  melodyKey,
  validationError,
  type Melody,
} from "@/engine/melody";
import { SCALE_IDS } from "@/engine/music";
import {
  CANDIDATES,
  PRESETS,
  PRESET_IDS,
  type Settings,
} from "@/engine/presets";
import { createRng } from "@/engine/rng";

const allSettings: Settings[] = PRESET_IDS.flatMap((preset) =>
  SCALE_IDS.flatMap((scale) =>
    Array.from({ length: 12 }, (_, key) => ({
      preset,
      scale,
      key,
      bpm: PRESETS[preset].defaultBpm,
    })),
  ),
);

/** AC5 and AC7 for one generation of children. */
function expectChildrenOk(
  children: readonly { melody: Melody; dominant: number }[],
  parents: readonly Melody[],
  settings: Settings,
): void {
  expect(children).toHaveLength(CANDIDATES);
  expect(new Set(children.map((c) => melodyKey(c.melody))).size).toBe(
    CANDIDATES,
  );
  const parentKeys = new Set(parents.map(melodyKey));
  for (const { melody: child, dominant } of children) {
    expect(validationError(child, settings)).toBeUndefined();
    expect(parentKeys.has(melodyKey(child))).toBe(false);
    expect(parents.some((p) => sharesHalf(child, p))).toBe(true);
    // Within ±25% of the dominant parent's note count.
    const n = child.notes.length;
    const base = parents[dominant]!.notes.length;
    expect(4 * n).toBeGreaterThanOrEqual(3 * base);
    expect(4 * n).toBeLessThanOrEqual(5 * base);
  }
}

/** 1–3 distinct indices out of 8, drawn from `rng`. */
function randomSelection(rng: ReturnType<typeof createRng>): number[] {
  const count = rng.int(1, 4);
  const picked = new Set<number>();
  while (picked.size < count) picked.add(rng.int(0, CANDIDATES));
  return [...picked].sort((a, b) => a - b);
}

describe("breed", () => {
  it(
    "keeps AC5 and AC7 over 3-generation chains across all settings",
    { timeout: 120_000 },
    () => {
      // 240 settings × 3 generations = 720 bred generations, each from 1–3 random parents.
      allSettings.forEach((settings, i) => {
        const rng = createRng(i);
        let candidates = generateInitial(settings, i);
        for (let generation = 0; generation < 3; generation++) {
          const parents = randomSelection(rng).map((k) => candidates[k]!);
          const children = breedWithOrigins(
            parents,
            settings,
            rng.int(0, 2 ** 31),
          );
          expectChildrenOk(children, parents, settings);
          candidates = children.map((c) => c.melody);
        }
      });
    },
  );

  it("is deterministic for the same parents, settings and seed (AC6)", () => {
    const settings = allSettings[100]!;
    const parents = generateInitial(settings, 3).slice(0, 2);
    expect(breed(parents, settings, 11)).toEqual(breed(parents, settings, 11));
    expect(breed(parents, settings, 11)).not.toEqual(
      breed(parents, settings, 12),
    );
  });

  it("fills eight from a minimal parent at the top of the range", () => {
    for (const settings of [allSettings[0]!, allSettings[200]!]) {
      const { max } = degreeRange(settings);
      // Eight notes on strong beats alternating between the two highest degrees.
      const parent: Melody = {
        progression: 0,
        notes: Array.from({ length: 8 }, (_, i) => ({
          degree: max - (i % 2),
          start: i * 8,
          duration: 8,
        })),
      };
      expect(validationError(parent, settings)).toBeUndefined();
      for (let seed = 0; seed < 20; seed++) {
        expectChildrenOk(
          breedWithOrigins([parent], settings, seed),
          [parent],
          settings,
        );
      }
    }
  });

  it("handles three near-identical parents", () => {
    const settings = allSettings[42]!;
    const base = generateInitial(settings, 8)[0]!;
    const variant = (i: number, delta: number): Melody => ({
      ...base,
      notes: base.notes.map((n, k) =>
        k === i ? { ...n, degree: n.degree + delta } : n,
      ),
    });
    const parents = [base, variant(1, 1), variant(2, -1)].filter(
      (p) => validationError(p, settings) === undefined,
    );
    for (let seed = 0; seed < 20; seed++) {
      expectChildrenOk(
        breedWithOrigins(parents, settings, seed),
        parents,
        settings,
      );
    }
  });
});
