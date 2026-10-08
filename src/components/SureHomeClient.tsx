"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CodeActions } from "@/components/CodeActions";
import { Icon } from "@/components/Icons";
import { useLikes } from "@/components/LikedCodes";
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
  legs: SureHomeLeg[];
  rationale: string | null;
};

type SureHomeLeg = {
  eventId?: string;
  pickCode?: string;
  home: string;
  away: string;
  pickLabel: string;
  odds: number;
  kickoff?: number;
  sport?: string;
  sportLabel?: string;
};

type Picked = { eventId: string; pickCode: string; match: string; pickLabel: string; odds: number };

type Combined = {
  code: string;
  url: string;
  totalOdds: number;
  games: number;
  skipped: { match: string; reason: string }[];
};

const legKey = (l: { eventId?: string; pickCode?: string }) => `${l.eventId}|${l.pickCode}`;

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
  initialMode = "safe",
  fromUrl = false,
}: {
  day: string;
  codes: SureHomeCode[];
  initialMode?: SureModeChoice;
  fromUrl?: boolean;
}) {
  const [mode, setMode] = useState<SureModeChoice>(initialMode);
  const [picked, setPicked] = useState<Map<string, Picked>>(() => new Map());
  const [now, setNow] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [combined, setCombined] = useState<Combined | null>(null);
  const likes = useLikes();
  const likeBarUp = (likes?.selected.size ?? 0) > 0;

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!combined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCombined(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combined]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    return codes.filter((c) => modeForSlot(c.slot) === mode);
  }, [codes, mode]);

  const selectable = useCallback(
    (l: SureHomeLeg) => Boolean(l.eventId && l.pickCode && (now == null || !l.kickoff || l.kickoff - now > 120_000)),
    [now],
  );

  const addLegs = useCallback(
    (legs: SureHomeLeg[]) => {
      const next = new Map(picked);
      let swapped = 0;
      for (const l of legs) {
        if (!l.eventId || !l.pickCode) continue;
        for (const [k, p] of next) {
          if (p.eventId === l.eventId && k !== legKey(l)) {
            next.delete(k);
            swapped++;
          }
        }
        next.set(legKey(l), {
          eventId: l.eventId,
          pickCode: l.pickCode,
          match: `${l.home} v ${l.away}`,
          pickLabel: l.pickLabel,
          odds: Number(l.odds) || 1,
        });
      }
      setPicked(next);
      if (swapped) setToast("One pick per match — swapped to the newer pick");
    },
    [picked],
  );

  const toggleLeg = useCallback(
    (l: SureHomeLeg) => {
      if (!selectable(l)) return;
      const key = legKey(l);
      if (picked.has(key)) {
        setPicked((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      } else {
        addLegs([l]);
      }
    },
    [picked, selectable, addLegs],
  );

  const toggleSlip = useCallback(
    (c: SureHomeCode) => {
      const legs = (c.legs ?? []).filter(selectable);
      if (!legs.length) return;
      const allOn = legs.every((l) => picked.has(legKey(l)));
      if (allOn) {
        setPicked((prev) => {
          const next = new Map(prev);
          legs.forEach((l) => next.delete(legKey(l)));
          return next;
        });
      } else {
        addLegs(legs);
      }
    },
    [picked, selectable, addLegs],
  );

  const pickedList = useMemo(() => [...picked.values()], [picked]);
  const pickedOdds = pickedList.reduce((a, p) => a * p.odds, 1);

  async function generate() {
    if (pickedList.length < 2 || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/sure/combine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          day,
          picks: pickedList.map((p) => ({ eventId: p.eventId, pickCode: p.pickCode })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.ok) {
        setToast(json.error || "Couldn't create the code");
        return;
      }
      setCombined({
        code: json.code,
        url: json.url,
        totalOdds: Number(json.totalOdds) || pickedOdds,
        games: Number(json.games) || pickedList.length,
        skipped: Array.isArray(json.skipped) ? json.skipped : [],
      });
      setPicked(new Map());
    } catch {
      setToast("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  const latest = filtered[0];
  const emptyBoost = mode === "boost" && filtered.length === 0;
  const emptySafe = mode === "safe" && filtered.length === 0;
  const emptyLong = mode === "longshot" && filtered.length === 0;

  return (
    <div className="sure-home">
      <SureModePicker initial={initialMode} preferInitial={fromUrl} onChange={setMode} />

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

      {filtered.length > 0 && (
        <p className="cb-hint">
          <Icon name="layers" size={15} />
          Tick games from any Sure code — across Safe, Larger and Longshot — then generate one code with all of them.
        </p>
      )}

      <div className="space-y-4">
        {filtered.map((c, idx) => {
          const openUrl = c.share_url || sportyOpenUrl(c.code);
          const conf = c.confidence != null ? Math.round(Number(c.confidence) * 100) : null;
          const leg0 = (c.legs ?? [])[0];
          const slipLegs = (c.legs ?? []).filter(selectable);
          const slipAllOn = slipLegs.length > 0 && slipLegs.every((l) => picked.has(legKey(l)));
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
              <div className="cb-slip-head">
                <span>Games in this code</span>
                {slipLegs.length > 0 && (
                  <button
                    type="button"
                    className={`cb-all${slipAllOn ? " is-on" : ""}`}
                    aria-pressed={slipAllOn}
                    onClick={() => toggleSlip(c)}
                  >
                    <Icon name={slipAllOn ? "close" : "check"} size={13} />
                    {slipAllOn ? "Unselect all" : "Select all"}
                  </button>
                )}
              </div>
              <ul className="space-y-1 px-3 pb-3 pt-1 sm:px-4">
                {(c.legs ?? []).map((leg, i) => {
                  const kick = formatKick(leg.kickoff);
                  const canPick = selectable(leg);
                  const on = picked.has(legKey(leg));
                  const started = Boolean(leg.eventId && leg.pickCode && !canPick);
                  return (
                    <li key={i} className={`cb-leg${on ? " is-on" : ""}`}>
                      <button
                        type="button"
                        className={`cb-pick${on ? " is-on" : ""}`}
                        aria-pressed={on}
                        aria-label={`${on ? "Remove" : "Add"} ${leg.home} vs ${leg.away} — ${leg.pickLabel}`}
                        disabled={!canPick}
                        title={started ? "Match already started" : on ? "Remove from your code" : "Add to your code"}
                        onClick={() => toggleLeg(leg)}
                      >
                        <Icon name="check" size={14} />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-[var(--ink)]">
                          {leg.home}{" "}
                          <span className="font-normal text-[var(--muted)]">vs</span> {leg.away}
                        </p>
                        <p className="mt-0.5 text-[var(--muted)]">
                          {leg.pickLabel}
                          {kick ? ` · ${kick}` : ""}
                          {started ? " · started" : ""}
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

      {pickedList.length > 0 && (
        <div className={`lk-bar cb-bar${likeBarUp ? " is-raised" : ""}`} role="region" aria-label="Games selected for one code">
          <span className="lk-bar-count">
            <Icon name="layers" size={15} />
            {pickedList.length} game{pickedList.length === 1 ? "" : "s"}
            <span className="cb-odds">@ {pickedOdds.toFixed(2)}</span>
          </span>
          <button
            type="button"
            className="lk-bar-btn"
            disabled={busy || pickedList.length < 2}
            title={pickedList.length < 2 ? "Pick at least 2 games" : "Book all selected games as one SportyBet code"}
            onClick={generate}
          >
            <Icon name="ticket" size={15} />
            {busy ? "Booking…" : pickedList.length < 2 ? "Pick 1 more" : "Generate one code"}
          </button>
          <button type="button" className="lk-bar-ghost" onClick={() => setPicked(new Map())}>
            Clear
          </button>
        </div>
      )}

      {toast && (
        <div className={`lk-toast cb-toast${pickedList.length ? " lk-toast-up" : ""}`} role="status">
          {toast}
        </div>
      )}

      {combined && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(29,29,31,0.35)] p-4 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cb-done-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCombined(null);
          }}
        >
          <div className="sc-card cb-done w-full max-w-md p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
                  Your combined code
                </p>
                <p id="cb-done-title" className="mt-1.5 font-mono text-3xl font-extrabold tracking-[0.14em] text-[var(--ink)]">
                  {combined.code}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {combined.games} game{combined.games === 1 ? "" : "s"} · odds{" "}
                  <span className="font-semibold text-[var(--ink)]">{combined.totalOdds.toFixed(2)}</span>
                </p>
              </div>
              <button type="button" className="sc-btn-ghost" aria-label="Close" onClick={() => setCombined(null)}>
                <Icon name="close" size={15} />
              </button>
            </div>
            {combined.skipped.length > 0 && (
              <div className="cb-skipped">
                <p>Left out:</p>
                <ul>
                  {combined.skipped.map((s, i) => (
                    <li key={i}>
                      {s.match} — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-5">
              <CodeActions code={combined.code} openUrl={combined.url} />
            </div>
            <p className="mt-4 text-xs text-[var(--muted)]">
              Combining games multiplies the odds and the risk — every game has to win. Not a guarantee.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
