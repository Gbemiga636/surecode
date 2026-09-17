/**
 * Edit / rebuild long SportyBet share codes into shorter, higher-probability slips.
 */
import { createClient } from "@supabase/supabase-js";
import { T } from "./db";
import {
  buildLearningSnapshot,
  scoreLeg,
  type LegHistoryRow,
} from "./learning";
import {
  createBookingCode,
  fetchShareCode,
  getSportyFixtures,
  impliedProb,
  PICKS,
  pickLabel,
  sportyOpenUrl,
  type BookableLeg,
  type ShareSelection,
} from "./sporty";
import { QUALITY_PICK_CODES } from "./sure-engine";

export type EditAlt = {
  label: string;
  rationale: string;
  legs: BookableLeg[];
  totalOdds: number;
  confidence: number;
  code?: string;
  shareUrl?: string;
  error?: string;
};

export type EditResult = {
  ok: boolean;
  sourceCode: string;
  sourceGames: number;
  sourceOdds?: number;
  kept: number;
  dropped: { reason: string; match: string; pick: string }[];
  originals: {
    match: string;
    pick: string;
    odds: number;
    status: "LIVE" | "STARTED" | "WEAK";
    score: number;
  }[];
  alts: EditAlt[];
  error?: string;
};

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadSnap() {
  const sb = admin();
  if (!sb) return buildLearningSnapshot([]);
  const { data } = await sb
    .from(T.legHistory)
    .select(
      "event_id, home, away, league, pick_code, pick_label, odds, home_score, away_score, won",
    )
    .order("settled_at", { ascending: false })
    .limit(1200);
  return buildLearningSnapshot((data ?? []) as LegHistoryRow[]);
}

/** Prefer a safer/higher-prob market on the same fixture when available. */
function upgradePick(leg: BookableLeg, outcomes: Record<string, number>): BookableLeg {
  const upgrades = ["DC1X", "DCX2", "O15", "DNBH", "DNBA", "HO05", "AO05", "1", "2"];
  let best: BookableLeg | null = null;
  for (const code of upgrades) {
    const odds = outcomes[code];
    if (!odds || odds < 1.25 || odds > 2.2) continue;
    // Prefer home-side upgrades when original was home-leaning
    if (leg.pickCode === "1" || leg.pickCode === "DC1X" || leg.pickCode === "DNBH" || leg.pickCode === "HO05") {
      if (!["1", "DC1X", "DNBH", "HO05", "O15"].includes(code)) continue;
    }
    if (leg.pickCode === "2" || leg.pickCode === "DCX2" || leg.pickCode === "DNBA" || leg.pickCode === "AO05") {
      if (!["2", "DCX2", "DNBA", "AO05", "O15"].includes(code)) continue;
    }
    const meta = PICKS[code];
    if (!meta) continue;
    const candidate: BookableLeg = {
      ...leg,
      marketId: meta.marketId,
      specifier: meta.specifier,
      outcomeId: meta.outcomeId,
      pickCode: code,
      pickLabel: pickLabel(code, leg.home, leg.away),
      odds,
      implied: impliedProb(odds),
    };
    if (!best || candidate.implied > best.implied) best = candidate;
  }
  // Keep original if it's already solid mid-price
  if (leg.odds >= 1.32 && leg.odds <= 2.1 && leg.implied >= (best?.implied ?? 0) * 0.92) {
    return leg;
  }
  return best ?? leg;
}

function selToLeg(s: ShareSelection): BookableLeg | null {
  if (!s.pickCode || !PICKS[s.pickCode]) return null;
  const meta = PICKS[s.pickCode];
  const odds = s.odds > 1 ? s.odds : 0;
  if (odds <= 1) return null;
  return {
    eventId: s.eventId,
    marketId: meta.marketId,
    specifier: meta.specifier,
    outcomeId: meta.outcomeId,
    home: s.home,
    away: s.away,
    league: s.league,
    kickoff: s.kickoff,
    pickCode: s.pickCode,
    pickLabel: s.pickLabel || pickLabel(s.pickCode, s.home, s.away),
    odds,
    implied: impliedProb(odds),
  };
}

async function bookAlt(
  label: string,
  rationale: string,
  legs: BookableLeg[],
): Promise<EditAlt> {
  const totalOdds = legs.reduce((a, l) => a * l.odds, 1);
  const confidence = legs.reduce((a, l) => a * l.implied, 1);
  const booked = await createBookingCode(legs);
  return {
    label,
    rationale,
    legs,
    totalOdds,
    confidence,
    code: booked.code,
    shareUrl: booked.code ? booked.url || sportyOpenUrl(booked.code) : undefined,
    error: booked.error,
  };
}

/**
 * Load a long share code, drop started/weak legs, upgrade picks, book 2–3 shorter alts.
 */
export async function editLongCode(rawCode: string): Promise<EditResult> {
  const loaded = await fetchShareCode(rawCode);
  if (loaded.error || !loaded.selections.length) {
    // Fallback: code stored in our DB
    const sb = admin();
    if (sb && loaded.code) {
      const { data } = await sb
        .from(T.pastCodes)
        .select("code, legs, total_odds")
        .eq("code", loaded.code)
        .order("day", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.legs && Array.isArray(data.legs) && data.legs.length) {
        const legs = data.legs as BookableLeg[];
        return rebuildFromLegs(loaded.code, legs, Number(data.total_odds) || undefined);
      }
      const { data: sure } = await sb
        .from(T.sureCodes)
        .select("code, legs, total_odds")
        .eq("code", loaded.code)
        .limit(1)
        .maybeSingle();
      if (sure?.legs && Array.isArray(sure.legs) && sure.legs.length) {
        return rebuildFromLegs(loaded.code, sure.legs as BookableLeg[], Number(sure.total_odds) || undefined);
      }
    }
    return {
      ok: false,
      sourceCode: loaded.code || rawCode.trim(),
      sourceGames: 0,
      kept: 0,
      dropped: [],
      originals: [],
      alts: [],
      error: loaded.error || "No selections found for that code",
    };
  }

  const now = Date.now();
  const fixtures = await getSportyFixtures(8);
  const byId = new Map(fixtures.map((f) => [f.eventId, f]));
  const snap = await loadSnap();

  const dropped: EditResult["dropped"] = [];
  const scored: { leg: BookableLeg; score: number; status: "LIVE" | "WEAK" }[] = [];
  const originals: EditResult["originals"] = [];

  for (const sel of loaded.selections) {
    const match = `${sel.home} vs ${sel.away}`;
    const kickoff = sel.kickoff || byId.get(sel.eventId)?.kickoff || 0;
    if (kickoff && kickoff <= now + 5 * 60_000) {
      dropped.push({ reason: "Already started / too close", match, pick: sel.pickLabel });
      originals.push({
        match,
        pick: sel.pickLabel,
        odds: sel.odds,
        status: "STARTED",
        score: 0,
      });
      continue;
    }

    let leg = selToLeg(sel);
    const ev = byId.get(sel.eventId);
    if (ev) {
      // refresh live odds + allow upgrade
      if (leg?.pickCode && ev.outcomes[leg.pickCode]) {
        leg = {
          ...leg,
          odds: ev.outcomes[leg.pickCode],
          implied: impliedProb(ev.outcomes[leg.pickCode]),
          kickoff: ev.kickoff,
          league: ev.league || leg.league,
        };
      }
      if (leg) leg = upgradePick(leg, ev.outcomes);
    }

    if (!leg) {
      dropped.push({ reason: "Unsupported / unpriced market", match, pick: sel.pickLabel });
      continue;
    }

    // Only quality band
    if (!QUALITY_PICK_CODES.includes(leg.pickCode as (typeof QUALITY_PICK_CODES)[number])) {
      // still allow if mid-odds
      if (leg.odds < 1.28 || leg.odds > 2.6) {
        dropped.push({ reason: "Odds outside quality band", match, pick: leg.pickLabel });
        originals.push({
          match,
          pick: leg.pickLabel,
          odds: leg.odds,
          status: "WEAK",
          score: scoreLeg(leg, snap),
        });
        continue;
      }
    }

    const sc = scoreLeg(leg, snap);
    const status: "LIVE" | "WEAK" = sc < 1.35 || leg.odds < 1.28 ? "WEAK" : "LIVE";
    originals.push({
      match,
      pick: leg.pickLabel,
      odds: leg.odds,
      status,
      score: Number(sc.toFixed(3)),
    });
    if (status === "WEAK") {
      dropped.push({ reason: "Low model / history score", match, pick: leg.pickLabel });
      continue;
    }
    scored.push({ leg, score: sc, status });
  }

  scored.sort((a, b) => b.score - a.score);
  // unique events
  const unique: BookableLeg[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    if (seen.has(row.leg.eventId)) continue;
    seen.add(row.leg.eventId);
    unique.push(row.leg);
  }

  if (unique.length < 2) {
    return {
      ok: false,
      sourceCode: loaded.code,
      sourceGames: loaded.selections.length,
      sourceOdds: loaded.totalOdds,
      kept: unique.length,
      dropped,
      originals,
      alts: [],
      error:
        unique.length === 0
          ? "No upcoming quality legs left to rebuild. Try a fresher long code."
          : "Need at least 2 still-open quality games to book a new code.",
    };
  }

  const alts: EditAlt[] = [];
  // Safe 2-fold
  if (unique.length >= 2) {
    alts.push(
      await bookAlt(
        "Safe 2-fold",
        "Top 2 highest-probability remaining legs — fewer games, sharper hit chance.",
        unique.slice(0, 2),
      ),
    );
  }
  // Balanced 3-fold
  if (unique.length >= 3) {
    alts.push(
      await bookAlt(
        "Balanced 3-fold",
        "Best 3 quality legs for stronger combined odds while staying selective.",
        unique.slice(0, 3),
      ),
    );
  }
  // Value 2-fold from next best if enough pool
  if (unique.length >= 4) {
    const valuePair = [unique[1], unique[3]].filter(Boolean) as BookableLeg[];
    if (valuePair.length === 2) {
      alts.push(
        await bookAlt(
          "Value 2-fold",
          "Alternate pairing for a bit more price without stacking the whole long slip.",
          valuePair,
        ),
      );
    }
  }

  return {
    ok: alts.some((a) => Boolean(a.code)),
    sourceCode: loaded.code,
    sourceGames: loaded.selections.length,
    sourceOdds: loaded.totalOdds,
    kept: unique.length,
    dropped,
    originals,
    alts,
  };
}

async function rebuildFromLegs(
  code: string,
  legs: BookableLeg[],
  totalOdds?: number,
): Promise<EditResult> {
  // Re-run through live fixtures path by synthesizing share selections
  const fake: ShareSelection[] = legs.map((l) => ({
    eventId: l.eventId,
    marketId: l.marketId,
    specifier: l.specifier,
    outcomeId: l.outcomeId,
    home: l.home,
    away: l.away,
    league: l.league,
    kickoff: l.kickoff,
    odds: l.odds,
    pickCode: l.pickCode,
    pickLabel: l.pickLabel,
  }));
  // Mutate via internal path: call core with injected selections by temp wrapping
  // Easiest: duplicate scoring using same helpers
  const now = Date.now();
  const fixtures = await getSportyFixtures(8);
  const byId = new Map(fixtures.map((f) => [f.eventId, f]));
  const snap = await loadSnap();
  const dropped: EditResult["dropped"] = [];
  const scored: { leg: BookableLeg; score: number }[] = [];
  const originals: EditResult["originals"] = [];

  for (const sel of fake) {
    const match = `${sel.home} vs ${sel.away}`;
    const kickoff = sel.kickoff || byId.get(sel.eventId)?.kickoff || 0;
    if (kickoff && kickoff <= now + 5 * 60_000) {
      dropped.push({ reason: "Already started / too close", match, pick: sel.pickLabel });
      originals.push({ match, pick: sel.pickLabel, odds: sel.odds, status: "STARTED", score: 0 });
      continue;
    }
    let leg = selToLeg(sel);
    const ev = byId.get(sel.eventId);
    if (ev && leg) {
      if (ev.outcomes[leg.pickCode]) {
        leg = {
          ...leg,
          odds: ev.outcomes[leg.pickCode],
          implied: impliedProb(ev.outcomes[leg.pickCode]),
          kickoff: ev.kickoff,
          league: ev.league || leg.league,
        };
      }
      leg = upgradePick(leg, ev.outcomes);
    }
    if (!leg) continue;
    const sc = scoreLeg(leg, snap);
    originals.push({
      match,
      pick: leg.pickLabel,
      odds: leg.odds,
      status: sc < 1.35 ? "WEAK" : "LIVE",
      score: Number(sc.toFixed(3)),
    });
    if (sc >= 1.35) scored.push({ leg, score: sc });
    else dropped.push({ reason: "Low model / history score", match, pick: leg.pickLabel });
  }

  scored.sort((a, b) => b.score - a.score);
  const unique: BookableLeg[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    if (seen.has(row.leg.eventId)) continue;
    seen.add(row.leg.eventId);
    unique.push(row.leg);
  }

  const alts: EditAlt[] = [];
  if (unique.length >= 2) {
    alts.push(
      await bookAlt("Safe 2-fold", "Top 2 from your saved code.", unique.slice(0, 2)),
    );
  }
  if (unique.length >= 3) {
    alts.push(
      await bookAlt("Balanced 3-fold", "Best 3 quality legs.", unique.slice(0, 3)),
    );
  }

  return {
    ok: alts.some((a) => Boolean(a.code)),
    sourceCode: code,
    sourceGames: legs.length,
    sourceOdds: totalOdds,
    kept: unique.length,
    dropped,
    originals,
    alts,
    error: unique.length < 2 ? "Need at least 2 open quality games." : undefined,
  };
}
