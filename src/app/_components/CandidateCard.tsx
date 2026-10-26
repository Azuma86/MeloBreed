"use client";

import type { Dictionary } from "@/app/[lang]/dictionaries";
import { render, type Melody } from "@/engine/melody";
import { STEPS, STEPS_PER_BAR, type Settings } from "@/engine/presets";
import { Icon } from "./Icon";

export interface PitchRange {
  low: number;
  high: number;
}

interface Props {
  dict: Dictionary["card"];
  /** 1-based, shown on the card. */
  number: number;
  label: string;
  melody: Melody;
  settings: Settings;
  /** Shared by all eight cards, so their registers compare at a glance. */
  range: PitchRange;
  picked: boolean;
  playing: boolean;
  /** False when three are already picked and this one is not among them. */
  canPick: boolean;
  onPlay: () => void;
  onTogglePick: () => void;
  onExport: () => void;
}

/** A piano roll of the melody; while it plays, a line sweeps across it in time. */
function PianoRoll({
  melody,
  settings,
  range: { low, high },
  playing,
}: {
  melody: Melody;
  settings: Settings;
  range: PitchRange;
  playing: boolean;
}) {
  const rows = high - low + 1;
  // One pass over the whole melody, starting when the player does (it starts 50 ms ahead).
  const seconds = (STEPS * 15) / settings.bpm;
  return (
    <div className="relative h-20 w-full overflow-hidden bg-foreground/[0.04] sm:h-24">
      <svg
        viewBox={`0 0 ${STEPS} ${rows}`}
        preserveAspectRatio="none"
        className="size-full"
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
            y={high - n.pitch + 0.1}
            width={Math.max(0.6, n.duration - 0.2)}
            height={0.8}
            rx={0.3}
            className="fill-violet-500"
          />
        ))}
      </svg>
      {playing && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ animation: `playhead ${seconds}s linear 50ms both` }}
          aria-hidden="true"
        >
          <div className="h-full w-0.5 bg-amber-500" />
        </div>
      )}
    </div>
  );
}

export function CandidateCard({
  dict,
  number,
  label,
  melody,
  settings,
  range,
  picked,
  playing,
  canPick,
  onPlay,
  onTogglePick,
  onExport,
}: Props) {
  return (
    <li
      className={`flex flex-col overflow-hidden rounded-xl border transition-colors ${
        picked
          ? "border-violet-500 bg-violet-500/10"
          : "border-foreground/15 bg-background"
      } ${playing ? "outline-2 outline-offset-2 outline-amber-400" : ""}`}
    >
      <button
        type="button"
        onClick={onPlay}
        className="relative block w-full text-left"
        aria-label={`${label}: ${playing ? dict.stop : dict.play}`}
      >
        <PianoRoll
          melody={melody}
          settings={settings}
          range={range}
          playing={playing}
        />
        <span className="absolute top-1.5 left-1.5 rounded-md bg-background/85 px-1.5 text-xs font-semibold tabular-nums">
          {number}
        </span>
        <span
          className={`absolute right-1.5 bottom-1.5 grid size-8 place-items-center rounded-full shadow-sm ${
            playing
              ? "bg-amber-400 text-black"
              : "bg-foreground text-background"
          }`}
        >
          <Icon name={playing ? "stop" : "play"} />
        </span>
      </button>
      <div className="flex gap-1.5 p-1.5">
        <button
          type="button"
          onClick={onTogglePick}
          disabled={!picked && !canPick}
          aria-pressed={picked}
          className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-lg border border-violet-500/50 px-2 text-sm font-semibold whitespace-nowrap text-violet-700 disabled:opacity-40 aria-pressed:border-violet-600 aria-pressed:bg-violet-600 aria-pressed:text-white dark:text-violet-300 dark:aria-pressed:text-white"
        >
          <Icon name={picked ? "check" : "plus"} />
          {picked ? dict.picked : dict.pick}
        </button>
        <button
          type="button"
          onClick={onExport}
          aria-label={`${label}: ${dict.exportLabel}`}
          title={dict.exportLabel}
          className="flex min-h-11 w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-foreground/20 text-[10px] leading-none font-medium"
        >
          <Icon name="download" />
          {dict.export}
        </button>
      </div>
    </li>
  );
}
