/** Melody data, conversion to MIDI pitches, and the invariants every shown melody satisfies. */
import { degreeToPitch, progressionCount } from "./music";
import {
  MAX_FIRST_ONSET,
  MAX_NOTES,
  MIN_NOTES,
  PRESETS,
  STEPS,
  type Settings,
} from "./presets";

/** One note. `degree` is a scale degree (see music.ts); `start` and `duration` are 16th steps. */
export interface Note {
  degree: number;
  start: number;
  duration: number;
}

/** A four-bar monophonic melody. Notes are sorted by start and never overlap. */
export interface Melody {
  notes: readonly Note[];
  /** Index into the progressions of the scale's family; inherited, never mutated. */
  progression: number;
}

export interface PitchedNote {
  pitch: number;
  start: number;
  duration: number;
}

/** MIDI pitches for playback and export. Pure conversion: no correction happens here. */
export function render(melody: Melody, settings: Settings): PitchedNote[] {
  return melody.notes.map((n) => ({
    pitch: degreeToPitch(n.degree, settings.key, settings.scale),
    start: n.start,
    duration: n.duration,
  }));
}

/** Why a melody breaks the invariants, or `undefined` when it is valid. */
export function validationError(
  melody: Melody,
  settings: Settings,
): string | undefined {
  const { notes } = melody;
  if (notes.length < MIN_NOTES || notes.length > MAX_NOTES) {
    return `note count ${notes.length} outside [${MIN_NOTES}, ${MAX_NOTES}]`;
  }
  if (
    !Number.isInteger(melody.progression) ||
    melody.progression < 0 ||
    melody.progression >= progressionCount(settings.scale)
  ) {
    return `invalid progression ${melody.progression}`;
  }
  const { low, high } = PRESETS[settings.preset].range;
  let previousEnd = 0;
  for (const [i, n] of notes.entries()) {
    if (
      !Number.isInteger(n.degree) ||
      !Number.isInteger(n.start) ||
      !Number.isInteger(n.duration)
    ) {
      return `note ${i} is not on the grid`;
    }
    if (
      n.duration < 1 ||
      n.start < previousEnd ||
      n.start + n.duration > STEPS
    ) {
      return `note ${i} overlaps, is empty or runs past the last bar`;
    }
    const pitch = degreeToPitch(n.degree, settings.key, settings.scale);
    if (pitch < low || pitch > high) {
      return `note ${i} pitch ${pitch} outside [${low}, ${high}]`;
    }
    previousEnd = n.start + n.duration;
  }
  const first = notes[0];
  if (first === undefined || first.start > MAX_FIRST_ONSET) {
    return `first note starts after step ${MAX_FIRST_ONSET}`;
  }
  return undefined;
}

export const isValidMelody = (melody: Melody, settings: Settings): boolean =>
  validationError(melody, settings) === undefined;

/** Lowest and highest scale degree inside the preset's range. */
export function degreeRange(settings: Settings): { min: number; max: number } {
  const { low, high } = PRESETS[settings.preset].range;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let degree = -40; degree <= 60; degree++) {
    const pitch = degreeToPitch(degree, settings.key, settings.scale);
    if (pitch >= low && pitch <= high) {
      min = Math.min(min, degree);
      max = Math.max(max, degree);
    }
  }
  return { min, max };
}

/** Identity of a melody's notes, for spotting duplicates. The progression is not part of it. */
export const melodyKey = (melody: Melody): string =>
  melody.notes.map((n) => `${n.start},${n.degree},${n.duration}`).join(";");

/** Notes sorted by start; use after an edit that may reorder them. */
export const sortNotes = (notes: readonly Note[]): Note[] =>
  [...notes].sort((a, b) => a.start - b.start);
