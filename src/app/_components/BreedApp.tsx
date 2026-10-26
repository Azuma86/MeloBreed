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

type Playing = { mode: "one" | "all"; index: number } | undefined;

const SCALE_FILE_NAMES: Record<Settings["scale"], string> = {
  major: "maj",
  minor: "min",
  dorian: "dor",
  majorPentatonic: "majpent",
  minorPentatonic: "minpent",
};

/** How long "Undo" stays offered after starting over. */
const UNDO_MS = 10_000;

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
  // Read when each melody of a play-all starts, so toggling chords applies mid-sequence.
  const chordsRef = useRef(chords);

  useEffect(() => {
    // A failed load is retried on the first tap.
    preloadAudio().catch(() => {});
    return () => stopAudio();
  }, []);

  useEffect(() => {
    if (hydrated) saveSession(session);
  }, [session, hydrated]);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(undefined), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

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
    if (playing?.mode === "one" && playing.index === index) {
      stop();
      return;
    }
    const melody = generation.candidates[index];
    if (!melody) return;
    setPlaying({ mode: "one", index });
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
      (index) => setPlaying({ mode: "all", index }),
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
              <h1 className="text-2xl font-bold">
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
            aria-label={`${dict.breed.changeSettings}: ${summary}`}
            title={dict.breed.changeSettings}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-foreground/15 px-3 text-sm hover:bg-foreground/5"
          >
            <Icon name="sliders" />
            {summary}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={playAll}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-foreground px-5 text-sm font-semibold text-background"
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
              playing={playing?.index === index}
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
        {(undo || exported) && (
          <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 pt-3">
            {undo && (
              <div
                role="status"
                className="flex items-center gap-3 rounded-xl bg-foreground px-4 py-1 text-sm text-background"
              >
                <span className="flex-1">{dict.breed.undoMessage}</span>
                <button
                  type="button"
                  onClick={() => {
                    stop();
                    setSession(undo);
                    setUndo(undefined);
                    setExported(false);
                  }}
                  className="min-h-11 px-2 font-semibold underline"
                >
                  {dict.breed.undo}
                </button>
              </div>
            )}
            {exported && (
              <div
                role="status"
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-sm"
              >
                <span className="flex-1 basis-56 py-2">
                  {dict.export.done} {dict.export.proPrompt}
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openPro("after_export")}
                    className="min-h-11 rounded-full bg-amber-400 px-4 font-semibold text-black"
                  >
                    {dict.export.seePro}
                  </button>
                  <button
                    type="button"
                    onClick={() => setExported(false)}
                    className="min-h-11 px-2 underline"
                  >
                    {dict.export.dismiss}
                  </button>
                </span>
              </div>
            )}
          </div>
        )}
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
