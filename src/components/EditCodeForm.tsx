"use client";

import { useState } from "react";
import { Icon } from "./Icons";
import type { EditResult } from "@/lib/edit-code";

export function EditCodeForm() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<EditResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/edit-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = (await res.json()) as EditResult & { error?: string };
      if (!res.ok && !json.alts?.length) {
        setErr(json.error || "Could not edit that code");
      }
      setResult(json);
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
      <form onSubmit={onSubmit} className="sc-card space-y-4 p-5">
        <label className="block text-sm font-semibold text-[var(--ink)]">
          Long SportyBet share code
          <input
            className="sc-input font-mono tracking-wider"
            placeholder="e.g. AB12CD or paste a SportyBet link"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </label>
        <p className="text-xs leading-relaxed text-[var(--muted)]">
          We drop started and weak legs, upgrade picks to safer markets when possible, then book
          shorter 2–3 fold codes with higher hit probability.
        </p>
        {err && <p className="text-sm text-[var(--bad)]">{err}</p>}
        <button type="submit" className="sc-btn" disabled={busy || !code.trim()}>
          {busy ? "Editing…" : "Rebuild into better codes"}
        </button>
      </form>

      {result && (
        <div className="mt-6 space-y-5">
          <div className="sc-card p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
              Source · {result.sourceCode}
            </p>
            <p className="mt-1 text-sm text-[var(--ink)]">
              {result.sourceGames} games
              {result.sourceOdds != null ? ` · odds ~${Number(result.sourceOdds).toFixed(2)}` : ""}
              {" · "}
              kept {result.kept} quality open legs
            </p>
          </div>

          {result.alts.map((alt) => (
            <article key={alt.label + (alt.code || "x")} className="sc-card overflow-hidden p-0">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3.5">
                <div>
                  <p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
                    {alt.label}
                  </p>
                  <p className="mt-1 font-mono text-xl font-extrabold tracking-wide text-[var(--ink)]">
                    {alt.code || "Booking failed"}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {alt.legs.length} games · odds{" "}
                    <span className="font-semibold text-[var(--ink)]">
                      {alt.totalOdds.toFixed(2)}
                    </span>
                    {" · ~"}
                    {Math.round(alt.confidence * 100)}% model
                  </p>
                  <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">{alt.rationale}</p>
                  {alt.error && (
                    <p className="mt-1 text-xs text-[var(--bad)]">{alt.error}</p>
                  )}
                </div>
                {alt.code && (
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={alt.shareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sc-btn"
                    >
                      <Icon name="external" size={15} />
                      Open
                    </a>
                    <button type="button" className="sc-btn-ghost" onClick={() => copy(alt.code!)}>
                      <Icon name="copy" size={15} />
                      {copied === alt.code ? "Copied" : "Copy"}
                    </button>
                  </div>
                )}
              </div>
              <ul className="space-y-2 px-4 py-3 text-sm">
                {alt.legs.map((leg, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span>
                      <span className="font-semibold text-[var(--ink)]">
                        {leg.home} vs {leg.away}
                      </span>
                      <span className="text-[var(--muted)]"> — {leg.pickLabel}</span>
                    </span>
                    <span className="font-mono font-bold text-[var(--accent-deep)]">
                      {leg.odds.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}

          {result.dropped.length > 0 && (
            <div className="sc-card p-4">
              <p className="text-sm font-bold text-[var(--ink)]">Dropped from long slip</p>
              <ul className="mt-2 space-y-1.5 text-xs text-[var(--muted)]">
                {result.dropped.slice(0, 24).map((d, i) => (
                  <li key={i}>
                    <span className="font-semibold text-[var(--ink)]">{d.match}</span> — {d.pick}{" "}
                    <span className="opacity-70">({d.reason})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!result.ok && result.error && (
            <p className="text-sm text-[var(--bad)]">{result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
