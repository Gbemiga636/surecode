"use client";

import { useEffect, useState } from "react";

export type SureModeChoice = "safe" | "boost" | "longshot";

const KEY = "surecode_sure_mode";

export function SureModePicker({
  initial = "safe",
  onChange,
}: {
  initial?: SureModeChoice;
  onChange?: (mode: SureModeChoice) => void;
}) {
  const [mode, setMode] = useState<SureModeChoice>(initial);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as SureModeChoice | null;
      if (saved === "safe" || saved === "boost" || saved === "longshot") {
        setMode(saved);
        onChange?.(saved);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(next: SureModeChoice) {
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
    onChange?.(next);
  }

  return (
    <div className="sure-mode-picker sc-rise mb-5">
      <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
        Profit lane
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`sure-mode-btn ${mode === "safe" ? "active" : ""}`}
          onClick={() => choose("safe")}
        >
          <span className="sure-mode-title">Safe</span>
          <span className="sure-mode-desc">Short odds · protect bankroll</span>
        </button>
        <button
          type="button"
          className={`sure-mode-btn ${mode === "boost" ? "active" : ""}`}
          onClick={() => choose("boost")}
        >
          <span className="sure-mode-title">Larger</span>
          <span className="sure-mode-desc">Bigger favourites · cross-sport</span>
        </button>
        <button
          type="button"
          className={`sure-mode-btn ${mode === "longshot" ? "active" : ""}`}
          onClick={() => choose("longshot")}
        >
          <span className="sure-mode-title">Longshot</span>
          <span className="sure-mode-desc">Multi-day · high odds stacks</span>
        </button>
      </div>
    </div>
  );
}

export function readSureMode(): SureModeChoice {
  if (typeof window === "undefined") return "safe";
  try {
    const saved = localStorage.getItem(KEY) as SureModeChoice | null;
    if (saved === "safe" || saved === "boost" || saved === "longshot") return saved;
  } catch {
    /* ignore */
  }
  return "safe";
}
