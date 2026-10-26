import { describe, expect, it } from "vitest";
import { defaultSettings } from "@/engine/presets";
import {
  MAX_GENERATIONS,
  breedNext,
  canGoBack,
  currentGeneration,
  deserialize,
  generationNumber,
  goBack,
  serialize,
  setSelection,
  startSession,
  type Session,
} from "@/engine/session";

const settings = defaultSettings("lofi");

/** Breeds through a list of selections, round-tripping through JSON before each step. */
function play(seed: number, selections: number[][]): Session {
  let session = startSession(settings, seed);
  for (const selected of selections) {
    session = deserialize(serialize(session))!;
    session = breedNext(setSelection(session, selected));
  }
  return deserialize(serialize(session))!;
}

describe("session", () => {
  it("replays identically from the same seed and selections (AC6)", () => {
    const steps = [[0], [1, 4], [2, 3, 7]];
    expect(play(5, steps)).toEqual(play(5, steps));
    expect(play(5, steps)).not.toEqual(play(6, steps));
  });

  it("breeds the same children whatever order parents were picked in", () => {
    const a = currentGeneration(play(9, [[4, 1]])).candidates;
    const b = currentGeneration(play(9, [[1, 4]])).candidates;
    expect(a).toEqual(b);
  });

  it("goes back with the selection intact and branches from there (AC4)", () => {
    const bred = play(2, [[0], [3]]);
    expect(generationNumber(bred)).toBe(3);

    const back = goBack(bred);
    expect(generationNumber(back)).toBe(2);
    expect(currentGeneration(back).selected).toEqual([3]);
    expect(currentGeneration(back)).toEqual(bred.generations[1]);

    // Picking differently replaces the generation that came after.
    const branched = breedNext(setSelection(back, [5]));
    expect(branched.generations).toHaveLength(3);
    expect(currentGeneration(branched)).toEqual(
      currentGeneration(play(2, [[0], [5]])),
    );
  });

  it("cannot go back from the first generation", () => {
    const session = startSession(settings, 1);
    expect(canGoBack(session)).toBe(false);
    expect(goBack(session)).toBe(session);
  });

  it("refuses to breed without a valid selection", () => {
    const session = startSession(settings, 1);
    expect(() => breedNext(session)).toThrow(RangeError);
    expect(() => breedNext(setSelection(session, [0, 1, 2, 3]))).toThrow(
      RangeError,
    );
  });

  it("caps the stored history", () => {
    let session = startSession(settings, 3);
    for (let i = 0; i < MAX_GENERATIONS + 2; i++) {
      session = breedNext(setSelection(session, [i % 8]));
    }
    expect(session.generations).toHaveLength(MAX_GENERATIONS);
    expect(session.cursor).toBe(MAX_GENERATIONS - 1);
  }, 60_000);
});

describe("deserialize", () => {
  const good = serialize(play(4, [[2]]));

  it("restores a saved session", () => {
    expect(deserialize(good)).toEqual(JSON.parse(good));
  });

  it.each([
    ["not JSON", "{"],
    ["wrong schema", good.replace('"schemaVersion":1', '"schemaVersion":2')],
    ["bad settings", good.replace('"bpm":80', '"bpm":999')],
    ["cursor out of range", good.replace('"cursor":1', '"cursor":5')],
  ])("discards %s", (_, text) => {
    expect(deserialize(text)).toBeUndefined();
  });

  it("discards a session with a melody that breaks the invariants", () => {
    const data = JSON.parse(good) as Session;
    const broken = {
      ...data,
      generations: data.generations.map((g, i) =>
        i === 0
          ? {
              ...g,
              candidates: g.candidates.map((m, k) =>
                k === 0
                  ? {
                      ...m,
                      notes: m.notes.map((n) => ({
                        ...n,
                        degree: n.degree + 40,
                      })),
                    }
                  : m,
              ),
            }
          : g,
      ),
    };
    expect(deserialize(JSON.stringify(broken))).toBeUndefined();
  });
});
