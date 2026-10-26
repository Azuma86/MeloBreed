import { describe, expect, it } from "vitest";
import {
  melodyKey,
  render,
  validationError,
  type Melody,
} from "@/engine/melody";
import { defaultSettings } from "@/engine/presets";

// C major, range 62–83 (D4–B5): degrees 8..20 are in range.
const settings = {
  ...defaultSettings("jpop"),
  key: 0,
  scale: "major" as const,
};

/** Eight half-bar notes climbing from degree 8. */
const valid = (): Melody => ({
  progression: 0,
  notes: Array.from({ length: 8 }, (_, i) => ({
    degree: 8 + i,
    start: i * 8,
    duration: 8,
  })),
});

const withNote = (index: number, patch: Partial<Melody["notes"][number]>) => {
  const m = valid();
  return {
    ...m,
    notes: m.notes.map((n, i) => (i === index ? { ...n, ...patch } : n)),
  };
};

describe("render", () => {
  it("converts degrees to MIDI pitches and keeps timing", () => {
    expect(render(valid(), settings).slice(0, 2)).toEqual([
      { pitch: 62, start: 0, duration: 8 },
      { pitch: 64, start: 8, duration: 8 },
    ]);
  });
});

describe("validationError", () => {
  it("accepts a valid melody", () => {
    expect(validationError(valid(), settings)).toBeUndefined();
  });

  it.each([
    ["too few notes", { ...valid(), notes: valid().notes.slice(0, 7) }],
    ["unknown progression", { ...valid(), progression: 99 }],
    ["off-grid start", withNote(2, { start: 16.5 })],
    ["empty note", withNote(2, { duration: 0 })],
    ["overlap", withNote(2, { duration: 9 })],
    ["past the last bar", withNote(7, { duration: 9 })],
    ["pitch above range", withNote(7, { degree: 21 })],
    ["pitch below range", withNote(0, { degree: 7 })],
    [
      "late first note",
      {
        ...valid(),
        notes: valid().notes.map((n, i) => ({
          ...n,
          start: 8 + i * 7,
          duration: 7,
        })),
      },
    ],
  ])("rejects %s", (_, melody) => {
    expect(validationError(melody as Melody, settings)).toBeDefined();
  });
});

describe("melodyKey", () => {
  it("ignores the progression and tells different notes apart", () => {
    expect(melodyKey(valid())).toBe(melodyKey({ ...valid(), progression: 1 }));
    expect(melodyKey(valid())).not.toBe(melodyKey(withNote(3, { degree: 9 })));
  });
});
