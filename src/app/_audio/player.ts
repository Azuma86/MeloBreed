/**
 * Browser-only playback with Tone.js. Tone is loaded with a dynamic import (preloaded on mount)
 * so `Tone.start()` can run synchronously inside the tap that starts playback, which iOS needs.
 * Notes go through Transport + Part: that is what makes swing apply and stop() cut cleanly.
 */
import type * as ToneLib from "tone";
import { render, type Melody } from "@/engine/melody";
import { chordPitches, progressionRoots } from "@/engine/music";
import {
  BARS,
  PRESETS,
  STEPS_PER_BAR,
  type PresetId,
  type Settings,
} from "@/engine/presets";

type Tone = typeof ToneLib;

interface Voices {
  lead: ToneLib.Synth | ToneLib.MonoSynth;
  pad: ToneLib.PolySynth;
}

let loading: Promise<Tone> | undefined;
let tone: Tone | undefined;
const voices = new Map<PresetId, Voices>();
let parts: ToneLib.Part[] = [];
/** Bumped on every play/stop, so callbacks from an older playback do nothing. */
let token = 0;

/** Starts loading Tone.js in the background. */
export function preloadAudio(): Promise<Tone> {
  if (!loading) {
    (window as { TONE_SILENCE_LOGGING?: boolean }).TONE_SILENCE_LOGGING = true;
    loading = import("tone").then(
      (module) => {
        tone = module;
        return module;
      },
      (error: unknown) => {
        // Let the next tap try again instead of keeping the failed load forever.
        loading = undefined;
        throw error;
      },
    );
  }
  return loading;
}

/** Must run inside the user's tap: resumes the AudioContext and unmutes iOS where possible. */
function unlock(T: Tone): void {
  const session = (navigator as Navigator & { audioSession?: { type: string } })
    .audioSession;
  if (session) {
    try {
      // iOS 17+: play even with the silent switch on.
      session.type = "playback";
    } catch {
      // Not supported; the UI shows a silent-mode hint instead.
    }
  }
  void T.start();
}

/** One sound per genre, the same for all eight candidates so they compare fairly. */
function voicesFor(T: Tone, preset: PresetId): Voices {
  const existing = voices.get(preset);
  if (existing) return existing;
  const reverb = new T.Freeverb({ roomSize: 0.6, dampening: 3000, wet: 0.12 });
  reverb.toDestination();
  let lead: Voices["lead"];
  switch (preset) {
    case "trap":
      // Bell-like pluck.
      lead = new T.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.005, decay: 0.35, sustain: 0.15, release: 0.5 },
      });
      break;
    case "lofi":
      // Soft keys.
      lead = new T.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 0.01, decay: 0.5, sustain: 0.35, release: 0.9 },
      });
      break;
    case "jpop":
      lead = new T.MonoSynth({
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 },
        filterEnvelope: {
          attack: 0.01,
          decay: 0.2,
          sustain: 0.5,
          release: 0.3,
          baseFrequency: 900,
          octaves: 2.5,
        },
      });
      break;
    case "edm":
      lead = new T.MonoSynth({
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.005, decay: 0.18, sustain: 0.15, release: 0.25 },
        filterEnvelope: {
          attack: 0.005,
          decay: 0.15,
          sustain: 0.2,
          release: 0.25,
          baseFrequency: 600,
          octaves: 3,
        },
      });
      break;
  }
  lead.volume.value = -8;
  lead.connect(reverb);
  const pad = new T.PolySynth(T.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 1 },
  });
  pad.volume.value = -22;
  pad.connect(reverb);
  const created = { lead, pad };
  voices.set(preset, created);
  return created;
}

/** "bars:beats:sixteenths" for a 16th-note step. */
const position = (step: number): string =>
  `${Math.floor(step / STEPS_PER_BAR)}:${Math.floor((step % STEPS_PER_BAR) / 4)}:${step % 4}`;

function silence(T: Tone): void {
  const transport = T.getTransport();
  transport.stop();
  transport.cancel(0);
  for (const part of parts) part.dispose();
  parts = [];
  for (const v of voices.values()) {
    v.lead.triggerRelease();
    v.pad.releaseAll();
  }
}

/** Stops whatever is playing. */
export function stopAudio(): void {
  token++;
  if (tone) silence(tone);
}

function schedule(
  T: Tone,
  melody: Melody,
  settings: Settings,
  chords: boolean,
  onEnd: () => void,
): void {
  silence(T);
  const current = token;
  const transport = T.getTransport();
  transport.bpm.value = settings.bpm;
  transport.swing = PRESETS[settings.preset].swing;
  transport.swingSubdivision = "16n";
  const { lead, pad } = voicesFor(T, settings.preset);
  const stepSeconds = 60 / settings.bpm / 4;
  const midi = (pitch: number) => T.Frequency(pitch, "midi").toFrequency();

  const notes = new T.Part<{
    time: string;
    pitch: number;
    seconds: number;
    velocity: number;
  }>(
    (time, n) =>
      lead.triggerAttackRelease(midi(n.pitch), n.seconds, time, n.velocity),
    render(melody, settings).map((n) => ({
      time: position(n.start),
      pitch: n.pitch,
      seconds: n.duration * stepSeconds * 0.95,
      velocity: n.start % 4 === 0 ? 0.9 : 0.72,
    })),
  ).start(0);
  parts.push(notes);

  if (chords) {
    const roots = progressionRoots(settings.scale, melody.progression);
    const pads = new T.Part<{ time: string; pitches: number[] }>(
      (time, c) =>
        pad.triggerAttackRelease(
          c.pitches.map(midi),
          STEPS_PER_BAR * stepSeconds * 0.98,
          time,
        ),
      roots.map((root, bar) => ({
        time: `${bar}:0:0`,
        pitches: chordPitches(settings.key, settings.scale, root),
      })),
    ).start(0);
    parts.push(pads);
  }

  transport.scheduleOnce((time) => {
    // The callback fires a little ahead of the audio; wait until the end is heard. A timer, not
    // Tone's Draw: Draw runs on animation frames, which stop in background tabs.
    const delay = Math.max(0, (time - T.now()) * 1000);
    setTimeout(() => {
      if (token !== current) return;
      silence(T);
      onEnd();
    }, delay);
  }, `${BARS}:0:0`);
  transport.position = 0;
  transport.start("+0.05");
}

/** Plays one melody once. Call from a tap handler. */
export function playMelody(
  melody: Melody,
  settings: Settings,
  chords: boolean,
  onEnd: () => void,
): void {
  const mine = ++token;
  if (tone) {
    unlock(tone);
    schedule(tone, melody, settings, chords, onEnd);
    return;
  }
  // Tone not loaded yet (slow network): start as soon as it is. On iOS this first tap may stay
  // silent because the gesture has passed; the next tap works.
  preloadAudio().then(
    (T) => {
      if (token !== mine) return;
      unlock(T);
      schedule(T, melody, settings, chords, onEnd);
    },
    () => {
      // Tone failed to load (offline): end the playback so the UI does not stay "playing".
      if (token === mine) onEnd();
    },
  );
}

/**
 * Plays melodies one after another, reporting which one is sounding. `chords` is read as each
 * melody starts, so toggling it applies from the next melody.
 */
export function playSequence(
  melodies: readonly Melody[],
  settings: Settings,
  chords: () => boolean,
  onIndex: (index: number) => void,
  onEnd: () => void,
): void {
  const next = (index: number) => {
    const melody = melodies[index];
    if (melody === undefined) {
      onEnd();
      return;
    }
    onIndex(index);
    playMelody(melody, settings, chords(), () => next(index + 1));
  };
  next(0);
}
