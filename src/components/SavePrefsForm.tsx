"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "@/components/Icons";

const MARKETS: { key: string; label: string; icon: IconName }[] = [
  { key: "result", label: "1X2", icon: "target" },
  { key: "safe", label: "Safe", icon: "shield" },
  { key: "goals", label: "Goals", icon: "football" },
  { key: "btts", label: "BTTS", icon: "layers" },
  { key: "both", label: "All", icon: "spark" },
];

export function SavePrefsForm({
  initial,
}: {
  initial: { game_type: string; min_confidence: number; max_odds: number };
}) {
  const router = useRouter();
  const [gameType, setGameType] = useState(initial.game_type);
  const [minConf, setMinConf] = useState(Math.round(initial.min_confidence * 100));
  const [maxOdds, setMaxOdds] = useState(initial.max_odds);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/personal/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameType, minConfidence: minConf / 100, maxOdds }),
      });
      const json = await res.json();
      setMsg(json.ok ? { ok: true, text: "Preferences saved" } : { ok: false, text: json.error || "Failed" });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Could not save. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="sv-prefs">
      <div className="sv-prefs-head">
        <span className="sv-prefs-ic">
          <Icon name="gauge" size={18} />
        </span>
        <div>
          <h3>Your pick style</h3>
          <p>Tunes the picks and combos built for you.</p>
        </div>
      </div>

      <fieldset className="sv-field">
        <legend>Preferred market</legend>
        <div className="sv-seg" role="radiogroup">
          {MARKETS.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={gameType === m.key}
              className={gameType === m.key ? "is-on" : ""}
              onClick={() => setGameType(m.key)}
            >
              <Icon name={m.icon} size={14} />
              {m.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="sv-field">
        <span className="sv-range-top">
          Minimum confidence <strong>{minConf}%</strong>
        </span>
        <input
          type="range"
          min={40}
          max={95}
          step={1}
          value={minConf}
          onChange={(e) => setMinConf(Number(e.target.value))}
          style={{ ["--p" as string]: `${((minConf - 40) / 55) * 100}%` }}
        />
        <span className="sv-range-ends">
          <span>More picks</span>
          <span>Safer picks</span>
        </span>
      </label>

      <label className="sv-field">
        <span className="sv-range-top">
          Maximum odds <strong>{maxOdds.toFixed(1)}</strong>
        </span>
        <input
          type="range"
          min={1.2}
          max={20}
          step={0.1}
          value={maxOdds}
          onChange={(e) => setMaxOdds(Number(e.target.value))}
          style={{ ["--p" as string]: `${((maxOdds - 1.2) / 18.8) * 100}%` }}
        />
        <span className="sv-range-ends">
          <span>Low risk</span>
          <span>Big prices</span>
        </span>
      </label>

      <button type="submit" className="sv-save" disabled={busy}>
        <Icon name="check" size={16} />
        {busy ? "Saving…" : "Save preferences"}
      </button>
      {msg && <p className={`sv-msg${msg.ok ? "" : " is-bad"}`}>{msg.text}</p>}
    </form>
  );
}
