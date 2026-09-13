"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type SelectablePick = {
  key: string;
  home: string;
  away: string;
  pick: string;
  odds: string;
  confidence: number;
  eventId: string;
  pickCode: string;
  league?: string;
  kickoff: string;
  reasons?: string[];
  edge?: number;
  ev?: number;
  market?: string;
};

function kickLabel(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-NG", {
      timeZone: "Africa/Lagos",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function PickBoard({
  picks,
  origin,
  emptyText = "No picks right now — try again after the next crawl.",
}: {
  picks: SelectablePick[];
  origin: string;
  emptyText?: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"book" | "demo" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [stakeOpen, setStakeOpen] = useState(false);
  const [stake, setStake] = useState("1000");

  const chosen = useMemo(() => picks.filter((p) => selected[p.key]), [picks, selected]);
  const totalOdds = chosen.reduce((a, p) => a * Number(p.odds || 1), 1);
  const conf = chosen.length ? chosen.reduce((a, p) => a * p.confidence, 1) : 0;
  const potential = Math.round(Number(stake || 0) * totalOdds);

  function toggle(key: string) {
    setSelected((s) => ({ ...s, [key]: !s[key] }));
    setMsg(null);
  }

  function selectTop(n: number) {
    const next: Record<string, boolean> = {};
    picks.slice(0, n).forEach((p) => {
      next[p.key] = true;
    });
    setSelected(next);
  }

  async function book() {
    if (!chosen.length) return;
    setBusy("book");
    setMsg(null);
    const res = await fetch("/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picks: chosen, origin }),
    });
    const json = await res.json();
    setBusy(null);
    if (!json.ok) {
      setMsg(json.error || "Booking failed");
      return;
    }
    setMsg(`Code ${json.code} ready — opening SportyBet`);
    if (json.code) {
      try {
        await navigator.clipboard.writeText(json.code);
      } catch {
        /* ignore */
      }
    }
    if (json.url) window.open(json.url, "_blank", "noopener,noreferrer");
    router.refresh();
  }

  async function demo() {
    if (!chosen.length) return;
    const n = Math.round(Number(stake) || 0);
    if (n < 100) {
      setMsg("Minimum stake is ₦100");
      return;
    }
    setBusy("demo");
    setMsg(null);
    const res = await fetch("/api/demo/bet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picks: chosen, stake: n, origin }),
    });
    const json = await res.json();
    setBusy(null);
    if (!json.ok) {
      setMsg(json.error || "Demo bet failed");
      return;
    }
    setStakeOpen(false);
    setMsg("Demo bet placed");
    router.push("/demo");
    router.refresh();
  }

  if (!picks.length) {
    return <div className="sc-empty text-sm text-ink/60">{emptyText}</div>;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" className="sc-btn-ghost text-xs" onClick={() => selectTop(3)}>
          Top 3
        </button>
        <button type="button" className="sc-btn-ghost text-xs" onClick={() => selectTop(5)}>
          Top 5
        </button>
        <button type="button" className="sc-btn-ghost text-xs" onClick={() => setSelected({})}>
          Clear
        </button>
      </div>

      <div className="space-y-2.5">
        {picks.map((p) => {
          const on = !!selected[p.key];
          return (
            <button
              key={p.key + p.pickCode}
              type="button"
              onClick={() => toggle(p.key)}
              className={`sc-card sc-card-interactive w-full p-4 text-left ${
                on ? "sc-card-selected" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.16em] text-ink/40">
                    {p.league || "Football"} · {p.market || "Pick"}
                    {p.kickoff ? ` · ${kickLabel(p.kickoff)}` : ""}
                  </p>
                  <p className="mt-1.5 font-display text-base font-bold text-ink">
                    {p.home} <span className="font-medium text-ink/30">vs</span> {p.away}
                  </p>
                  <p className="mt-1 text-sm text-ink/70">
                    {p.pick}
                    {p.confidence ? (
                      <span className="text-ink/40">
                        {" "}
                        · {Math.round(p.confidence * 100)}%
                      </span>
                    ) : null}
                    {p.edge != null ? (
                      <span className="text-pitch-deep"> · +{Math.round(p.edge * 100)} edge</span>
                    ) : null}
                  </p>
                  {p.reasons?.[0] && (
                    <p className="mt-1 line-clamp-2 text-xs text-ink/45">{p.reasons[0]}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-mono text-lg font-extrabold text-pitch-deep">{p.odds}</p>
                  <p
                    className={`mt-2 text-[0.65rem] font-extrabold uppercase tracking-wider ${
                      on ? "text-pitch" : "text-ink/35"
                    }`}
                  >
                    {on ? "In slip" : "Add"}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {chosen.length > 0 && (
        <div className="sc-slip-bar sticky bottom-4 z-20 mt-6 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-display text-sm font-bold text-ink">
                {chosen.length} selected · {totalOdds.toFixed(2)}x
                {conf ? ` · ~${Math.round(conf * 100)}%` : ""}
              </p>
              {msg && <p className="mt-1 text-xs font-semibold text-pitch-deep">{msg}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => setStakeOpen(true)}
                className="sc-btn-ghost"
              >
                Demo ₦
              </button>
              <button type="button" disabled={!!busy} onClick={book} className="sc-btn">
                {busy === "book" ? "Booking…" : "Get SportyBet code"}
              </button>
            </div>
          </div>
        </div>
      )}

      {stakeOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-4 backdrop-blur-sm sm:items-center">
          <div className="sc-card w-full max-w-sm p-5">
            <p className="font-display text-lg font-bold">Demo stake</p>
            <p className="mt-1 text-sm text-ink/55">
              {chosen.length} legs · odds {totalOdds.toFixed(2)}
            </p>
            <label className="mt-4 block text-sm font-semibold">
              Amount (₦)
              <input
                className="sc-input"
                inputMode="numeric"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
              />
            </label>
            <p className="mt-2 text-sm text-ink/55">
              Potential return ≈ <span className="font-bold text-ink">₦{potential.toLocaleString()}</span>
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" className="sc-btn-ghost flex-1" onClick={() => setStakeOpen(false)}>
                Cancel
              </button>
              <button type="button" className="sc-btn flex-1" disabled={!!busy} onClick={demo}>
                {busy === "demo" ? "…" : "Place"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
