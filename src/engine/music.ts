/** Pitch classes, scales and diatonic chords. Melodies store scale degrees, so they never leave the scale. */

export const SCALE_IDS = [
  "major",
  "minor",
  "dorian",
  "majorPentatonic",
  "minorPentatonic",
] as const;
export type ScaleId = (typeof SCALE_IDS)[number];

/** The seven-note scale a scale's chords are built on. */
export type ScaleFamily = "major" | "minor" | "dorian";

interface ScaleDef {
  /** Semitones above the tonic, ascending, starting at 0. */
  intervals: readonly number[];
  family: ScaleFamily;
}

const FAMILY_INTERVALS: Record<ScaleFamily, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

const SCALES: Record<ScaleId, ScaleDef> = {
  major: { intervals: FAMILY_INTERVALS.major, family: "major" },
  minor: { intervals: FAMILY_INTERVALS.minor, family: "minor" },
  dorian: { intervals: FAMILY_INTERVALS.dorian, family: "dorian" },
  majorPentatonic: { intervals: [0, 2, 4, 7, 9], family: "major" },
  minorPentatonic: { intervals: [0, 3, 5, 7, 10], family: "minor" },
};

export const isScaleId = (value: unknown): value is ScaleId =>
  typeof value === "string" && (SCALE_IDS as readonly string[]).includes(value);

export const scaleSize = (scale: ScaleId): number =>
  SCALES[scale].intervals.length;

export const scaleFamily = (scale: ScaleId): ScaleFamily =>
  SCALES[scale].family;

/** Modulo that is never negative (`-1 % 7` is `-1` in JavaScript). */
export const mod = (n: number, m: number): number => ((n % m) + m) % m;

const intervalAt = (intervals: readonly number[], index: number): number => {
  const value = intervals[index];
  if (value === undefined) {
    throw new RangeError(`no scale step at index ${index}`);
  }
  return value;
};

/** MIDI pitch of degree 0: the tonic in the octave starting at C3. */
export const tonicPitch = (key: number): number => 48 + key;

/** MIDI pitch of a scale degree. Degree 0 is `tonicPitch(key)`; degrees may be negative. */
export function degreeToPitch(
  degree: number,
  key: number,
  scale: ScaleId,
): number {
  const { intervals } = SCALES[scale];
  const n = intervals.length;
  const octave = Math.floor(degree / n);
  return tonicPitch(key) + 12 * octave + intervalAt(intervals, mod(degree, n));
}

/** Inverse of `degreeToPitch`; `undefined` when the pitch is not in the scale. */
export function pitchToDegree(
  pitch: number,
  key: number,
  scale: ScaleId,
): number | undefined {
  const { intervals } = SCALES[scale];
  const relative = pitch - tonicPitch(key);
  const octave = Math.floor(relative / 12);
  const step = intervals.indexOf(mod(relative, 12));
  return step === -1 ? undefined : octave * intervals.length + step;
}

/** Pitch classes (0 = the key's tonic) of the triad on `root`, a degree of the scale family. */
function triadPitchClasses(family: ScaleFamily, root: number): number[] {
  const intervals = FAMILY_INTERVALS[family];
  return [0, 2, 4].map((offset) =>
    intervalAt(intervals, mod(root + offset, 7)),
  );
}

/**
 * Pitch classes of the triad on `root` that are also in `scale`, relative to the tonic.
 * Pentatonic scales drop some chord tones, so the result can have fewer than three.
 */
export function chordTones(scale: ScaleId, root: number): number[] {
  const inScale = new Set(SCALES[scale].intervals);
  return triadPitchClasses(scaleFamily(scale), root).filter((pc) =>
    inScale.has(pc),
  );
}

/** Whether a degree sounds a tone of the triad on `root`. */
export function isChordTone(
  degree: number,
  scale: ScaleId,
  root: number,
): boolean {
  const { intervals } = SCALES[scale];
  const pc = intervalAt(intervals, mod(degree, intervals.length));
  return chordTones(scale, root).includes(pc);
}

/** Pitch classes of the scale, relative to the tonic. */
export const scalePitchClasses = (scale: ScaleId): readonly number[] =>
  SCALES[scale].intervals;

/**
 * Four-bar chord progressions, one chord per bar, as triad roots on the family's seven-note scale
 * (0 = I/i). Chosen by scale family so every chord keeps at least two tones in every scale of it.
 */
export const PROGRESSIONS: Record<ScaleFamily, readonly (readonly number[])[]> =
  {
    // I–V–vi–IV, IV–V–iii–vi, vi–IV–I–V, I–vi–IV–V, IV–I–V–vi
    major: [
      [0, 4, 5, 3],
      [3, 4, 2, 5],
      [5, 3, 0, 4],
      [0, 5, 3, 4],
      [3, 0, 4, 5],
    ],
    // i–VI–III–VII, i–iv–VI–v, i–VII–VI–VII, VI–VII–i–i, i–iv–VII–III
    minor: [
      [0, 5, 2, 6],
      [0, 3, 5, 4],
      [0, 6, 5, 6],
      [5, 6, 0, 0],
      [0, 3, 6, 2],
    ],
    // i–IV–i–IV, i–VII–IV–i, i–IV–VII–i
    dorian: [
      [0, 3, 0, 3],
      [0, 6, 3, 0],
      [0, 3, 6, 0],
    ],
  };

/** Chord roots of progression `index` for the scale's family. */
export function progressionRoots(
  scale: ScaleId,
  index: number,
): readonly number[] {
  const roots = PROGRESSIONS[scaleFamily(scale)][index];
  if (roots === undefined) {
    throw new RangeError(`no progression ${index} for scale ${scale}`);
  }
  return roots;
}

export const progressionCount = (scale: ScaleId): number =>
  PROGRESSIONS[scaleFamily(scale)].length;

/**
 * MIDI pitches of the full family triad on `root` (the chord a pad plays), in close position
 * with the root in the octave starting at C3.
 */
export function chordPitches(
  key: number,
  scale: ScaleId,
  root: number,
): number[] {
  const intervals = FAMILY_INTERVALS[scaleFamily(scale)];
  return [0, 2, 4].map((offset) => {
    const degree = mod(root, 7) + offset;
    return (
      tonicPitch(key) +
      12 * Math.floor(degree / 7) +
      intervalAt(intervals, mod(degree, 7))
    );
  });
}
