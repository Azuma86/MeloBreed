import { describe, expect, it } from "vitest";
import { distance } from "@/engine/critic";
import { generateInitial } from "@/engine/generate";
import { melodyKey, validationError } from "@/engine/melody";
import { SCALE_IDS } from "@/engine/music";
import {
  BPM_MAX,
  BPM_MIN,
  CANDIDATES,
  PRESETS,
  PRESET_IDS,
  type Settings,
} from "@/engine/presets";

/** All 240 preset × key × scale combinations. */
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

describe("generateInitial", () => {
  it(
    "returns 8 distinct valid melodies for every setting (AC5)",
    { timeout: 60_000 },
    () => {
      allSettings.forEach((settings, i) => {
        for (const seed of [i, 1_000 + i]) {
          const melodies = generateInitial(settings, seed);
          expect(melodies).toHaveLength(CANDIDATES);
          for (const m of melodies) {
            expect(validationError(m, settings)).toBeUndefined();
          }
          expect(new Set(melodies.map(melodyKey)).size).toBe(CANDIDATES);
        }
      });
    },
  );

  it(
    "stays valid at the slowest and fastest tempos",
    { timeout: 30_000 },
    () => {
      for (const preset of PRESET_IDS) {
        for (const bpm of [BPM_MIN, BPM_MAX]) {
          const settings: Settings = { ...allSettings[0]!, preset, bpm };
          for (let seed = 0; seed < 10; seed++) {
            for (const m of generateInitial(settings, seed)) {
              expect(validationError(m, settings)).toBeUndefined();
            }
          }
        }
      }
    },
  );

  it("is deterministic for a seed and settings (AC6)", () => {
    const settings = allSettings[37]!;
    expect(generateInitial(settings, 99)).toEqual(
      generateInitial(settings, 99),
    );
    expect(generateInitial(settings, 99)).not.toEqual(
      generateInitial(settings, 100),
    );
  });

  it("spreads the candidates apart", () => {
    for (const settings of allSettings.slice(0, 40)) {
      const melodies = generateInitial(settings, 5);
      let closest = 1;
      for (let i = 0; i < melodies.length; i++) {
        for (let j = i + 1; j < melodies.length; j++) {
          closest = Math.min(closest, distance(melodies[i]!, melodies[j]!));
        }
      }
      expect(closest).toBeGreaterThan(0.2);
    }
  });
});
