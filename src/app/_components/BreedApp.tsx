"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Dictionary } from "@/app/[lang]/dictionaries";
import { track } from "@/app/_analytics/analytics";
import {
  playMelody,
  playSequence,
  preloadAudio,
  stopAudio,
} from "@/app/_audio/player";
import {
  KEY_NAMES,
  downloadFile,
  format,
  loadSession,
  newSeed,
  saveSession,
  useHydrated,
} from "@/app/_lib/client";
import type { WaitlistSource } from "@/app/_lib/waitlist";
import { render } from "@/engine/melody";
import { toMidiFile } from "@/engine/midi";
import {
  MAX_PARENTS,
  PRESETS,
  defaultSettings,
  type Settings,
} from "@/engine/presets";
import {
  breedNext,
  canGoBack,
  currentGeneration,
  generationNumber,
  goBack,
  setSelection,
  startSession,
  type Generation,
  type Session,
} from "@/engine/session";
import type { Locale } from "@/i18n";
import { CandidateCard, type PitchRange } from "./CandidateCard";
import { Icon } from "./Icon";
import { ProModal } from "./ProModal";
import { SetupForm } from "./SetupForm";

interface Props {
  lang: Locale;
  dict: Dictionary;
  /** The landing copy, shown until a session exists so returning users land on their melodies. */
  hero: ReactNode;
}

/** `key` is new for every playback, so a card's playhead restarts with the audio. */
type Playing = { mode: "one" | "all"; index: number; key: number } | undefined;

const SCALE_FILE_NAMES: Record<Settings["scale"], string> = {
  major: "maj",
  minor: "min",
  dorian: "dor",
  majorPentatonic: "majpent",
  minorPentatonic: "minpent",
};

/** How long "Undo" stays offered after starting over. */
const UNDO_MS = 10_000;

const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";

const isIos = () =>
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod/.test(navigator.userAgent);

const secondaryButton =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-foreground/20 px-4 text-sm font-medium";

/** The pitch span of all eight candidates, at least an octave, with a row of margin. */
function pitchRange(generation: Generation, settings: Settings): PitchRange {
  const pitches = generation.candidates.flatMap((melody) =>
    render(melody, settings).map((n) => n.pitch),
  );
  if (pitches.length === 0) return PRESETS[settings.preset].range;
  let low = Math.min(...pitches) - 1;
  let high = Math.max(...pitches) + 1;
  const missing = 12 - (high - low);
  if (missing > 0) {
    low -= Math.floor(missing / 2);
    high += Math.ceil(missing / 2);
  }
  return { low, high };
}

/** One dot per generation so far; the current one is larger. */
function GenerationDots({ count }: { count: number }) {
  const shown = Math.min(count, 8);
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {count > shown && <span className="text-xs opacity-60">…</span>}
      {Array.from({ length: shown }, (_, i) => (
        <span
          key={i}
          className={`rounded-full bg-violet-500 ${
            i === shown - 1 ? "size-2.5" : "size-1.5 opacity-50"
          }`}
        />
      ))}
    </span>
  );
}

export function BreedApp({ lang, dict, hero }: Props) {
  const hydrated = useHydrated();
  // Read storage in the initialiser: it runs again on the client, and nothing that depends on
  // it renders until `hydrated`, so the server HTML still matches.
  const [session, setSession] = useState<Session | undefined>(() =>
    typeof window === "undefined" ? undefined : loadSession(),
  );
  const [draft, setDraft] = useState<Settings>(
    () => session?.settings ?? defaultSettings(lang === "ja" ? "jpop" : "trap"),
  );
  const [playing, setPlaying] = useState<Playing>();
  const [chords, setChords] = useState(true);
  const [proSource, setProSource] = useState<WaitlistSource>();
  const [exported, setExported] = useState(false);
  // Changing settings keeps the session until a new one starts (only starting anew discards).
  const [editing, setEditing] = useState(false);
  // The session replaced by starting over, while "Undo" is offered.
  const [undo, setUndo] = useState<Session>();
  // The offer stays while the pointer or focus is on it.
  const [undoHeld, setUndoHeld] = useState(false);
  // Read when each melody of a play-all starts, so toggling chords applies mid-sequence.
  const chordsRef = useRef(chords);
  const playCount = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Set when an action replaces the generation on screen: the next render scrolls to the top and
  // focuses the heading, so the change is seen (and announced) even from the bottom of the grid.
  const showNewGeneration = useRef(false);

  useEffect(() => {
    // A failed load is retried on the first tap.
    preloadAudio().catch(() => {});
    return () => stopAudio();
  }, []);

  useEffect(() => {
    if (hydrated) saveSession(session);
  }, [session, hydrated]);

  useEffect(() => {
    if (!undo || undoHeld) return;
    const timer = setTimeout(() => setUndo(undefined), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo, undoHeld]);

  useEffect(() => {
    if (!showNewGeneration.current) return;
    showNewGeneration.current = false;
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
    headingRef.current?.focus({ preventScroll: true });
  }, [session]);

  const stop = useCallback(() => {
    stopAudio();
    setPlaying(undefined);
  }, []);

  const closePro = useCallback(() => setProSource(undefined), []);

  const openPro = (source: WaitlistSource) => {
    setProSource(source);
    track("pro_viewed", { source });
  };

  const start = (settings: Settings) => {
    stop();
    setExported(false);
    setEditing(false);
    setUndo(session);
    setUndoHeld(false);
    showNewGeneration.current = true;
    setSession(startSession(settings, newSeed()));
    track("session_started", { ...settings, locale: lang });
  };

  const header = (
    <header className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold tracking-wide text-violet-600">
        MeloBreed
      </span>
      <button
        type="button"
        onClick={() => openPro("header")}
        className="min-h-11 rounded-full bg-amber-400/20 px-4 text-sm font-semibold text-amber-800 dark:text-amber-200"
      >
        {dict.pro.button}
      </button>
    </header>
  );
  const proModal = proSource && (
    <ProModal
      dict={dict.pro}
      lang={lang}
      source={proSource}
      privacyLabel={dict.footer.privacy}
      onClose={closePro}
    />
  );

  if (!hydrated || !session || editing) {
    return (
      <>
        {header}
        {(!hydrated || !session) && hero}
        {hydrated ? (
          <SetupForm
            dict={dict.setup}
            value={draft}
            onChange={setDraft}
            onStart={start}
            onCancel={session ? () => setEditing(false) : undefined}
          />
        ) : (
          <p className="py-16 text-center text-sm opacity-60" aria-busy="true">
            {dict.breed.loading}
          </p>
        )}
        {proModal}
      </>
    );
  }

  const { settings } = session;
  const generation = currentGeneration(session);
  const number = generationNumber(session);
  const picked = generation.selected;
  const range = pitchRange(generation, settings);

  const togglePick = (index: number) => {
    const next = picked.includes(index)
      ? picked.filter((i) => i !== index)
      : picked.length < MAX_PARENTS
        ? [...picked, index]
        : picked;
    setSession(setSelection(session, next));
  };

  const play = (index: number) => {
    // Also during play-all: the card shows Stop, so it stops.
    if (playing?.index === index) {
      stop();
      return;
    }
    const melody = generation.candidates[index];
    if (!melody) return;
    setPlaying({ mode: "one", index, key: ++playCount.current });
    playMelody(melody, settings, chords, () => setPlaying(undefined));
    track("candidate_played", { generation: number, index, mode: "one" });
  };

  const playAll = () => {
    if (playing?.mode === "all") {
      stop();
      return;
    }
    playSequence(
      generation.candidates,
      settings,
      () => chordsRef.current,
      (index) => {
        setPlaying({ mode: "all", index, key: ++playCount.current });
        document
          .getElementById(`candidate-${index}`)
          ?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
      },
      () => setPlaying(undefined),
    );
    track("candidate_played", { generation: number, mode: "all" });
  };

  const exportMidi = (index: number) => {
    const melody = generation.candidates[index];
    if (!melody) return;
    const key = (KEY_NAMES[settings.key] ?? "C").replace("#", "s");
    downloadFile(
      toMidiFile(melody, settings),
      `melobreed-${settings.preset}-${key}${SCALE_FILE_NAMES[settings.scale]}-${settings.bpm}bpm-g${number}-${index + 1}.mid`,
    );
    setExported(true);
    track("midi_exported", { generation: number, preset: settings.preset });
  };

  const breed = () => {
    stop();
    setUndo(undefined);
    // The notice belongs to the generation it was exported from.
    setExported(false);
    showNewGeneration.current = true;
    const next = breedNext(session);
    setSession(next);
    track("generation_bred", {
      generation: generationNumber(next),
      parentCount: picked.length,
    });
  };

  const summary = format(dict.breed.summary, {
    genre: dict.setup.genres[settings.preset],
    key: KEY_NAMES[settings.key] ?? "",
    scale: dict.setup.scales[settings.scale],
    bpm: settings.bpm,
  });

  return (
    <>
      {header}
      <section className="flex flex-col gap-4 pb-24">
        <div className="flex flex-col items-start gap-1">
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="text-2xl font-bold focus:outline-none"
              >
                {format(dict.breed.generation, { n: number })}
              </h1>
              <GenerationDots count={number} />
            </div>
            {canGoBack(session) && (
              <button
                type="button"
                className={secondaryButton}
                onClick={() => {
                  stop();
                  setUndo(undefined);
                  showNewGeneration.current = true;
                  setSession(goBack(session));
                }}
              >
                <Icon name="back" />
                {dict.breed.back}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              stop();
              setDraft(settings);
              setEditing(true);
            }}
            title={dict.breed.changeSettings}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl border border-foreground/15 px-3 py-1 text-left text-sm hover:bg-foreground/5"
          >
            <Icon name="sliders" />
            <span>{summary}</span>
            <span className="font-semibold text-violet-700 dark:text-violet-300">
              {dict.breed.edit}
            </span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={playAll}
            className="inline-flex min-h-11 min-w-36 items-center justify-center gap-1.5 rounded-full bg-foreground px-5 text-sm font-semibold text-background"
          >
            <Icon name={playing?.mode === "all" ? "stop" : "play"} />
            {playing?.mode === "all" ? dict.breed.stop : dict.breed.playAll}
          </button>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-violet-600"
              checked={chords}
              onChange={(e) => {
                chordsRef.current = e.target.checked;
                setChords(e.target.checked);
              }}
            />
            {dict.breed.chords}
          </label>
        </div>
        {isIos() && <p className="text-xs opacity-60">{dict.breed.iosHint}</p>}

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {generation.candidates.map((melody, index) => (
            <CandidateCard
              key={`${generation.seed}-${index}`}
              dict={dict.card}
              number={index + 1}
              label={format(dict.card.label, { n: index + 1 })}
              melody={melody}
              settings={settings}
              range={range}
              picked={picked.includes(index)}
              id={`candidate-${index}`}
              playKey={playing?.index === index ? playing.key : undefined}
              canPick={picked.length < MAX_PARENTS}
              onPlay={() => play(index)}
              onTogglePick={() => togglePick(index)}
              onExport={() => exportMidi(index)}
            />
          ))}
        </ul>

        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-2 text-sm">
          {number === 1 && (
            <span className="opacity-70">{dict.breed.restartPrompt}</span>
          )}
          <button
            type="button"
            className={secondaryButton}
            onClick={() => start(settings)}
          >
            <Icon name="restart" />
            {number === 1 ? dict.breed.restart : dict.breed.startOver}
          </button>
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-foreground/10 bg-background/95 backdrop-blur">
        {/* Always mounted, so screen readers announce what appears in it. */}
        <div
          role="status"
          className="mx-auto flex max-w-5xl flex-col gap-2 px-4 [&:not(:empty)]:pt-3"
        >
          {undo && (
            <div
              className="flex items-center gap-3 rounded-xl bg-foreground px-4 py-1 text-sm text-background"
              onMouseEnter={() => setUndoHeld(true)}
              onMouseLeave={() => setUndoHeld(false)}
              onFocus={() => setUndoHeld(true)}
              onBlur={() => setUndoHeld(false)}
            >
              <span className="flex-1">{dict.breed.undoMessage}</span>
              <button
                type="button"
                onClick={() => {
                  stop();
                  setUndo(undefined);
                  setUndoHeld(false);
                  setExported(false);
                  showNewGeneration.current = true;
                  setSession(undo);
                }}
                className="min-h-11 px-2 font-semibold underline"
              >
                {dict.breed.undo}
              </button>
            </div>
          )}
          {exported && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 py-1 pr-1 pl-3">
              <p className="flex-1 py-1 text-xs sm:text-sm">
                {dict.export.done} {dict.export.proPrompt}
              </p>
              <button
                type="button"
                onClick={() => openPro("after_export")}
                className="min-h-11 shrink-0 rounded-full bg-amber-400 px-3 text-sm font-semibold text-black"
              >
                {dict.export.seePro}
              </button>
              <button
                type="button"
                onClick={() => setExported(false)}
                aria-label={dict.export.dismiss}
                title={dict.export.dismiss}
                className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-full"
              >
                <Icon name="close" />
              </button>
            </div>
          )}
        </div>
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm" aria-live="polite">
            {picked.length === 0 ? (
              dict.breed.hint
            ) : (
              <>
                <span className="font-semibold">
                  {format(dict.breed.selected, { n: picked.length })}
                </span>
                {picked.length === MAX_PARENTS && (
                  <span className="block text-xs opacity-70">
                    {dict.breed.full}
                  </span>
                )}
              </>
            )}
          </p>
          <button
            type="button"
            onClick={breed}
            disabled={picked.length === 0}
            className="min-h-12 shrink-0 rounded-full bg-violet-600 px-6 font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
          >
            {dict.breed.next} →
          </button>
        </div>
      </div>

      {proModal}
    </>
  );
}
