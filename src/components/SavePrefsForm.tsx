"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SavePrefsForm({
  initial,
}: {
  initial: { game_type: string; min_confidence: number; max_odds: number };
}) {
  const router = useRouter();
  const [gameType, setGameType] = useState(initial.game_type);
  const [minConf, setMinConf] = useState(String(Math.round(initial.min_confidence * 100)));
  const [maxOdds, setMaxOdds] = useState(String(initial.max_odds));
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/personal/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gameType,
        minConfidence: Number(minConf) / 100,
        maxOdds: Number(maxOdds),
      }),
    });
    const json = await res.json();
    setMsg(json.ok ? "Saved" : json.error || "Failed");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="sc-card space-y-3 p-5">
      <h2 className="font-display text-lg font-bold">Preferences</h2>
      <label className="block text-sm font-semibold">
        Preferred market
        <select
          value={gameType}
          onChange={(e) => setGameType(e.target.value)}
          className="sc-input"
        >
          <option value="result">1X2 result</option>
          <option value="safe">Safe</option>
          <option value="goals">Goals</option>
          <option value="btts">BTTS</option>
          <option value="both">All</option>
        </select>
      </label>
      <label className="block text-sm font-semibold">
        Min confidence %
        <input
          value={minConf}
          onChange={(e) => setMinConf(e.target.value)}
          className="sc-input"
        />
      </label>
      <label className="block text-sm font-semibold">
        Max odds
        <input
          value={maxOdds}
          onChange={(e) => setMaxOdds(e.target.value)}
          className="sc-input"
        />
      </label>
      {msg && <p className="text-sm text-pitch-deep">{msg}</p>}
      <button type="submit" className="sc-btn">
        Save preferences
      </button>
    </form>
  );
}
