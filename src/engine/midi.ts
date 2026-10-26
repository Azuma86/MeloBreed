/** Standard MIDI File export (format 0, one track). Pure bytes, no I/O. */
import { render, type Melody } from "./melody";
import { STEPS, type Settings } from "./presets";

export const TICKS_PER_QUARTER = 480;
/** A 16th-note step in ticks. */
export const TICKS_PER_STEP = TICKS_PER_QUARTER / 4;

const ascii = (text: string): number[] =>
  [...text].map((c) => c.charCodeAt(0) & 0x7f);

const uint32 = (n: number): number[] => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];

const uint16 = (n: number): number[] => [(n >>> 8) & 0xff, n & 0xff];

/** MIDI variable-length quantity. */
function vlq(n: number): number[] {
  const bytes = [n & 0x7f];
  let rest = n >>> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return bytes;
}

interface Event {
  tick: number;
  /** Note-offs sort before note-ons at the same tick. */
  order: number;
  bytes: number[];
}

/**
 * The melody as a format-0 SMF at the session's tempo, quantized (no swing, so a DAW can apply
 * its own groove). 480 ticks per quarter note, 4/4, channel 1, exactly four bars long.
 */
export function toMidiFile(
  melody: Melody,
  settings: Settings,
  trackName = "MeloBreed",
): Uint8Array<ArrayBuffer> {
  const microsPerQuarter = Math.round(60_000_000 / settings.bpm);
  const events: Event[] = [];
  for (const n of render(melody, settings)) {
    const velocity = n.start % 4 === 0 ? 100 : 88;
    events.push(
      {
        tick: n.start * TICKS_PER_STEP,
        order: 1,
        bytes: [0x90, n.pitch, velocity],
      },
      {
        tick: (n.start + n.duration) * TICKS_PER_STEP,
        order: 0,
        bytes: [0x80, n.pitch, 0x40],
      },
    );
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const name = ascii(trackName);
  const track: number[] = [
    ...[0x00, 0xff, 0x03, ...vlq(name.length), ...name],
    ...[0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08],
    ...[0x00, 0xff, 0x51, 0x03, ...uint32(microsPerQuarter).slice(1)],
  ];
  let tick = 0;
  for (const e of events) {
    track.push(...vlq(e.tick - tick), ...e.bytes);
    tick = e.tick;
  }
  // End of track at the end of bar 4, so a DAW imports a full four-bar clip.
  track.push(
    ...vlq(Math.max(0, STEPS * TICKS_PER_STEP - tick)),
    0xff,
    0x2f,
    0x00,
  );

  return new Uint8Array([
    ...ascii("MThd"),
    ...uint32(6),
    ...uint16(0),
    ...uint16(1),
    ...uint16(TICKS_PER_QUARTER),
    ...ascii("MTrk"),
    ...uint32(track.length),
    ...track,
  ]);
}
