/**
 * Breeding: a pool of children from the chosen parents, hard gates, then a spread of eight.
 * Showing a filtered, diverse subset instead of raw offspring is how interactive evolution
 * keeps listener fatigue down (Takagi 2001; Quiroz et al. 2009).
 *
 * Why eight always come out: when the pool falls short, `singleEdits` of a parent fills the
 * rest. Every valid melody has at least MIN_NOTES (8) notes and the preset range spans at least
 * 12 semitones, so each note but the last has at least two in-range pitch edits: at least 14
 * distinct edits, each sharing 7/8 of its notes with the parent.
 */
import {
  differsEnough,
  distance,
  editAmount,
  quality,
  scoreKey,
  sharesHalf,
} from "./critic";
import { isValidMelody, melodyKey, type Melody } from "./melody";
import { crossover, mutate, singleEdits } from "./operators";
import { CANDIDATES, TUNING, type Settings } from "./presets";
import { chance, pick } from "./random";
import { createRng } from "./rng";
import { childSeed } from "./seed";

interface Child {
  melody: Melody;
  /** Index of the parent the child is mostly made of. */
  dominant: number;
  crossover: boolean;
  quality: number;
  edit: number;
  index: number;
}

/** Hard gates every shown child passes (AC5, AC7, distinctness, quality floor). */
function passesGates(
  melody: Melody,
  dominant: Melody,
  parents: readonly Melody[],
  settings: Settings,
  floor: number,
): number | undefined {
  if (!isValidMelody(melody, settings)) return undefined;
  const n = melody.notes.length;
  const base = dominant.notes.length;
  // Within ±25% of the dominant parent's note count.
  if (4 * n < 3 * base || 4 * n > 5 * base) return undefined;
  if (!parents.some((p) => sharesHalf(melody, p))) return undefined;
  if (!parents.every((p) => differsEnough(melody, p))) return undefined;
  const q = quality(melody, settings);
  return q >= floor ? q : undefined;
}

/** Greedy maximal marginal relevance over `candidates`, given the children already chosen. */
function pickSpread(
  candidates: readonly Child[],
  count: number,
  chosen: readonly Child[],
): Child[] {
  const picked: Child[] = [];
  const remaining = [...candidates];
  while (picked.length < count && remaining.length > 0) {
    const context = [...chosen, ...picked];
    let bestIndex = 0;
    let bestKey = Number.NEGATIVE_INFINITY;
    for (const [i, c] of remaining.entries()) {
      const score =
        context.length === 0
          ? c.quality
          : TUNING.qualityWeight * c.quality +
            TUNING.diversityWeight *
              Math.min(...context.map((s) => distance(c.melody, s.melody)));
      const key = scoreKey(score);
      if (key > bestKey) {
        bestKey = key;
        bestIndex = i;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    if (next) picked.push(next);
  }
  return picked;
}

const tierOf = (edit: number): number =>
  edit < TUNING.tierBounds[0] ? 0 : edit < TUNING.tierBounds[1] ? 1 : 2;

/** One parent: near / mid / far tiers, borrowing from the next tier when one runs short. */
function selectFromOne(pool: readonly Child[]): Child[] {
  const chosen: Child[] = [];
  const wanted: number[] = [...TUNING.singleParentSlots];
  for (let tier = 0; tier < 3; tier++) {
    const inTier = pool.filter(
      (c) => tierOf(c.edit) === tier && !chosen.includes(c),
    );
    const picked = pickSpread(inTier, wanted[tier] ?? 0, chosen);
    chosen.push(...picked);
    const shortfall = (wanted[tier] ?? 0) - picked.length;
    if (tier < 2) wanted[tier + 1] = (wanted[tier + 1] ?? 0) + shortfall;
  }
  const rest = pool.filter((c) => !chosen.includes(c));
  chosen.push(...pickSpread(rest, CANDIDATES - chosen.length, chosen));
  return chosen;
}

/** Several parents: each dominates at least two children, and at least three are crossovers. */
function selectFromMany(pool: readonly Child[], parentCount: number): Child[] {
  const chosen: Child[] = [];
  const crossovers = () => chosen.filter((c) => c.crossover).length;
  const available = (filter: (c: Child) => boolean) =>
    pool.filter((c) => filter(c) && !chosen.includes(c));

  for (let p = 0; p < parentCount; p++) {
    for (let k = 0; k < TUNING.minPerParent; k++) {
      const preferCross = crossovers() < TUNING.minCrossovers;
      const crossPool = available((c) => c.dominant === p && c.crossover);
      const own =
        preferCross && crossPool.length > 0
          ? crossPool
          : available((c) => c.dominant === p);
      chosen.push(...pickSpread(own, 1, chosen));
    }
  }
  while (crossovers() < TUNING.minCrossovers) {
    const picked = pickSpread(
      available((c) => c.crossover),
      1,
      chosen,
    );
    if (picked.length === 0) break;
    chosen.push(...picked);
  }
  chosen.push(
    ...pickSpread(
      available(() => true),
      CANDIDATES - chosen.length,
      chosen,
    ),
  );
  return chosen.slice(0, CANDIDATES);
}

/**
 * Eight children of 1–3 parents (in selection order). Deterministic for the parents, settings and
 * seed; each pool child has its own RNG, so one child's retries never shift another.
 */
export const breed = (
  parents: readonly Melody[],
  settings: Settings,
  seed: number,
): Melody[] => breedWithOrigins(parents, settings, seed).map((c) => c.melody);

/** `breed`, also telling which parent (index into `parents`) each child is mostly made of. */
export function breedWithOrigins(
  parents: readonly Melody[],
  settings: Settings,
  seed: number,
): { melody: Melody; dominant: number }[] {
  if (parents.length === 0) throw new RangeError("breed needs a parent");
  const parentQuality = parents.map((p) => quality(p, settings));
  const seen = new Set(parents.map(melodyKey));
  const pool: Child[] = [];

  for (
    let attempt = 0;
    attempt < TUNING.maxAttempts && pool.length < TUNING.enoughPassing;
    attempt++
  ) {
    const rng = createRng(childSeed(seed, attempt));
    const dominant = attempt % parents.length;
    const parent = parents[dominant];
    if (parent === undefined) continue;
    const isCrossover = parents.length > 1 && chance(rng, 0.6);
    let melody: Melody;
    if (isCrossover) {
      const donor = pick(
        rng,
        parents.filter((_, i) => i !== dominant),
      );
      melody = crossover(parent, donor, rng);
      if (chance(rng, 0.5)) melody = mutate(melody, settings, rng, 1);
    } else {
      melody = mutate(parent, settings, rng, pick(rng, [1, 1, 2, 2, 3]));
    }
    const key = melodyKey(melody);
    if (seen.has(key)) continue;
    const floor = Math.min(
      TUNING.qualityCap,
      (parentQuality[dominant] ?? 0) - TUNING.qualityDrop,
    );
    const q = passesGates(melody, parent, parents, settings, floor);
    if (q === undefined) continue;
    seen.add(key);
    pool.push({
      melody,
      dominant,
      crossover: isCrossover,
      quality: q,
      edit: editAmount(melody, parents),
      index: pool.length,
    });
  }

  const chosen =
    parents.length === 1
      ? selectFromOne(pool)
      : selectFromMany(pool, parents.length);

  if (chosen.length < CANDIDATES) {
    const taken = new Set(chosen.map((c) => melodyKey(c.melody)));
    const fallback: Child[] = [];
    parents.forEach((parent, dominant) => {
      for (const melody of singleEdits(parent)) {
        const key = melodyKey(melody);
        if (taken.has(key) || seen.has(key)) continue;
        if (passesGates(melody, parent, parents, settings, 0) === undefined) {
          continue;
        }
        taken.add(key);
        fallback.push({
          melody,
          dominant,
          crossover: false,
          quality: quality(melody, settings),
          edit: editAmount(melody, parents),
          index: pool.length + fallback.length,
        });
      }
    });
    chosen.push(...pickSpread(fallback, CANDIDATES - chosen.length, chosen));
  }

  if (chosen.length < CANDIDATES) {
    throw new Error(
      `breed produced ${chosen.length} of ${CANDIDATES} children`,
    );
  }
  return chosen.map(({ melody, dominant }) => ({ melody, dominant }));
}
