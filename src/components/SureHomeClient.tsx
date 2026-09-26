"use client";

import { useMemo, useState } from "react";
import { CodeActions } from "@/components/CodeActions";
import { ReadMore } from "@/components/ReadMore";
import { SportChip } from "@/components/SureArena";
import { SureModePicker, type SureModeChoice } from "@/components/SureModePicker";
import { modeForSlot, modeLabel } from "@/lib/sure-mode";

function sportyOpenUrl(code: string) {
  return `https://www.sportybet.com/ng/?shareCode=${encodeURIComponent(code)}`;
}

export type SureHomeCode = {
  id: string;
  slot: number;
  code: string;
  share_url: string | null;
  total_odds: number | null;
  confidence: number | null;
  legs: {
    home: string;
    away: string;
    pickLabel: string;
    odds: number;
    kickoff?: number;
    sport?: string;
    sportLabel?: string;
  }[];
  rationale: string | null;
};

function formatKick(ms?: number) {
  if (!ms) return null;
  try {
    return new Date(ms).toLocaleString("en-NG", {
      timeZone: "Africa/Lagos",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

export function SureHomeClient({
  day,
  codes,
}: {
  day: string;
  codes: SureHomeCode[];
}) {
  const [mode, setMode] = useState<SureModeChoice>("safe");

  const filtered = useMemo(() => {
    return codes.filter((c) => modeForSlot(c.slot) === mode);
  }, [codes, mode]);

  const latest = filtered[0];
  const emptyBoost = mode === "boost" && filtered.length === 0;
  const emptySafe = mode === "safe" && filtered.length === 0;
  const emptyLong = mode === "longshot" && filtered.length === 0;

  return (
    <div className="sure-home">
      <SureModePicker initial="safe" onChange={setMode} />

      {emptyBoost && (
        <div className="sc-empty sc-rise mb-4">
          <p className="font-display text-lg font-bold text-[var(--ink)]">Larger sure warming up</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
            Bigger favourite-backed codes (slots 4–6) appear after the next crawl — separate from Safe.
          </p>
        </div>
      )}
      {emptySafe && (
        <div className="sc-empty sc-rise mb-4">
          <p className="font-display text-lg font-bold text-[var(--ink)]">Safe singles warming up</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--muted)]">
            Short-odds bankroll protectors appear here after a crawl.
          </p>
        </div>
      )}
      {emptyLong && (
        <div className="sc-empty sc-rise mb-4">
          <p className="font-display text-lg font-bold text-[var(--ink)]">Longshots warming up</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
            Multi-day cross-sport stacks (slots 7–9) with higher combined odds. AI play-out must clear
            them first — they are never “certain”.
          </p>
        </div>
      )}

      {latest && (
        <div className="hero-panel hero-sport sc-rise mb-6">
          <span className="hero-aurora" aria-hidden />
          <span className="hero-ring" aria-hidden />
          <div className="hero-arena" aria-hidden>
            <div className="hero-odds-stack">
              <span>HIT</span>
              <strong>
                {latest.confidence != null
                  ? `${Math.round(Number(latest.confidence) * 100)}`
                  : "—"}
              </strong>
              <em>model %</em>
            </div>
          </div>
          <div className="relative z-[2] p-6 pr-[200px] max-[900px]:pr-6 sm:p-8 sm:pr-[220px]">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
              {modeLabel(mode)} · slip {latest.slot}
              {latest.confidence != null
                ? ` · ~${Math.round(Number(latest.confidence) * 100)}% model`
                : ""}
            </p>
            <p className="mt-3 font-mono text-3xl font-extrabold tracking-[0.14em] text-[var(--ink)] sm:text-5xl">
              {latest.code}
            </p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {(latest.legs ?? [])[0]?.sportLabel ||
                (latest.legs ?? [])[0]?.sport ||
                "Multi-sport"}{" "}
              · odds{" "}
              <span className="font-semibold text-[var(--ink)]">
                {latest.total_odds != null ? Number(latest.total_odds).toFixed(2) : "—"}
              </span>
              {" · "}
              {(latest.legs ?? []).length === 1 ? "single" : `${(latest.legs ?? []).length}-fold`}
            </p>
            <div className="mt-5">
              <CodeActions
                code={latest.code}
                openUrl={latest.share_url || sportyOpenUrl(latest.code)}
                sureCodeId={latest.id}
              />
            </div>
          </div>
        </div>
      )}

      {!filtered.length && !emptyBoost && !emptySafe && !emptyLong && (
        <div className="sc-empty sc-rise">
          <p className="font-display text-lg font-bold text-[var(--ink)]">Arena warming up</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--muted)]">
            {day} — scanning all SportyBet sports. Run a crawl if this stays empty.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {filtered.map((c, idx) => {
          const openUrl = c.share_url || sportyOpenUrl(c.code);
          const conf = c.confidence != null ? Math.round(Number(c.confidence) * 100) : null;
          const leg0 = (c.legs ?? [])[0];
          return (
            <article
              key={c.id}
              className="sc-card sure-slip sc-rise overflow-hidden p-0"
              style={{ animationDelay: `${idx * 80}ms` }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4 sm:px-6">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
                      Slip {c.slot}
                      {conf != null ? ` · ${conf}%` : ""}
                    </p>
                    <SportChip sport={leg0?.sportLabel || leg0?.sport} />
                    <span className="sport-chip">{modeLabel(modeForSlot(c.slot))}</span>
                  </div>
                  <p className="mt-1.5 font-mono text-2xl font-extrabold tracking-wider text-[var(--ink)]">
                    {c.code}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Odds{" "}
                    <span className="font-semibold text-[var(--ink)]">
                      {c.total_odds != null ? Number(c.total_odds).toFixed(2) : "—"}
                    </span>
                    {" · "}
                    {(c.legs ?? []).length === 1 ? "single" : `${(c.legs ?? []).length}-fold`}
                  </p>
                </div>
                <CodeActions code={c.code} openUrl={openUrl} sureCodeId={c.id} />
              </div>
              <ul className="space-y-3 px-5 py-4 sm:px-6">
                {(c.legs ?? []).map((leg, i) => {
                  const kick = formatKick(leg.kickoff);
                  return (
                    <li
                      key={i}
                      className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                    >
                      <div>
                        <p className="font-semibold text-[var(--ink)]">
                          {leg.home}{" "}
                          <span className="font-normal text-[var(--muted)]">vs</span> {leg.away}
                        </p>
                        <p className="mt-0.5 text-[var(--muted)]">
                          {leg.pickLabel}
                          {kick ? ` · ${kick}` : ""}
                        </p>
                      </div>
                      <span className="font-mono text-base font-bold text-[var(--accent-deep)]">
                        {Number(leg.odds).toFixed(2)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {c.rationale && (
                <div className="analysis-panel mx-5 mb-5 sm:mx-6">
                  <p className="analysis-kicker">Enhanced AI analysis</p>
                  <ReadMore text={c.rationale} limit={220} />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
