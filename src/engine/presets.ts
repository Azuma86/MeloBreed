/** Genre presets, session settings and every tuning value of the engine, kept in one place. */
import { isScaleId, type ScaleId } from "./music";

export const BARS = 4;
export const STEPS_PER_BAR = 16;
/** Length of a melody in 16th-note steps. */
export const STEPS = BARS * STEPS_PER_BAR;
/** Candidates shown per generation. */
export const CANDIDATES = 8;
export const MIN_NOTES = 8;
export const MAX_NOTES = 48;
/** The first note must start within the first two beats, so playback never opens on silence. */
export const MAX_FIRST_ONSET = 7;
export const BPM_MIN = 60;
export const BPM_MAX = 180;
export const MAX_PARENTS = 3;

export const PRESET_IDS = ["trap", "lofi", "jpop", "edm"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/** Four-bar forms the first generation is built from (see generate.ts). */
export const FORM_IDS = ["AABA", "ABAB", "AAAB", "ABAC", "AAvBA"] as const;
export type FormId = (typeof FORM_IDS)[number];

export interface Preset {
  id: PresetId;
  defaultBpm: number;
  defaultKey: number;
  defaultScale: ScaleId;
  /** Melody range in MIDI pitches. Spans at least 12 semitones (breed.ts relies on it). */
  range: { low: number; high: number };
  /** Density as notes per second, converted to notes per bar with the BPM. */
  notesPerSecond: { min: number; max: number };
  /** Relative chance of a note starting on each 16th step of a bar. */
  stepWeights: readonly number[];
  /** Chance that a generated note stops early and leaves a rest. */
  restChance: number;
  /** Chance that a generated melodic move is a leap of 3 or more scale steps. */
  leapChance: number;
  /** Most consecutive notes of one pitch the critic accepts without penalty. */
  maxRepeats: number;
  forms: readonly FormId[];
  /** Playback-only swing on 16th notes (Tone.js Transport.swing, 0–1). */
  swing: number;
}

export const PRESETS: Record<PresetId, Preset> = {
  trap: {
    id: "trap",
    defaultBpm: 140,
    defaultKey: 9,
    defaultScale: "minor",
    range: { low: 60, high: 79 },
    notesPerSecond: { min: 2.2, max: 4.5 },
    // Syncopated 16ths (3-3-2 feel): steps 3, 6, 11 and 14 carry weight.
    stepWeights: [
      1, 0.2, 0.4, 0.8, 0.6, 0.2, 0.8, 0.3, 0.9, 0.2, 0.4, 0.8, 0.6, 0.2, 0.8,
      0.3,
    ],
    restChance: 0.25,
    leapChance: 0.2,
    maxRepeats: 4,
    forms: ["AAAB", "AABA", "ABAB"],
    swing: 0,
  },
  lofi: {
    id: "lofi",
    defaultBpm: 80,
    defaultKey: 2,
    defaultScale: "dorian",
    range: { low: 57, high: 76 },
    notesPerSecond: { min: 1.2, max: 2.6 },
    // Mostly quarters and 8ths, few 16ths.
    stepWeights: [
      1, 0.05, 0.5, 0.15, 0.7, 0.05, 0.6, 0.15, 0.8, 0.05, 0.5, 0.15, 0.6, 0.05,
      0.5, 0.1,
    ],
    restChance: 0.4,
    leapChance: 0.25,
    maxRepeats: 3,
    forms: ["ABAB", "ABAC", "AABA"],
    swing: 0.3,
  },
  jpop: {
    id: "jpop",
    defaultBpm: 150,
    defaultKey: 0,
    defaultScale: "major",
    range: { low: 62, high: 83 },
    notesPerSecond: { min: 2.5, max: 5 },
    // Dense 8ths with 16th pickups.
    stepWeights: [
      1, 0.2, 0.8, 0.4, 0.9, 0.2, 0.8, 0.4, 0.9, 0.2, 0.8, 0.4, 0.9, 0.2, 0.8,
      0.5,
    ],
    restChance: 0.15,
    leapChance: 0.25,
    maxRepeats: 3,
    forms: ["AABA", "ABAB", "ABAC", "AAvBA"],
    swing: 0,
  },
  edm: {
    id: "edm",
    defaultBpm: 124,
    defaultKey: 5,
    defaultScale: "minor",
    range: { low: 60, high: 81 },
    notesPerSecond: { min: 2, max: 4.5 },
    // Off-beat 8ths lead, as in four-on-the-floor riffs.
    stepWeights: [
      0.8, 0.2, 1, 0.4, 0.6, 0.2, 1, 0.4, 0.8, 0.2, 1, 0.4, 0.6, 0.2, 1, 0.5,
    ],
    restChance: 0.3,
    leapChance: 0.2,
    maxRepeats: 4,
    forms: ["AAAB", "AABA", "AAvBA"],
    swing: 0,
  },
};

export const isPresetId = (value: unknown): value is PresetId =>
  typeof value === "string" &&
  (PRESET_IDS as readonly string[]).includes(value);

/** What the user picks before breeding; fixed for a whole session. */
export interface Settings {
  preset: PresetId;
  /** Pitch class of the tonic, 0 = C. */
  key: number;
  scale: ScaleId;
  bpm: number;
}

export function defaultSettings(preset: PresetId): Settings {
  const p = PRESETS[preset];
  return {
    preset,
    key: p.defaultKey,
    scale: p.defaultScale,
    bpm: p.defaultBpm,
  };
}

export function isValidSettings(value: unknown): value is Settings {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    isPresetId(s.preset) &&
    isScaleId(s.scale) &&
    Number.isInteger(s.key) &&
    (s.key as number) >= 0 &&
    (s.key as number) < 12 &&
    Number.isInteger(s.bpm) &&
    (s.bpm as number) >= BPM_MIN &&
    (s.bpm as number) <= BPM_MAX
  );
}

/** Notes per bar the density allows at this tempo, as an inclusive integer range. */
export function notesPerBar(settings: Settings): { min: number; max: number } {
  const { notesPerSecond } = PRESETS[settings.preset];
  const secondsPerBar = 240 / settings.bpm;
  const clamp = (n: number) => Math.min(10, Math.max(2, Math.round(n)));
  const min = clamp(notesPerSecond.min * secondsPerBar);
  return { min, max: Math.max(min, clamp(notesPerSecond.max * secondsPerBar)) };
}

/** Weights and thresholds for choosing which children to show (see breed.ts). */
export const TUNING = {
  /** MMR score = quality * qualityWeight + min distance to already chosen * diversityWeight. */
  qualityWeight: 0.35,
  diversityWeight: 0.65,
  /** Children whose quality is below min(qualityCap, parent quality - qualityDrop) are dropped. */
  qualityCap: 0.5,
  qualityDrop: 0.1,
  /** Edit amount (1 - best share with a parent) bounds of the near / mid / far tiers. */
  tierBounds: [0.2, 0.35] as const,
  /** Slots per tier when breeding from one parent: near, mid, far. */
  singleParentSlots: [3, 3, 2] as const,
  /** With 2–3 parents: children each parent must dominate, and crossovers required. */
  minPerParent: 2,
  minCrossovers: 3,
  /** Pool sizes: batches until enough children pass the gates, or the attempt cap. */
  batchSize: 32,
  enoughPassing: 24,
  maxAttempts: 256,
  /** Bonus for a first-generation candidate whose (density, contour) pair is not shown yet. */
  coverageBonus: 0.15,
  /** First-generation quality floor before it is relaxed. */
  initialQualityFloor: 0.5,
} as const;
