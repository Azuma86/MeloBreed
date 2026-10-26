import { describe, expect, it } from "vitest";
import { generateInitial } from "@/engine/generate";
import { render } from "@/engine/melody";
import { TICKS_PER_STEP, toMidiFile } from "@/engine/midi";
import { PRESET_IDS, defaultSettings } from "@/engine/presets";

interface Parsed {
  format: number;
  tracks: number;
  division: number;
  microsPerQuarter?: number;
  endOfTrackTick?: number;
  notes: { pitch: number; startTick: number; endTick: number }[];
}

/** A minimal SMF reader, enough to check what toMidiFile writes. */
function parseMidi(bytes: Uint8Array): Parsed {
  let pos = 0;
  const u8 = () => bytes[pos++] ?? Number.NaN;
  const u16 = () => (u8() << 8) | u8();
  const u32 = () => ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
  const text = (n: number) =>
    String.fromCharCode(...Array.from({ length: n }, u8));
  const vlq = () => {
    let value = 0;
    let byte: number;
    do {
      byte = u8();
      value = (value << 7) | (byte & 0x7f);
    } while (byte & 0x80);
    return value;
  };

  expect(text(4)).toBe("MThd");
  expect(u32()).toBe(6);
  const parsed: Parsed = {
    format: u16(),
    tracks: u16(),
    division: u16(),
    notes: [],
  };
  expect(text(4)).toBe("MTrk");
  const end = u32() + pos;
  const open = new Map<number, number>();
  let tick = 0;
  while (pos < end) {
    tick += vlq();
    const status = u8();
    if (status === 0xff) {
      const type = u8();
      const length = vlq();
      if (type === 0x2f) {
        parsed.endOfTrackTick = tick;
        pos += length;
      } else if (type === 0x51) {
        parsed.microsPerQuarter = (u8() << 16) | (u8() << 8) | u8();
      } else {
        pos += length;
      }
    } else if ((status & 0xf0) === 0x90) {
      const pitch = u8();
      u8();
      open.set(pitch, tick);
    } else if ((status & 0xf0) === 0x80) {
      const pitch = u8();
      u8();
      parsed.notes.push({
        pitch,
        startTick: open.get(pitch) ?? -1,
        endTick: tick,
      });
      open.delete(pitch);
    } else {
      throw new Error(`unexpected status ${status}`);
    }
  }
  expect(pos).toBe(bytes.length);
  expect(open.size).toBe(0);
  parsed.notes.sort((a, b) => a.startTick - b.startTick);
  return parsed;
}

describe("toMidiFile (AC8)", () => {
  it.each(PRESET_IDS)(
    "writes the %s melodies note for note at the tempo",
    (preset) => {
      const settings = defaultSettings(preset);
      for (const melody of generateInitial(settings, 4)) {
        const parsed = parseMidi(toMidiFile(melody, settings));
        expect(parsed.format).toBe(0);
        expect(parsed.tracks).toBe(1);
        expect(parsed.division).toBe(480);
        expect(parsed.endOfTrackTick).toBe(4 * 4 * 480);
        expect(parsed.microsPerQuarter).toBe(
          Math.round(60_000_000 / settings.bpm),
        );
        expect(parsed.notes).toEqual(
          render(melody, settings).map((n) => ({
            pitch: n.pitch,
            startTick: n.start * TICKS_PER_STEP,
            endTick: (n.start + n.duration) * TICKS_PER_STEP,
          })),
        );
      }
    },
  );

  it("closes a note before the next one on the same pitch starts", () => {
    const settings = defaultSettings("jpop");
    // Back-to-back repeated pitch: the note-off must come before the next note-on.
    const melody = {
      progression: 0,
      notes: Array.from({ length: 8 }, (_, i) => ({
        degree: 10,
        start: i * 4,
        duration: 4,
      })),
    };
    const parsed = parseMidi(toMidiFile(melody, settings));
    expect(parsed.notes).toHaveLength(8);
    expect(parsed.notes[1]).toEqual({
      pitch: parsed.notes[0]!.pitch,
      startTick: 4 * TICKS_PER_STEP,
      endTick: 8 * TICKS_PER_STEP,
    });
  });
});
