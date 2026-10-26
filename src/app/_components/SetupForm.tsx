"use client";

import type { Dictionary } from "@/app/[lang]/dictionaries";
import { KEY_NAMES } from "@/app/_lib/client";
import { SCALE_IDS, isScaleId } from "@/engine/music";
import {
  BPM_MAX,
  BPM_MIN,
  PRESET_IDS,
  defaultSettings,
  type Settings,
} from "@/engine/presets";

interface Props {
  dict: Dictionary["setup"];
  value: Settings;
  onChange: (settings: Settings) => void;
  onStart: (settings: Settings) => void;
  /** Back to the running session without changes; absent when there is none. */
  onCancel?: () => void;
}

const fieldClass =
  "min-h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base";

export function SetupForm({ dict, value, onChange, onStart, onCancel }: Props) {
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        onStart(value);
      }}
    >
      <h2 className="text-xl font-semibold">{dict.heading}</h2>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{dict.genre}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PRESET_IDS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={value.preset === preset}
              // A new genre resets scale and tempo to that genre's defaults (AC2); the key stays.
              onClick={() =>
                onChange({ ...defaultSettings(preset), key: value.key })
              }
              className="min-h-11 rounded-lg border border-foreground/20 px-3 py-2 text-sm font-medium aria-pressed:border-violet-500 aria-pressed:bg-violet-500/15"
            >
              {dict.genres[preset]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {dict.key}
          <select
            className={fieldClass}
            value={value.key}
            onChange={(e) =>
              onChange({ ...value, key: Number(e.target.value) })
            }
          >
            {KEY_NAMES.map((name, key) => (
              <option key={name} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {dict.scale}
          <select
            className={fieldClass}
            value={value.scale}
            onChange={(e) => {
              const scale = e.target.value;
              if (isScaleId(scale)) onChange({ ...value, scale });
            }}
          >
            {SCALE_IDS.map((scale) => (
              <option key={scale} value={scale}>
                {dict.scales[scale]}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-sm font-medium sm:col-span-1">
          {dict.bpm}
          <input
            className={fieldClass}
            type="number"
            inputMode="numeric"
            min={BPM_MIN}
            max={BPM_MAX}
            value={value.bpm}
            onChange={(e) => {
              const bpm = Math.round(Number(e.target.value));
              if (Number.isFinite(bpm)) onChange({ ...value, bpm });
            }}
            onBlur={() =>
              onChange({
                ...value,
                bpm: Math.min(BPM_MAX, Math.max(BPM_MIN, value.bpm)),
              })
            }
          />
        </label>
      </div>

      <button
        type="submit"
        className="min-h-12 rounded-full bg-violet-600 px-6 text-base font-semibold text-white hover:bg-violet-500"
      >
        {onCancel ? dict.startOver : dict.start}
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-full border border-foreground/20 px-6 text-sm font-medium"
        >
          {dict.cancel}
        </button>
      )}
    </form>
  );
}
