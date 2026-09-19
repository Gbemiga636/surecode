"use client";

import { useMemo, useState } from "react";
import { Icon } from "./Icons";
import { BUILDER_MARKETS, type BuilderCondition } from "@/lib/builder-markets";
import type { BuilderResultView } from "@/lib/builder-markets";

export function ComboBuilderForm() {
  const [selected, setSelected] = useState<Record<string, boolean>>({ O05: true });
  const [legs, setLegs] = useState(2);
  const [maxOdds, setMaxOdds] = useState(1.75);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<BuilderResultView | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const conditions = useMemo(
    () =>
      BUILDER_MARKETS.filter((m) => selected[m.id]).map((m) => m.id as BuilderCondition),
    [selected],
  );

  const groups = useMemo(() => {
    const map = new Map<string, typeof BUILDER_MARKETS>();
    for (const m of BUILDER_MARKETS) {
      const list = map.get(m.group) ?? [];
      list.push(m);
      map.set(m.group, list);
    }
    return [...map.entries()];
  }, []);

  function toggle(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
    setErr(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!conditions.length) {
      setErr("Select at least one market condition");
      return;
    }
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/build-combo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conditions,
          legs,
          maxOdds,
          slips: 3,
        }),
      });
      const json = (await res.json()) as BuilderResultView;
      if (!res.ok && !json.slips?.length) {
        setErr(json.error || "Could not build combos");
      }
      setResult(json);
      if (json.error && json.slips?.length) setErr(json.error);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="sc-card space-y-5 p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
            Your conditions
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Pick markets (e.g. Over 0.5). We scan today&apos;s fixtures, rank the best matches,
            and book SportyBet codes.
          </p>
        </div>

        <div className="space-y-4">
          {groups.map(([group, markets]) => (
            <div key={group}>
              <p className="mb-2 text-xs font-semibold text-[var(--ink)]">{group}</p>
              <div className="flex flex-wrap gap-1.5">
                {markets.map((m) => {
                  const on = Boolean(selected[m.id]);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggle(m.id)}
                      className={`sc-nav-link ${on ? "sc-nav-link-active" : ""}`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-[var(--ink)]">
            Legs per code
            <select
              className="sc-input"
              value={legs}
              onChange={(e) => setLegs(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "Single" : `${n}-fold`}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-[var(--ink)]">
            Max odds per leg
            <select
              className="sc-input"
              value={maxOdds}
              onChange={(e) => setMaxOdds(Number(e.target.value))}
            >
              {[1.35, 1.5, 1.65, 1.75, 1.9, 2.2, 2.6].map((n) => (
                <option key={n} value={n}>
                  ≤ {n.toFixed(2)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {err && <p className="text-sm text-[var(--bad)]">{err}</p>}

        <button type="submit" className="sc-btn" disabled={busy || !conditions.length}>
          {busy ? "Analysing fixtures…" : "Find best codes"}
        </button>
      </form>

      {result && (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-[var(--muted)]">
            Scanned {result.scanned} fixtures · {result.matched} matched your conditions
          </p>
          {result.slips.map((slip, i) => (
            <div key={i} className="sc-card space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                    Code {i + 1} · {slip.label}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                    Odds ~{slip.totalOdds.toFixed(2)} · model ~
                    {Math.round(slip.confidence * 100)}%
                  </p>
                </div>
                {slip.code ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="sc-btn-ghost text-xs"
                      onClick={() => copy(slip.code!)}
                    >
                      {copied === slip.code ? "Copied" : "Copy code"}
                    </button>
                    {slip.shareUrl && (
                      <a
                        className="sc-btn text-xs"
                        href={slip.shareUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open SportyBet
                      </a>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-[var(--bad)]">
                    {slip.error || "Booking failed"}
                  </span>
                )}
              </div>
              {slip.code && (
                <p className="font-mono text-lg font-bold tracking-wider text-[var(--ink)]">
                  {slip.code}
                </p>
              )}
              <ul className="space-y-1.5 text-sm text-[var(--ink)]">
                {slip.legs.map((leg) => (
                  <li key={`${leg.eventId}-${leg.pickCode}`}>
                    <span className="font-medium">
                      {leg.home} vs {leg.away}
                    </span>
                    <span className="text-[var(--muted)]">
                      {" "}
                      · {leg.pickLabel} @ {leg.odds.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-sm leading-relaxed text-[var(--muted)]">
                <Icon name="pulse" size={12} className="mr-1 inline opacity-60" />
                {slip.rationale}
              </p>
            </div>
          ))}
          {!result.slips.length && (
            <div className="sc-empty text-sm">
              {result.error || "No codes this round — try different markets."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
