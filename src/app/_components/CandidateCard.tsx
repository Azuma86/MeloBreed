"use client";

import type { Dictionary } from "@/app/[lang]/dictionaries";
import { render, type Melody } from "@/engine/melody";
import { PRESETS, STEPS, STEPS_PER_BAR, type Settings } from "@/engine/presets";

interface Props {
  dict: Dictionary["card"];
  label: string;
  melody: Melody;
  settings: Settings;
  picked: boolean;
  playing: boolean;
  /** False when three are already picked and this one is not among them. */
  canPick: boolean;
  onPlay: () => void;
  onTogglePick: () => void;
  onExport: () => void;
}

/** A small piano roll on the preset's pitch range, so candidates can be told apart at a glance. */
function PianoRoll({
  melody,
  settings,
}: {
  melody: Melody;
  settings: Settings;
}) {
  const { low, high } = PRESETS[settings.preset].range;
  const rows = high - low + 1;
  return (
    <svg
      viewBox={`0 0 ${STEPS} ${rows}`}
      preserveAspectRatio="none"
      className="h-16 w-full rounded-md bg-foreground/5"
      aria-hidden="true"
    >
      {[1, 2, 3].map((bar) => (
        <line
          key={bar}
          x1={bar * STEPS_PER_BAR}
          x2={bar * STEPS_PER_BAR}
          y1={0}
          y2={rows}
          className="stroke-foreground/15"
          strokeWidth={0.3}
        />
      ))}
      {render(melody, settings).map((n) => (
        <rect
          key={n.start}
          x={n.start + 0.1}
          y={high - n.pitch}
          width={Math.max(0.6, n.duration - 0.2)}
          height={1}
          rx={0.3}
          className="fill-violet-500"
        />
      ))}
    </svg>
  );
}

const buttonClass =
  "min-h-11 flex-1 rounded-lg border border-foreground/20 px-2 text-sm font-medium disabled:opacity-40";

export function CandidateCard({
  dict,
  label,
  melody,
  settings,
  picked,
  playing,
  canPick,
  onPlay,
  onTogglePick,
  onExport,
}: Props) {
  return (
    <li
      className={`flex flex-col gap-2 rounded-xl border p-2 transition-colors ${
        picked ? "border-violet-500 bg-violet-500/10" : "border-foreground/15"
      } ${playing ? "ring-2 ring-amber-400" : ""}`}
    >
      <button
        type="button"
        onClick={onPlay}
        className="flex flex-col gap-1 text-left"
        aria-label={`${label}: ${playing ? dict.stop : dict.play}`}
      >
        <PianoRoll melody={melody} settings={settings} />
        <span className="text-xs font-medium opacity-70">{label}</span>
      </button>
      <div className="flex gap-1">
        <button type="button" onClick={onPlay} className={buttonClass}>
          {playing ? `■ ${dict.stop}` : `▶ ${dict.play}`}
        </button>
        <button
          type="button"
          onClick={onTogglePick}
          disabled={!picked && !canPick}
          aria-pressed={picked}
          className={`${buttonClass} aria-pressed:border-violet-500 aria-pressed:bg-violet-600 aria-pressed:text-white`}
        >
          {picked ? `✓ ${dict.picked}` : dict.pick}
        </button>
      </div>
      <button type="button" onClick={onExport} className={buttonClass}>
        ⤓ {dict.export}
      </button>
    </li>
  );
}
