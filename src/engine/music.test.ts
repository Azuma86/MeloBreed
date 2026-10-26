import { describe, expect, it } from "vitest";
import {
  PROGRESSIONS,
  SCALE_IDS,
  chordPitches,
  chordTones,
  degreeToPitch,
  isChordTone,
  mod,
  pitchToDegree,
  scaleFamily,
} from "@/engine/music";

describe("mod", () => {
  it("is never negative", () => {
    expect(mod(-1, 7)).toBe(6);
    expect(mod(-7, 7)).toBe(0);
    expect(mod(8, 7)).toBe(1);
  });
});

describe("degreeToPitch", () => {
  it("places degree 0 on the tonic in the octave from C3", () => {
    expect(degreeToPitch(0, 0, "major")).toBe(48);
    expect(degreeToPitch(7, 0, "major")).toBe(60);
    expect(degreeToPitch(2, 0, "major")).toBe(52);
    expect(degreeToPitch(-1, 0, "major")).toBe(47);
    expect(degreeToPitch(0, 9, "minor")).toBe(57);
    expect(degreeToPitch(5, 0, "minorPentatonic")).toBe(60);
    expect(degreeToPitch(-1, 0, "minorPentatonic")).toBe(46);
  });

  it("round-trips through pitchToDegree for every key and scale", () => {
    for (const scale of SCALE_IDS) {
      for (let key = 0; key < 12; key++) {
        for (let degree = -10; degree <= 15; degree++) {
          const pitch = degreeToPitch(degree, key, scale);
          expect(pitchToDegree(pitch, key, scale)).toBe(degree);
        }
      }
    }
  });

  it("is strictly increasing in the degree", () => {
    for (const scale of SCALE_IDS) {
      for (let degree = -10; degree < 15; degree++) {
        expect(degreeToPitch(degree + 1, 3, scale)).toBeGreaterThan(
          degreeToPitch(degree, 3, scale),
        );
      }
    }
  });
});

describe("pitchToDegree", () => {
  it("rejects pitches outside the scale", () => {
    expect(pitchToDegree(49, 0, "major")).toBeUndefined();
    expect(pitchToDegree(50, 0, "minorPentatonic")).toBeUndefined();
  });
});

describe("chords", () => {
  it("keeps at least two chord tones for every progression chord in every scale", () => {
    for (const scale of SCALE_IDS) {
      for (const progression of PROGRESSIONS[scaleFamily(scale)]) {
        for (const root of progression) {
          expect(chordTones(scale, root).length).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("recognises chord tones by degree in any octave", () => {
    expect(isChordTone(0, "major", 0)).toBe(true);
    expect(isChordTone(7, "major", 0)).toBe(true);
    expect(isChordTone(-3, "major", 0)).toBe(true); // G below the tonic
    expect(isChordTone(1, "major", 0)).toBe(false);
    expect(isChordTone(4, "major", 4)).toBe(true); // G in V
    expect(isChordTone(3, "majorPentatonic", 4)).toBe(true); // G in V
  });

  it("builds pad chords in close position above the root", () => {
    expect(chordPitches(0, "major", 0)).toEqual([48, 52, 55]);
    expect(chordPitches(9, "minor", 5)).toEqual([65, 69, 72]);
    expect(chordPitches(0, "majorPentatonic", 4)).toEqual([55, 59, 62]);
  });
});
