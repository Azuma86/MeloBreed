/**
 * Musically meaningful variation operators (after GenJam's transpose / invert / retrograde /
 * sequence mutations): pitch, rhythm and bar-level structure. Each works on the flat note list,
 * so its effect on the (pitch, start) pairs is local and countable. Results may break the
 * invariants; breed.ts validates and discards them rather than repairing.
 */
import type { Melody, Note } from "./melody";
import { sortNotes } from "./melody";
import { isChordTone, progressionRoots } from "./music";
import { STEPS, STEPS_PER_BAR, type Settings } from "./presets";
import { chance, pick, sign, weightedIndex } from "./random";
import type { Rng } from "./rng";

type Operator = (
  melody: Melody,
  settings: Settings,
  rng: Rng,
) => Melody | undefined;

const withNotes = (melody: Melody, notes: readonly Note[]): Melody => ({
  ...melody,
  notes,
});

const barOf = (n: Note): number => Math.floor(n.start / STEPS_PER_BAR);

const barIndices = (melody: Melody, bar: number): number[] =>
  melody.notes.flatMap((n, i) => (barOf(n) === bar ? [i] : []));

/** Bars that contain at least `min` notes. */
const barsWith = (melody: Melody, min: number): number[] =>
  [0, 1, 2, 3].filter((bar) => barIndices(melody, bar).length >= min);

/** Trims each note so it ends before the next starts and within the four bars. */
function tidy(notes: readonly Note[]): Note[] {
  const sorted = sortNotes(notes);
  return sorted.map((n, i) => {
    const limit = sorted[i + 1]?.start ?? STEPS;
    return { ...n, duration: Math.min(n.duration, limit - n.start) };
  });
}

/** Moves 1–3 notes by one or two scale steps; strong beats lean to chord tones. */
const nudgePitch: Operator = (melody, settings, rng) => {
  const roots = progressionRoots(settings.scale, melody.progression);
  const notes = [...melody.notes];
  const count = rng.int(1, 4);
  for (let k = 0; k < count; k++) {
    const i = rng.int(0, notes.length);
    const n = notes[i];
    if (n === undefined) continue;
    let options = [-2, -1, 1, 2];
    if (n.start % 4 === 0) {
      const onChord = options.filter((d) =>
        isChordTone(n.degree + d, settings.scale, roots[barOf(n)] ?? 0),
      );
      if (onChord.length > 0 && chance(rng, 0.75)) options = onChord;
    } else if (chance(rng, 0.7)) {
      options = [-1, 1];
    }
    notes[i] = { ...n, degree: n.degree + pick(rng, options) };
  }
  return withNotes(melody, notes);
};

/** Splits one note in two; the new note steps away or repeats. */
const splitNote: Operator = (melody, _settings, rng) => {
  const long = melody.notes.flatMap((n, i) => (n.duration >= 2 ? [i] : []));
  if (long.length === 0) return undefined;
  const i = pick(rng, long);
  const n = melody.notes[i];
  if (n === undefined) return undefined;
  const first =
    n.duration % 2 === 0 && chance(rng, 0.6)
      ? n.duration / 2
      : rng.int(1, n.duration);
  const notes = [...melody.notes];
  notes.splice(
    i,
    1,
    { ...n, duration: first },
    {
      degree: n.degree + pick(rng, [-1, 1, 0, 2, -2]),
      start: n.start + first,
      duration: n.duration - first,
    },
  );
  return withNotes(melody, notes);
};

/** Joins two back-to-back notes into the first one. */
const mergeNotes: Operator = (melody, _settings, rng) => {
  const joinable = melody.notes.flatMap((n, i) => {
    const next = melody.notes[i + 1];
    return next !== undefined && n.start + n.duration === next.start ? [i] : [];
  });
  if (joinable.length === 0) return undefined;
  const i = pick(rng, joinable);
  const n = melody.notes[i];
  const next = melody.notes[i + 1];
  if (n === undefined || next === undefined) return undefined;
  const notes = [...melody.notes];
  notes.splice(i, 2, { ...n, duration: n.duration + next.duration });
  return withNotes(melody, notes);
};

/** Moves one note's start a 16th earlier or later, keeping its end (syncopation). */
const shiftOnset: Operator = (melody, _settings, rng) => {
  if (melody.notes.length < 2) return undefined;
  const i = rng.int(1, melody.notes.length);
  const n = melody.notes[i];
  const previous = melody.notes[i - 1];
  if (n === undefined || previous === undefined) return undefined;
  const start = n.start + sign(rng);
  const end = n.start + n.duration;
  if (start <= previous.start || start >= end) return undefined;
  const notes = [...melody.notes];
  notes[i] = { ...n, start, duration: end - start };
  notes[i - 1] = {
    ...previous,
    duration: Math.min(previous.duration, start - previous.start),
  };
  return withNotes(melody, notes);
};

/** Moves one bar up or down by one or two scale steps (a sequence). */
const transposeBar: Operator = (melody, _settings, rng) => {
  const bars = barsWith(melody, 1);
  if (bars.length === 0) return undefined;
  const bar = pick(rng, bars);
  const delta = pick(rng, [-2, -1, 1, 2]);
  return withNotes(
    melody,
    melody.notes.map((n) =>
      barOf(n) === bar ? { ...n, degree: n.degree + delta } : n,
    ),
  );
};

/** Mirrors one bar's melodic contour around its first note. */
const invertBar: Operator = (melody, _settings, rng) => {
  const bars = barsWith(melody, 3);
  if (bars.length === 0) return undefined;
  const bar = pick(rng, bars);
  const pivot = melody.notes[barIndices(melody, bar)[0] ?? 0]?.degree ?? 0;
  return withNotes(
    melody,
    melody.notes.map((n) =>
      barOf(n) === bar ? { ...n, degree: 2 * pivot - n.degree } : n,
    ),
  );
};

/** Plays one bar's pitches backwards over the same rhythm. */
const retrogradeBar: Operator = (melody, _settings, rng) => {
  const bars = barsWith(melody, 3);
  if (bars.length === 0) return undefined;
  const indices = barIndices(melody, pick(rng, bars));
  const notes = [...melody.notes];
  indices.forEach((from, k) => {
    const source = melody.notes[indices[indices.length - 1 - k] ?? from];
    const target = notes[from];
    if (source && target) notes[from] = { ...target, degree: source.degree };
  });
  return withNotes(melody, notes);
};

/** Repeats one bar in another's place, sometimes with one note changed (keeps repetition). */
const copyBar: Operator = (melody, _settings, rng) => {
  const sources = barsWith(melody, 1);
  if (sources.length === 0) return undefined;
  const from = pick(rng, sources);
  const to = pick(
    rng,
    [0, 1, 2, 3].filter((b) => b !== from),
  );
  const offset = (to - from) * STEPS_PER_BAR;
  const toStart = to * STEPS_PER_BAR;
  const copied = melody.notes
    .filter((n) => barOf(n) === from)
    .map((n) => ({
      ...n,
      start: n.start + offset,
      duration: Math.min(
        n.duration,
        toStart + STEPS_PER_BAR - (n.start + offset),
      ),
    }));
  if (copied.length > 1 && chance(rng, 0.5)) {
    const k = rng.int(0, copied.length);
    const n = copied[k];
    if (n) copied[k] = { ...n, degree: n.degree + sign(rng) };
  }
  const kept = melody.notes
    .filter((n) => barOf(n) !== to)
    .map((n) =>
      n.start < toStart && n.start + n.duration > toStart
        ? { ...n, duration: toStart - n.start }
        : n,
    );
  return withNotes(melody, tidy([...kept, ...copied]));
};

/** Fills a melodic third with a passing tone. */
const insertPassingTone: Operator = (melody, _settings, rng) => {
  const gaps = melody.notes.flatMap((n, i) => {
    const next = melody.notes[i + 1];
    return next !== undefined &&
      Math.abs(next.degree - n.degree) === 2 &&
      n.duration >= 2
      ? [i]
      : [];
  });
  if (gaps.length === 0) return undefined;
  const i = pick(rng, gaps);
  const n = melody.notes[i];
  const next = melody.notes[i + 1];
  if (n === undefined || next === undefined) return undefined;
  const first = Math.floor(n.duration / 2);
  const notes = [...melody.notes];
  notes.splice(
    i,
    1,
    { ...n, duration: first },
    {
      degree: (n.degree + next.degree) / 2,
      start: n.start + first,
      duration: n.duration - first,
    },
  );
  return withNotes(melody, notes);
};

/** Removes a 16th-note ornament and lets the note before it ring on. */
const deleteOrnament: Operator = (melody, _settings, rng) => {
  const short = melody.notes.flatMap((n, i) =>
    i > 0 && i < melody.notes.length - 1 && n.duration === 1 ? [i] : [],
  );
  if (short.length === 0) return undefined;
  const i = pick(rng, short);
  const n = melody.notes[i];
  const previous = melody.notes[i - 1];
  if (n === undefined || previous === undefined) return undefined;
  const notes = [...melody.notes];
  notes.splice(i - 1, 2, {
    ...previous,
    duration: n.start + n.duration - previous.start,
  });
  return withNotes(melody, notes);
};

const OPERATORS: readonly { op: Operator; weight: number }[] = [
  { op: nudgePitch, weight: 5 },
  { op: splitNote, weight: 1.5 },
  { op: mergeNotes, weight: 1.5 },
  { op: shiftOnset, weight: 1.5 },
  { op: transposeBar, weight: 1.5 },
  { op: invertBar, weight: 0.8 },
  { op: retrogradeBar, weight: 0.8 },
  { op: copyBar, weight: 1 },
  { op: insertPassingTone, weight: 1 },
  { op: deleteOrnament, weight: 1 },
];
const WEIGHTS = OPERATORS.map((o) => o.weight);

/** Applies `count` randomly chosen operators in turn; inapplicable picks are retried. */
export function mutate(
  melody: Melody,
  settings: Settings,
  rng: Rng,
  count: number,
): Melody {
  let current = melody;
  for (
    let applied = 0, tries = 0;
    applied < count && tries < count * 4;
    tries++
  ) {
    const entry = OPERATORS[weightedIndex(rng, WEIGHTS)];
    const next = entry?.op(current, settings, rng);
    if (next !== undefined) {
      current = next;
      applied++;
    }
  }
  return current;
}

/**
 * Dominant parent plus donor bars: one or two bars come from the donor, the rest from the
 * dominant parent, whose progression the child inherits.
 */
export function crossover(dominant: Melody, donor: Melody, rng: Rng): Melody {
  const count = chance(rng, 0.7) ? 1 : 2;
  const bars = new Set<number>();
  while (bars.size < count) bars.add(rng.int(0, 4));
  const notes = [
    ...dominant.notes.filter((n) => !bars.has(barOf(n))),
    ...donor.notes.filter((n) => bars.has(barOf(n))),
  ];
  return withNotes(dominant, tidy(notes));
}

/**
 * Every single-note edit of a melody, in a fixed order: each note but the last moved by
 * +1, −1, +2 and −2 scale steps, then each duration shortened or lengthened by one step.
 * The last resort for filling a generation; see breed.ts for why it always suffices.
 */
export function singleEdits(melody: Melody): Melody[] {
  const edits: Melody[] = [];
  const { notes } = melody;
  const replace = (i: number, note: Note) =>
    withNotes(
      melody,
      notes.map((n, k) => (k === i ? note : n)),
    );
  for (const [i, n] of notes.entries()) {
    if (i === notes.length - 1) continue;
    for (const delta of [1, -1, 2, -2]) {
      edits.push(replace(i, { ...n, degree: n.degree + delta }));
    }
  }
  for (const [i, n] of notes.entries()) {
    const limit = notes[i + 1]?.start ?? STEPS;
    if (n.duration > 1)
      edits.push(replace(i, { ...n, duration: n.duration - 1 }));
    if (n.start + n.duration < limit) {
      edits.push(replace(i, { ...n, duration: n.duration + 1 }));
    }
  }
  return edits;
}
