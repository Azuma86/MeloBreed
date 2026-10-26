import { describe, expect, it } from "vitest";
import { SCALE_IDS, degreeToPitch, pitchToDegree } from "@/engine/music";
import {
  BPM_MAX,
  BPM_MIN,
  PRESETS,
  PRESET_IDS,
  STEPS_PER_BAR,
  defaultSettings,
  isValidSettings,
  notesPerBar,
} from "@/engine/presets";

describe("PRESETS", () => {
  it.each(PRESET_IDS)("%s is internally consistent", (id) => {
    const p = PRESETS[id];
    expect(p.range.high - p.range.low).toBeGreaterThanOrEqual(12);
    expect(p.stepWeights).toHaveLength(STEPS_PER_BAR);
    expect(p.stepWeights.every((w) => w > 0)).toBe(true);
    expect(p.forms.length).toBeGreaterThan(0);
    expect(p.notesPerSecond.min).toBeLessThan(p.notesPerSecond.max);
    expect(isValidSettings(defaultSettings(id))).toBe(true);
  });

  it("leaves at least 8 scale degrees in range for every key and scale", () => {
    for (const id of PRESET_IDS) {
      const { low, high } = PRESETS[id].range;
      for (const scale of SCALE_IDS) {
        for (let key = 0; key < 12; key++) {
          let count = 0;
          for (let pitch = low; pitch <= high; pitch++) {
            if (pitchToDegree(pitch, key, scale) !== undefined) count++;
          }
          expect(count).toBeGreaterThanOrEqual(8);
          // The tonic is reachable in range.
          const tonics = [-14, -7, 0, 7, 14, 21].map((d) =>
            degreeToPitch(d, key, "major"),
          );
          expect(tonics.some((t) => t >= low && t <= high)).toBe(true);
        }
      }
    }
  });
});

describe("notesPerBar", () => {
  it("stays within 2–10 notes per bar at every tempo", () => {
    for (const preset of PRESET_IDS) {
      for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm++) {
        const { min, max } = notesPerBar({ ...defaultSettings(preset), bpm });
        expect(min).toBeGreaterThanOrEqual(2);
        expect(max).toBeLessThanOrEqual(10);
        expect(min).toBeLessThanOrEqual(max);
      }
    }
  });

  it("puts fewer notes in a bar as the tempo rises", () => {
    const slow = notesPerBar({ ...defaultSettings("jpop"), bpm: 80 });
    const fast = notesPerBar({ ...defaultSettings("jpop"), bpm: 180 });
    expect(fast.max).toBeLessThan(slow.max);
  });
});

describe("isValidSettings", () => {
  it("rejects malformed settings", () => {
    const ok = defaultSettings("trap");
    expect(isValidSettings(ok)).toBe(true);
    for (const bad of [
      null,
      "trap",
      { ...ok, preset: "polka" },
      { ...ok, scale: "lydian" },
      { ...ok, key: 12 },
      { ...ok, key: 1.5 },
      { ...ok, bpm: BPM_MIN - 1 },
      { ...ok, bpm: BPM_MAX + 1 },
    ]) {
      expect(isValidSettings(bad)).toBe(false);
    }
  });
});
