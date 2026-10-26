/**
 * Hand-written melody rules (no training data) and similarity measures.
 * Only basic arithmetic is used, so results match bit for bit across JavaScript engines.
 */
import type { Melody, Note } from "./melody";
import { degreeToPitch, isChordTone, mod, progressionRoots } from "./music";
import {
  BARS,
  PRESETS,
  STEPS,
  STEPS_PER_BAR,
  notesPerBar,
  type Settings,
} from "./presets";

// A note's identity for inheritance: (degree, start). Within a session the degree maps 1:1 to
// the pitch, so this is the spec's (pitch, start) pair.
const noteId = (n: Note): number => n.start * 1024 + (n.degree + 512);

/** How many (pitch, start) pairs two melodies share. */
export function sharedNoteCount(a: Melody, b: Melody): number {
  const ids = new Set(b.notes.map(noteId));
  return a.notes.reduce((count, n) => count + (ids.has(noteId(n)) ? 1 : 0), 0);
}

/** AC7: the child keeps at least half of its notes from the parent (`2·|C∩P| ≥ |C|`). */
export const sharesHalf = (child: Melody, parent: Melody): boolean =>
  2 * sharedNoteCount(child, parent) >= child.notes.length;

/** Share of the child's notes found in the parent, in [0, 1]. */
export const shareRatio = (child: Melody, parent: Melody): number =>
  child.notes.length === 0
    ? 0
    : sharedNoteCount(child, parent) / child.notes.length;

/** 1 − the best share with any parent: how far a child moved from where it came from. */
export const editAmount = (child: Melody, parents: readonly Melody[]): number =>
  1 - Math.max(0, ...parents.map((p) => shareRatio(child, p)));

/** A child must change at least one (pitch, start) pair or at least two durations. */
export function differsEnough(child: Melody, parent: Melody): boolean {
  const shared = sharedNoteCount(child, parent);
  if (shared !== child.notes.length || shared !== parent.notes.length) {
    return true;
  }
  const durations = new Map(parent.notes.map((n) => [noteId(n), n.duration]));
  const changed = child.notes.filter(
    (n) => durations.get(noteId(n)) !== n.duration,
  ).length;
  return changed >= 2;
}

/** Degree sounding at each step, or `undefined` during rests. */
function soundingDegrees(melody: Melody): (number | undefined)[] {
  const grid: (number | undefined)[] = new Array<number | undefined>(
    STEPS,
  ).fill(undefined);
  for (const n of melody.notes) {
    for (let s = n.start; s < n.start + n.duration && s < STEPS; s++) {
      grid[s] = n.degree;
    }
  }
  return grid;
}

/**
 * Perceptual distance in [0, 1]: half rhythm (onset Hamming distance over the union of onsets),
 * half pitch (mean scale-step gap, capped at 3, over steps where both melodies sound).
 */
export function distance(a: Melody, b: Melody): number {
  const onsetsA = new Set(a.notes.map((n) => n.start));
  const onsetsB = new Set(b.notes.map((n) => n.start));
  let union = 0;
  let differing = 0;
  for (let s = 0; s < STEPS; s++) {
    const inA = onsetsA.has(s);
    const inB = onsetsB.has(s);
    if (inA || inB) union++;
    if (inA !== inB) differing++;
  }
  const rhythm = union === 0 ? 0 : differing / union;

  const gridA = soundingDegrees(a);
  const gridB = soundingDegrees(b);
  let both = 0;
  let gap = 0;
  for (let s = 0; s < STEPS; s++) {
    const da = gridA[s];
    const db = gridB[s];
    if (da !== undefined && db !== undefined) {
      both++;
      gap += Math.min(Math.abs(da - db), 3) / 3;
    }
  }
  const pitch = both === 0 ? 1 : gap / both;
  return 0.5 * rhythm + 0.5 * pitch;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export const isTonic = (degree: number, settings: Settings): boolean =>
  mod(
    degreeToPitch(degree, settings.key, settings.scale) - settings.key,
    12,
  ) === 0;

/** Linear ramp: 0 at `from`, 1 at `to` (either direction). */
const ramp = (x: number, from: number, to: number): number =>
  clamp01((x - from) / (to - from));

export interface QualityBreakdown {
  steps: number;
  leaps: number;
  reversal: number;
  repeats: number;
  chordTones: number;
  cadence: number;
  density: number;
  span: number;
  rhythm: number;
  repetition: number;
}

const WEIGHTS: Record<keyof QualityBreakdown, number> = {
  steps: 2,
  leaps: 1.5,
  reversal: 1,
  repeats: 1,
  chordTones: 1.5,
  cadence: 1.5,
  density: 1,
  span: 0.5,
  rhythm: 0.5,
  repetition: 1.5,
};

/** Each rule's score in [0, 1]. */
export function qualityBreakdown(
  melody: Melody,
  settings: Settings,
): QualityBreakdown {
  const { notes } = melody;
  const preset = PRESETS[settings.preset];
  const pitches = notes.map((n) =>
    degreeToPitch(n.degree, settings.key, settings.scale),
  );
  const moves: number[] = [];
  for (let i = 1; i < notes.length; i++) {
    moves.push((notes[i]?.degree ?? 0) - (notes[i - 1]?.degree ?? 0));
  }
  const semitoneMoves: number[] = [];
  for (let i = 1; i < pitches.length; i++) {
    semitoneMoves.push(Math.abs((pitches[i] ?? 0) - (pitches[i - 1] ?? 0)));
  }
  const intervals = Math.max(1, moves.length);

  // Pitch proximity: most motion by scale step (counted in scale steps, so pentatonic is fair).
  const stepRatio = moves.filter((m) => Math.abs(m) === 1).length / intervals;
  const steps =
    stepRatio <= 0.85
      ? ramp(stepRatio, 0.15, 0.45)
      : 1 - 0.4 * ramp(stepRatio, 0.85, 1);

  // Leaps above a major sixth are rare in singable melodies; above an octave, very rare.
  const wide = semitoneMoves.filter((m) => m > 9).length;
  const huge = semitoneMoves.filter((m) => m > 12).length;
  const leaps = clamp01(1 - 0.25 * wide - 0.5 * huge);

  // Post-skip reversal: after a leap, the melody tends to turn back.
  let leapCount = 0;
  let reversed = 0;
  for (let i = 0; i + 1 < moves.length; i++) {
    const m = moves[i] ?? 0;
    const next = moves[i + 1] ?? 0;
    if (Math.abs(m) >= 3) {
      leapCount++;
      if (next !== 0 && Math.sign(next) !== Math.sign(m)) reversed++;
    }
  }
  const reversal = leapCount === 0 ? 1 : reversed / leapCount;

  // Repeated pitches: allowed up to the preset's run length, and not as the main motion.
  let longestRun = 1;
  let run = 1;
  for (const m of moves) {
    run = m === 0 ? run + 1 : 1;
    longestRun = Math.max(longestRun, run);
  }
  const repeatRatio = moves.filter((m) => m === 0).length / intervals;
  const repeats = clamp01(
    1 -
      0.3 * Math.max(0, longestRun - preset.maxRepeats) -
      ramp(repeatRatio, 0.4, 0.7),
  );

  // Strong beats on chord tones of the bar's implied chord.
  const roots = progressionRoots(settings.scale, melody.progression);
  const strong = notes.filter((n) => n.start % 4 === 0);
  const onChord = strong.filter((n) =>
    isChordTone(
      n.degree,
      settings.scale,
      roots[Math.floor(n.start / STEPS_PER_BAR)] ?? 0,
    ),
  ).length;
  const chordTones =
    strong.length === 0 ? 0.5 : ramp(onChord / strong.length, 0, 0.6);

  // Cadence: end on the tonic (or another tone of the tonic triad), and hold it.
  const last = notes[notes.length - 1];
  let cadence = 0;
  if (last !== undefined) {
    const tone = isTonic(last.degree, settings)
      ? 1
      : isChordTone(last.degree, settings.scale, 0)
        ? 0.8
        : 0.3;
    const hold = last.duration >= 4 ? 1 : last.duration >= 2 ? 0.8 : 0.5;
    cadence = tone * hold;
  }

  // Density within the preset's notes-per-bar range at this tempo.
  const perBar = notes.length / BARS;
  const allowed = notesPerBar(settings);
  const outside = Math.max(0, allowed.min - perBar, perBar - allowed.max);
  const density = clamp01(1 - 0.2 * outside);

  // Range: neither monotone nor sprawling.
  const spanSemitones =
    pitches.length === 0 ? 0 : Math.max(...pitches) - Math.min(...pitches);
  const span =
    spanSemitones < 5
      ? 0.5 + 0.1 * spanSemitones
      : clamp01(1 - 0.1 * Math.max(0, spanSemitones - 19));

  // Rhythmic variety: more than one note length.
  const rhythm = new Set(notes.map((n) => n.duration)).size >= 2 ? 1 : 0.6;

  // Repetition structure: some pair of bars shares most of its rhythm.
  const barOnsets = Array.from(
    { length: BARS },
    (_, bar) =>
      new Set(
        notes
          .filter((n) => Math.floor(n.start / STEPS_PER_BAR) === bar)
          .map((n) => n.start % STEPS_PER_BAR),
      ),
  );
  let bestJaccard = 0;
  for (let i = 0; i < BARS; i++) {
    for (let j = i + 1; j < BARS; j++) {
      const a = barOnsets[i] ?? new Set<number>();
      const b = barOnsets[j] ?? new Set<number>();
      const inter = [...a].filter((s) => b.has(s)).length;
      const uni = a.size + b.size - inter;
      if (uni > 0) bestJaccard = Math.max(bestJaccard, inter / uni);
    }
  }
  const repetition = 0.4 + 0.6 * ramp(bestJaccard, 0, 0.6);

  return {
    steps,
    leaps,
    reversal,
    repeats,
    chordTones,
    cadence,
    density,
    span,
    rhythm,
    repetition,
  };
}

/** Weighted mean of the rules, in [0, 1]. */
export function quality(melody: Melody, settings: Settings): number {
  const parts = qualityBreakdown(melody, settings);
  let sum = 0;
  let total = 0;
  for (const key of Object.keys(WEIGHTS) as (keyof QualityBreakdown)[]) {
    sum += WEIGHTS[key] * parts[key];
    total += WEIGHTS[key];
  }
  return sum / total;
}

/** Scores compared as integers, so ties break the same way on every engine. */
export const scoreKey = (x: number): number => Math.round(1e6 * x);
