/**
 * The first generation. Melodies are built from one-bar motifs placed in a four-bar form with
 * transformations over an implied chord progression (after GenJam's measure/phrase hierarchy),
 * then flattened to notes. Starting from music rather than noise matters: one listener can judge
 * only a few generations.
 */
import { distance, isTonic, quality, scoreKey } from "./critic";
import {
  degreeRange,
  isValidMelody,
  melodyKey,
  type Melody,
  type Note,
} from "./melody";
import {
  isChordTone,
  progressionCount,
  progressionRoots,
  scaleSize,
  type ScaleId,
} from "./music";
import {
  CANDIDATES,
  MAX_FIRST_ONSET,
  PRESETS,
  STEPS,
  STEPS_PER_BAR,
  TUNING,
  notesPerBar,
  type FormId,
  type Settings,
} from "./presets";
import { chance, pick, sign, weightedIndex, weightedSample } from "./random";
import { createRng, type Rng } from "./rng";
import { childSeed } from "./seed";

const CONTOURS = ["arch", "rising", "falling"] as const;
type Contour = (typeof CONTOURS)[number];
/** 0 = sparse, 1 = medium, 2 = dense within the preset's notes-per-bar range. */
type Density = 0 | 1 | 2;

interface BarPlan {
  motif: number;
  transform: "none" | "invert" | "retrograde";
  /** Sequence step: the motif moves by `seq` × a per-melody direction (±1 degree). */
  seq: number;
  /** Re-pitch the last notes, so a repeat is a variation. */
  vary: boolean;
}

const bar = (motif: number, more: Partial<BarPlan> = {}): BarPlan => ({
  motif,
  transform: "none",
  seq: 0,
  vary: false,
  ...more,
});

const FORMS: Record<FormId, readonly BarPlan[]> = {
  AABA: [bar(0), bar(0, { vary: true }), bar(1), bar(0, { vary: true })],
  ABAB: [bar(0), bar(1), bar(0), bar(1, { vary: true })],
  AAAB: [bar(0), bar(0, { seq: 1 }), bar(0, { seq: 2 }), bar(1)],
  ABAC: [bar(0), bar(1), bar(0), bar(2)],
  AAvBA: [bar(0), bar(0, { transform: "invert" }), bar(1), bar(0)],
};

interface Motif {
  onsets: number[];
  durations: number[];
  /** Scale-degree offsets from the motif's first note. */
  offsets: number[];
}

function makeMotif(
  settings: Settings,
  rng: Rng,
  density: Density,
  contour: Contour,
  opensMelody: boolean,
): Motif {
  const preset = PRESETS[settings.preset];
  const { min, max } = notesPerBar(settings);
  const lo = min + Math.floor(((max - min) * density) / 3);
  const hi = Math.max(lo, min + Math.floor(((max - min) * (density + 1)) / 3));
  const count = rng.int(lo, hi + 1);

  const onsets = weightedSample(rng, preset.stepWeights, count).sort(
    (a, b) => a - b,
  );
  if (opensMelody && (onsets[0] ?? 0) > MAX_FIRST_ONSET) {
    onsets[onsets.length - 1] = 0;
    onsets.sort((a, b) => a - b);
  }

  const durations = onsets.map((onset, i) => {
    const gap = (onsets[i + 1] ?? STEPS_PER_BAR) - onset;
    return gap >= 2 && chance(rng, preset.restChance) ? rng.int(1, gap) : gap;
  });

  // A walk toward the contour's target, mostly by step, turning back after leaps.
  const peak = rng.int(2, 5);
  const offsets = [0];
  let run = 1;
  let lastMove = 0;
  for (let j = 1; j < onsets.length; j++) {
    const t = j / (onsets.length - 1);
    const target =
      contour === "arch"
        ? peak * (t < 0.5 ? 2 * t : 2 * (1 - t))
        : contour === "rising"
          ? peak * t
          : -peak * t;
    const current = offsets[j - 1] ?? 0;
    let dir = target > current ? 1 : target < current ? -1 : sign(rng);
    if (!chance(rng, 0.75)) dir = -dir;
    let size: number;
    if (Math.abs(lastMove) >= 3 && chance(rng, 0.8)) {
      dir = -Math.sign(lastMove);
      size = 1;
    } else if (chance(rng, preset.leapChance)) {
      size = rng.int(3, 5);
    } else if (run < preset.maxRepeats && chance(rng, 0.12)) {
      size = 0;
    } else {
      size = chance(rng, 0.2) ? 2 : 1;
    }
    const move = dir * size;
    run = move === 0 ? run + 1 : 1;
    lastMove = move;
    offsets.push(current + move);
  }
  return { onsets, durations, offsets };
}

/** Nearest degree in range that sounds a tone of the chord on `root` (ties go down). */
function nearestChordTone(
  target: number,
  scale: ScaleId,
  root: number,
  range: { min: number; max: number },
): number {
  for (let d = 0; d <= range.max - range.min; d++) {
    for (const candidate of [target - d, target + d]) {
      if (
        candidate >= range.min &&
        candidate <= range.max &&
        isChordTone(candidate, scale, root)
      ) {
        return candidate;
      }
    }
  }
  return target;
}

/** Moves strong-beat notes that miss the chord by one step onto it. */
function snapStrongBeats(
  notes: Note[],
  scale: ScaleId,
  root: number,
  previous: number,
): void {
  let before = previous;
  for (const [i, n] of notes.entries()) {
    if (n.start % 4 === 0 && !isChordTone(n.degree, scale, root)) {
      const options = [n.degree - 1, n.degree + 1].filter((d) =>
        isChordTone(d, scale, root),
      );
      const best = options.sort(
        (a, b) => Math.abs(a - before) - Math.abs(b - before) || a - b,
      )[0];
      if (best !== undefined) notes[i] = { ...n, degree: best };
    }
    before = notes[i]?.degree ?? before;
  }
}

/** Ends the melody on a held tone of the tonic triad, at a varied position in the last bar. */
function cadence(
  notes: Note[],
  settings: Settings,
  range: { min: number; max: number },
  rng: Rng,
): Note[] {
  const positions = [48, 56, 46];
  const position = positions[weightedIndex(rng, [0.35, 0.45, 0.2])] ?? 56;
  const kept = notes
    .filter((n) => n.start < position)
    .map((n) => ({ ...n, duration: Math.min(n.duration, position - n.start) }));
  const previous = kept[kept.length - 1]?.degree ?? range.min;
  const wantTonic = chance(rng, 0.6);
  let final = previous;
  for (let d = 0; d <= range.max - range.min; d++) {
    const found = [previous - d, previous + d].find(
      (c) =>
        c >= range.min &&
        c <= range.max &&
        (wantTonic ? isTonic(c, settings) : isChordTone(c, settings.scale, 0)),
    );
    if (found !== undefined) {
      final = found;
      break;
    }
  }
  // Hold, then rest before the loop comes round; a whole held bar sounds stalled.
  const hold = Math.min(STEPS - position, pick(rng, [6, 8, 12]));
  return [...kept, { degree: final, start: position, duration: hold }];
}

/** Shifts the whole melody by octaves to fit the range, or `undefined` if it is too wide. */
function fitRange(
  notes: Note[],
  range: { min: number; max: number },
  octave: number,
): Note[] | undefined {
  const degrees = notes.map((n) => n.degree);
  const low = Math.min(...degrees);
  const high = Math.max(...degrees);
  for (const k of [0, -1, 1, -2, 2, -3, 3]) {
    const shift = k * octave;
    if (low + shift >= range.min && high + shift <= range.max) {
      return notes.map((n) => ({ ...n, degree: n.degree + shift }));
    }
  }
  return undefined;
}

interface Candidate {
  melody: Melody;
  /** Which (density, contour) cell it fills, for spreading the first generation. */
  cell: string;
}

function buildCandidate(settings: Settings, rng: Rng): Candidate | undefined {
  const preset = PRESETS[settings.preset];
  const range = degreeRange(settings);
  const form = FORMS[pick(rng, preset.forms)];
  const progression = rng.int(0, progressionCount(settings.scale));
  const roots = progressionRoots(settings.scale, progression);
  const density = rng.int(0, 3) as Density;
  const contour = pick(rng, CONTOURS);
  const seqDirection = sign(rng);
  const motifCount = Math.max(...form.map((b) => b.motif)) + 1;
  const motifs = Array.from({ length: motifCount }, (_, m) =>
    makeMotif(
      settings,
      rng,
      density,
      m === 0 ? contour : pick(rng, CONTOURS),
      m === 0,
    ),
  );

  const anchors = new Map<number, number>();
  const notes: Note[] = [];
  let previous = rng.int(range.min + 2, range.max - 1);
  for (const [index, plan] of form.entries()) {
    const motif = motifs[plan.motif];
    if (motif === undefined) return undefined;
    const root = roots[index] ?? 0;
    let anchor = anchors.get(plan.motif);
    if (anchor === undefined) {
      anchor = nearestChordTone(previous, settings.scale, root, range);
      anchors.set(plan.motif, anchor);
    }
    const shift = plan.seq * seqDirection;
    const n = motif.offsets.length;
    const offsets =
      plan.transform === "invert"
        ? motif.offsets.map((o) => -o)
        : plan.transform === "retrograde"
          ? motif.offsets.map((_, i) => motif.offsets[n - 1 - i] ?? 0)
          : motif.offsets;
    const barNotes: Note[] = motif.onsets.map((onset, i) => ({
      degree: (anchor ?? 0) + shift + (offsets[i] ?? 0),
      start: index * STEPS_PER_BAR + onset,
      duration: motif.durations[i] ?? 1,
    }));
    if (plan.vary) {
      const last = barNotes.length - 1;
      for (const i of chance(rng, 0.5) ? [last] : [last - 1, last]) {
        const note = barNotes[i];
        if (note) barNotes[i] = { ...note, degree: note.degree + sign(rng) };
      }
    }
    snapStrongBeats(barNotes, settings.scale, root, previous);
    notes.push(...barNotes);
    previous = barNotes[barNotes.length - 1]?.degree ?? previous;
  }

  const placed = fitRange(
    cadence(notes, settings, range, rng),
    range,
    scaleSize(settings.scale),
  );
  if (placed === undefined) return undefined;
  return {
    melody: { notes: placed, progression },
    cell: `${density}:${contour}`,
  };
}

interface Scored extends Candidate {
  quality: number;
  index: number;
}

/**
 * Greedy maximal marginal relevance: start from the best, then repeatedly take the candidate that
 * balances quality against distance to those already chosen, preferring unfilled cells.
 */
function selectSpread(pool: readonly Scored[], count: number): Scored[] {
  const chosen: Scored[] = [];
  const remaining = [...pool];
  while (chosen.length < count && remaining.length > 0) {
    let bestIndex = 0;
    let bestKey = Number.NEGATIVE_INFINITY;
    for (const [i, c] of remaining.entries()) {
      let score = c.quality;
      if (chosen.length > 0) {
        const nearest = Math.min(
          ...chosen.map((s) => distance(c.melody, s.melody)),
        );
        const unfilled = chosen.every((s) => s.cell !== c.cell);
        score =
          TUNING.qualityWeight * c.quality +
          TUNING.diversityWeight * nearest +
          (unfilled ? TUNING.coverageBonus : 0);
      }
      const key = scoreKey(score);
      if (key > bestKey) {
        bestKey = key;
        bestIndex = i;
      }
    }
    const [picked] = remaining.splice(bestIndex, 1);
    if (picked) chosen.push(picked);
  }
  return chosen;
}

/** Eight distinct, valid melodies for a new session. Deterministic for a given seed and settings. */
export function generateInitial(settings: Settings, seed: number): Melody[] {
  const pool: Scored[] = [];
  const seen = new Set<string>();
  let attempts = 0;
  const passing = () =>
    pool.filter((c) => c.quality >= TUNING.initialQualityFloor).length;
  while (attempts < TUNING.maxAttempts && passing() < TUNING.enoughPassing) {
    for (let b = 0; b < TUNING.batchSize; b++, attempts++) {
      const candidate = buildCandidate(
        settings,
        createRng(childSeed(seed, attempts)),
      );
      if (
        candidate === undefined ||
        !isValidMelody(candidate.melody, settings)
      ) {
        continue;
      }
      const key = melodyKey(candidate.melody);
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push({
        ...candidate,
        quality: quality(candidate.melody, settings),
        index: pool.length,
      });
    }
  }

  for (const floor of [TUNING.initialQualityFloor, 0.3, 0]) {
    const eligible = pool.filter((c) => c.quality >= floor);
    if (eligible.length >= CANDIDATES) {
      return selectSpread(eligible, CANDIDATES).map((c) => c.melody);
    }
  }
  throw new Error(
    `could not build ${CANDIDATES} melodies for ${JSON.stringify(settings)}`,
  );
}
