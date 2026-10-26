/**
 * A breeding session: settings plus the history of generations. Sessions store the melodies
 * themselves rather than replaying seeds, so retuning the engine never changes saved melodies.
 */
import { breed } from "./breed";
import { generateInitial } from "./generate";
import { isValidMelody, type Melody, type Note } from "./melody";
import { CANDIDATES, isValidSettings, type Settings } from "./presets";
import { deriveSeed, isValidSelection } from "./seed";

export const SCHEMA_VERSION = 1;
/** Bump when generation or breeding changes, to tell sessions bred by older engines apart. */
export const ENGINE_VERSION = "0.1.0";
/** Oldest generations are dropped beyond this, to bound storage. */
export const MAX_GENERATIONS = 100;

export interface Generation {
  seed: number;
  candidates: readonly Melody[];
  /** Candidate indices picked as parents, in the order the user picked them. */
  selected: readonly number[];
}

export interface Session {
  schemaVersion: typeof SCHEMA_VERSION;
  engineVersion: string;
  settings: Settings;
  generations: readonly Generation[];
  /** Index of the generation on screen; "back" moves it, breeding truncates what follows. */
  cursor: number;
}

export function startSession(settings: Settings, seed: number): Session {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    settings,
    generations: [
      { seed, candidates: generateInitial(settings, seed), selected: [] },
    ],
    cursor: 0,
  };
}

export function currentGeneration(session: Session): Generation {
  const generation = session.generations[session.cursor];
  if (generation === undefined) throw new RangeError("cursor out of range");
  return generation;
}

/** 1-based number of the generation on screen, as shown to the user. */
export const generationNumber = (session: Session): number =>
  session.cursor + 1;

/** Replaces the selection on screen (no validation of size: the UI caps it at 3). */
export function setSelection(
  session: Session,
  selected: readonly number[],
): Session {
  return {
    ...session,
    generations: session.generations.map((g, i) =>
      i === session.cursor ? { ...g, selected } : g,
    ),
  };
}

/** Breeds the next generation from the current selection, dropping any generations after it. */
export function breedNext(session: Session): Session {
  const current = currentGeneration(session);
  if (!isValidSelection(current.selected)) {
    throw new RangeError("select 1–3 candidates before breeding");
  }
  const indices = [...current.selected].sort((a, b) => a - b);
  const parents = indices.map((i) => {
    const parent = current.candidates[i];
    if (parent === undefined) throw new RangeError(`no candidate ${i}`);
    return parent;
  });
  const seed = deriveSeed(current.seed, indices);
  const next: Generation = {
    seed,
    candidates: breed(parents, session.settings, seed),
    selected: [],
  };
  const kept = [...session.generations.slice(0, session.cursor + 1), next];
  const dropped = Math.max(0, kept.length - MAX_GENERATIONS);
  return {
    ...session,
    generations: kept.slice(dropped),
    cursor: kept.length - 1 - dropped,
  };
}

export const canGoBack = (session: Session): boolean => session.cursor > 0;

/** Shows the previous generation with its selection intact. */
export function goBack(session: Session): Session {
  return canGoBack(session)
    ? { ...session, cursor: session.cursor - 1 }
    : session;
}

export const serialize = (session: Session): string => JSON.stringify(session);

const isNote = (value: unknown): value is Note => {
  if (typeof value !== "object" || value === null) return false;
  const n = value as Record<string, unknown>;
  return (
    typeof n.degree === "number" &&
    typeof n.start === "number" &&
    typeof n.duration === "number"
  );
};

const isMelodyShape = (value: unknown): value is Melody => {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.progression === "number" &&
    Array.isArray(m.notes) &&
    m.notes.every(isNote)
  );
};

/**
 * Restores a saved session, or `undefined` if anything in it is malformed or breaks the
 * invariants (a stale or tampered save is discarded, never half-loaded).
 */
export function deserialize(text: string): Session | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof data !== "object" || data === null) return undefined;
  const s = data as Record<string, unknown>;
  if (
    s.schemaVersion !== SCHEMA_VERSION ||
    typeof s.engineVersion !== "string" ||
    !isValidSettings(s.settings) ||
    !Array.isArray(s.generations) ||
    s.generations.length === 0 ||
    s.generations.length > MAX_GENERATIONS ||
    !Number.isInteger(s.cursor) ||
    (s.cursor as number) < 0 ||
    (s.cursor as number) >= s.generations.length
  ) {
    return undefined;
  }
  const settings = s.settings;
  for (const g of s.generations as unknown[]) {
    if (typeof g !== "object" || g === null) return undefined;
    const gen = g as Record<string, unknown>;
    if (
      !Number.isInteger(gen.seed) ||
      (gen.seed as number) < 0 ||
      (gen.seed as number) > 0xffffffff ||
      !Array.isArray(gen.candidates) ||
      gen.candidates.length !== CANDIDATES ||
      !gen.candidates.every(
        (m) => isMelodyShape(m) && isValidMelody(m, settings),
      ) ||
      !Array.isArray(gen.selected) ||
      (gen.selected.length > 0 && !isValidSelection(gen.selected as number[]))
    ) {
      return undefined;
    }
  }
  return data as Session;
}
