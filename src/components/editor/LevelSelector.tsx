"use client";

import { useSunnyD } from "@/contexts/SunnyDContext";
import {
  SUNNYD_LEVEL_LABELS,
  SUNNYD_LEVEL_TOOLTIPS,
  type SunnyDLevel,
} from "@/lib/sunnyd";

const LEVELS: SunnyDLevel[] = [0, 1, 2, 3];

export function LevelSelector() {
  const { level, setLevel } = useSunnyD();

  return (
    <div
      className="flex items-center rounded-full border border-border bg-surface/60 p-0.5"
      role="radiogroup"
      aria-label="SunnyD proactivity level"
    >
      {LEVELS.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={level === l}
          aria-label={SUNNYD_LEVEL_TOOLTIPS[l]}
          title={SUNNYD_LEVEL_TOOLTIPS[l]}
          onClick={() => setLevel(l)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-sans font-medium transition-colors ${
            level === l
              ? "bg-sunnyd-accent text-white"
              : "text-text-muted hover:bg-border hover:text-text"
          }`}
        >
          {SUNNYD_LEVEL_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
