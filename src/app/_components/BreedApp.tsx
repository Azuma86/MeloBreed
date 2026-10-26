"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { toMidiFile } from "@/engine/midi";
import { MAX_PARENTS, defaultSettings, type Settings } from "@/engine/presets";
import {
  breedNext,
  canGoBack,
  currentGeneration,
  generationNumber,
  goBack,
  setSelection,
  startSession,
  type Session,
} from "@/engine/session";
import type { Locale } from "@/i18n";
import { CandidateCard } from "./CandidateCard";
import { ProModal } from "./ProModal";
import { SetupForm } from "./SetupForm";

interface Props {
  lang: Locale;
  dict: Dictionary;
}

type Playing = { mode: "one" | "all"; index: number } | undefined;

const SCALE_FILE_NAMES: Record<Settings["scale"], string> = {
  major: "maj",
  minor: "min",
  dorian: "dor",
  majorPentatonic: "majpent",
  minorPentatonic: "minpent",
};

const isIos = () =>
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod/.test(navigator.userAgent);

const secondaryButton =
  "min-h-11 rounded-full border border-foreground/20 px-4 text-sm font-medium disabled:opacity-40";

export function BreedApp({ lang, dict }: Props) {
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
    setSession(startSession(settings, newSeed()));
    track("session_started", { ...settings, locale: lang });
  };

  if (!hydrated) {
    return (
      <p className="py-16 text-center text-sm opacity-60" aria-busy="true">
        {dict.breed.loading}
      </p>
    );
  }

  const proModal = proSource && (
    <ProModal
      dict={dict.pro}
      lang={lang}
      source={proSource}
      privacyLabel={dict.footer.privacy}
      onClose={closePro}
    />
  );
  const proButton = (
    <button
      type="button"
      onClick={() => openPro("header")}
      className="min-h-11 rounded-full bg-amber-400/20 px-4 text-sm font-semibold text-amber-800 dark:text-amber-200"
    >
      {dict.pro.button}
    </button>
  );

  if (!session || editing) {
    return (
      <section className="flex flex-col gap-4">
        <div className="flex justify-end">{proButton}</div>
        <SetupForm
          dict={dict.setup}
          value={draft}
          onChange={setDraft}
          onStart={start}
          onCancel={session ? () => setEditing(false) : undefined}
        />
        {proModal}
      </section>
    );
  }

  const { settings } = session;
  const generation = currentGeneration(session);
  const number = generationNumber(session);
  const picked = generation.selected;

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
    const next = breedNext(session);
    setSession(next);
    track("generation_bred", {
      generation: generationNumber(next),
      parentCount: picked.length,
    });
  };

  return (
    <section className="flex flex-col gap-4 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">
            {format(dict.breed.generation, { n: number })}
          </h2>
          <p className="text-sm opacity-70">
            {format(dict.breed.summary, {
              genre: dict.setup.genres[settings.preset],
              key: KEY_NAMES[settings.key] ?? "",
              scale: dict.setup.scales[settings.scale],
              bpm: settings.bpm,
            })}
          </p>
        </div>
        {proButton}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={secondaryButton}
          disabled={!canGoBack(session)}
          onClick={() => {
            stop();
            setSession(goBack(session));
          }}
        >
          ← {dict.breed.back}
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => start(settings)}
        >
          ↻ {dict.breed.restart}
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => {
            stop();
            setDraft(settings);
            setEditing(true);
          }}
        >
          {dict.breed.changeSettings}
        </button>
      </div>

      <p className="text-sm">{dict.breed.hint}</p>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={playAll}
          className="min-h-11 rounded-full bg-foreground px-5 text-sm font-semibold text-background"
        >
          {playing?.mode === "all"
            ? `■ ${dict.breed.stop}`
            : `▶ ${dict.breed.playAll}`}
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
            label={format(dict.card.label, { n: index + 1 })}
            melody={melody}
            settings={settings}
            picked={picked.includes(index)}
            playing={playing?.index === index}
            canPick={picked.length < MAX_PARENTS}
            onPlay={() => play(index)}
            onTogglePick={() => togglePick(index)}
            onExport={() => exportMidi(index)}
          />
        ))}
      </ul>

      {exported && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm"
        >
          <span className="flex-1">
            {dict.export.done} {dict.export.proPrompt}
          </span>
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
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-foreground/10 bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <span className="text-sm">
            {format(dict.breed.selected, { n: picked.length })}
          </span>
          <button
            type="button"
            onClick={breed}
            disabled={picked.length === 0}
            className="min-h-12 rounded-full bg-violet-600 px-6 font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
          >
            {dict.breed.next} →
          </button>
        </div>
      </div>

      {proModal}
    </section>
  );
}
