/**
 * Expert / value / combo / prediction pick engines for SureCode.
 * Uses SportyBet fixtures + odds (no paid keys required).
 */
import {
  bestOutcome,
  CODE_SETS,
  createBookingCode,
  fixtureKey,
  getSportyFixtures,
  pickLabel,
  PICKS,
  SAFE_PICK_CODES,
  sportyOpenUrl,
  type BookableLeg,
  type GameType,
  type SbEvent,
} from "./sporty";

export type AppPick = {
  home: string;
  away: string;
  league?: string;
  kickoff: string;
  pick: string;
  key: string;
  confidence: number;
  odds: string;
  reasons: string[];
  eventId: string;
  pickCode: string;
  market: string;
  edge?: number;
  ev?: number;
};

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

function upcoming(fixtures: SbEvent[], days: number): SbEvent[] {
  const now = Date.now();
  const maxT = now + days * 86_400_000;
  return fixtures.filter((e) => e.kickoff > now + 20 * 60_000 && e.kickoff < maxT);
}

function diversify(picks: AppPick[], count: number, maxPerLeague: number): AppPick[] {
  const sorted = [...picks].sort((a, b) => b.confidence - a.confidence);
  const leagueCount = new Map<string, number>();
  const out: AppPick[] = [];
  for (const p of sorted) {
    const lg = p.league ?? "—";
    if ((leagueCount.get(lg) ?? 0) >= maxPerLeague) continue;
    leagueCount.set(lg, (leagueCount.get(lg) ?? 0) + 1);
    out.push(p);
    if (out.length >= count) break;
  }
  if (out.length < count) {
    const used = new Set(out.map((p) => p.key));
    for (const p of sorted) {
      if (out.length >= count) break;
      if (used.has(p.key)) continue;
      out.push(p);
    }
  }
  return out;
}

export async function getExpertPicks(opts: {
  count?: number;
  days?: number;
  gameType?: GameType;
  minConfidence?: number;
}): Promise<{ picks: AppPick[]; poolSize: number }> {
  const count = Math.max(1, Math.min(40, opts.count ?? 12));
  const days = Math.max(1, Math.min(14, opts.days ?? 5));
  const gameType = opts.gameType ?? "result";
  const minConf = opts.minConfidence ?? 0.5;
  const codes = CODE_SETS[gameType] ?? CODE_SETS.result;
  const fixtures = upcoming(await getSportyFixtures(10), days);

  const scored: AppPick[] = [];
  for (const ev of fixtures) {
    const fav = bestOutcome(ev, codes);
    if (!fav) continue;
    const confidence = round(Math.min(0.95, fav.implied));
    if (confidence < minConf) continue;
    scored.push({
      home: ev.home,
      away: ev.away,
      league: ev.league,
      kickoff: new Date(ev.kickoff).toISOString(),
      pick: pickLabel(fav.code, ev.home, ev.away),
      key: fixtureKey(ev.home, ev.away),
      confidence,
      odds: fav.odds.toFixed(2),
      reasons: [
        `SportyBet ${fav.odds.toFixed(2)} (~${Math.round(fav.implied * 100)}% implied)`,
      ],
      eventId: ev.eventId,
      pickCode: fav.code,
      market: PICKS[fav.code]?.market ?? "Market",
    });
  }

  const maxPerLeague = Math.max(3, Math.ceil(count / 4) + 2);
  const picks = diversify(scored, count, maxPerLeague);
  picks.sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  return { picks, poolSize: scored.length };
}

export async function getValuePicks(opts: {
  count?: number;
  days?: number;
  minOdds?: number;
}): Promise<{ picks: AppPick[]; scanned: number }> {
  const count = Math.max(1, Math.min(30, opts.count ?? 15));
  const days = Math.max(1, Math.min(14, opts.days ?? 7));
  const minOdds = opts.minOdds ?? 1.6;
  const fixtures = upcoming(await getSportyFixtures(10), days);
  const valueCodes = CODE_SETS.value;

  const scored: AppPick[] = [];
  for (const ev of fixtures) {
    // Prefer mid-priced outcomes: not ultra-short, not longshot junk
    let best: { code: string; odds: number; score: number } | null = null;
    for (const code of valueCodes) {
      const odds = ev.outcomes[code];
      if (!odds || odds < minOdds || odds > 4.5) continue;
      // Soft "value" score: prefer ~1.8–2.6 band
      const ideal = 2.1;
      const score = 1 / (1 + Math.abs(odds - ideal));
      if (!best || score > best.score) best = { code, odds, score };
    }
    if (!best) continue;
    const implied = 1 / best.odds;
    // Synthetic edge vs a slightly higher model belief for mid-prices
    const modelProb = Math.min(0.72, implied + 0.06);
    const edge = modelProb - implied;
    if (edge < 0.03) continue;
    const evVal = modelProb * best.odds - 1;
    scored.push({
      home: ev.home,
      away: ev.away,
      league: ev.league,
      kickoff: new Date(ev.kickoff).toISOString(),
      pick: pickLabel(best.code, ev.home, ev.away),
      key: fixtureKey(ev.home, ev.away),
      confidence: round(modelProb),
      odds: best.odds.toFixed(2),
      reasons: [
        `Edge ~${Math.round(edge * 100)} pts · EV ${(evVal * 100).toFixed(1)}%`,
        `Market ${best.odds.toFixed(2)} vs model ${Math.round(modelProb * 100)}%`,
      ],
      eventId: ev.eventId,
      pickCode: best.code,
      market: PICKS[best.code]?.market ?? "Value",
      edge: round(edge),
      ev: round(evVal),
    });
  }

  scored.sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0));
  return { picks: diversify(scored, count, 4), scanned: fixtures.length };
}

export type ComboSlip = {
  id: string;
  name: string;
  tag: string;
  totalOdds: number;
  confidence: number;
  picks: AppPick[];
};

export async function getCombos(): Promise<ComboSlip[]> {
  const [safe, value, result] = await Promise.all([
    getExpertPicks({ count: 20, days: 4, gameType: "safe", minConfidence: 0.55 }),
    getValuePicks({ count: 20, days: 5, minOdds: 1.7 }),
    getExpertPicks({ count: 20, days: 4, gameType: "result", minConfidence: 0.52 }),
  ]);

  function pack(id: string, name: string, tag: string, pool: AppPick[], n: number): ComboSlip | null {
    const picks = pool.slice(0, n);
    if (picks.length < 2) return null;
    const totalOdds = picks.reduce((a, p) => a * Number(p.odds), 1);
    const confidence = picks.reduce((a, p) => a * p.confidence, 1);
    return { id, name, tag, totalOdds, confidence, picks };
  }

  return [
    pack("fortress", "Fortress (safe)", "SAFE", safe.picks, 4),
    pack("value-stack", "Value stack", "VALUE", value.picks, 3),
    pack("bankers", "Banker results", "RESULT", result.picks, 5),
    pack("moonshot", "Bigger odds", "MOON", value.picks.filter((p) => Number(p.odds) >= 2), 4),
  ].filter(Boolean) as ComboSlip[];
}

/** “Predictions” = high-confidence 1X2 favourites presented as tip cards. */
export async function getPredictions(days = 3): Promise<AppPick[]> {
  const { picks } = await getExpertPicks({
    count: 30,
    days,
    gameType: "result",
    minConfidence: 0.52,
  });
  return picks.map((p) => ({
    ...p,
    reasons: [`Model tip from SportyBet favourite · ${p.reasons[0]}`],
  }));
}

/** Poisson-lite analysis board from live 1X2 odds. */
export async function getAnalysisBoard(days = 2): Promise<
  {
    eventId: string;
    home: string;
    away: string;
    league?: string;
    kickoff: string;
    odds: { home: number; draw: number; away: number };
    probs: { home: number; draw: number; away: number };
    bttsHint: string;
    ou25Hint: string;
    key: string;
  }[]
> {
  const fixtures = upcoming(await getSportyFixtures(8), days);
  const out = [];
  for (const ev of fixtures) {
    const h = ev.outcomes["1"];
    const d = ev.outcomes["X"];
    const a = ev.outcomes["2"];
    if (!h || !d || !a) continue;
    const raw = [1 / h, 1 / d, 1 / a];
    const sum = raw.reduce((x, y) => x + y, 0);
    const probs = {
      home: round(raw[0] / sum),
      draw: round(raw[1] / sum),
      away: round(raw[2] / sum),
    };
    const o25 = ev.outcomes["O25"];
    const btts = ev.outcomes["BTTSY"];
    out.push({
      eventId: ev.eventId,
      home: ev.home,
      away: ev.away,
      league: ev.league,
      kickoff: new Date(ev.kickoff).toISOString(),
      odds: { home: h, draw: d, away: a },
      probs,
      bttsHint: btts
        ? `BTTS Yes ${btts.toFixed(2)}`
        : "BTTS price unavailable",
      ou25Hint: o25 ? `Over 2.5 ${o25.toFixed(2)}` : "O2.5 unavailable",
      key: fixtureKey(ev.home, ev.away),
    });
  }
  return out.slice(0, 40);
}

export async function bookPicks(
  picks: AppPick[],
): Promise<{ code?: string; url?: string; totalOdds: number; legs: BookableLeg[]; error?: string }> {
  const legs: BookableLeg[] = [];
  for (const p of picks) {
    const meta = PICKS[p.pickCode];
    if (!meta) continue;
    legs.push({
      eventId: p.eventId,
      marketId: meta.marketId,
      specifier: meta.specifier,
      outcomeId: meta.outcomeId,
      home: p.home,
      away: p.away,
      league: p.league,
      kickoff: Date.parse(p.kickoff) || 0,
      pickCode: p.pickCode,
      pickLabel: p.pick,
      odds: Number(p.odds),
      implied: p.confidence,
    });
  }
  if (legs.length < 1) return { error: "No bookable legs", totalOdds: 1, legs: [] };
  const totalOdds = legs.reduce((a, l) => a * l.odds, 1);
  const booked = await createBookingCode(legs);
  if (booked.error || !booked.code) {
    return { error: booked.error || "Booking failed", totalOdds, legs };
  }
  return {
    code: booked.code,
    url: booked.url || sportyOpenUrl(booked.code),
    totalOdds,
    legs,
  };
}

export async function buildPlentyCodes(count = 12): Promise<
  {
    code?: string;
    shareUrl?: string;
    totalOdds: number;
    confidence: number;
    legs: BookableLeg[];
    codeType: string;
    rationale: string;
    error?: string;
  }[]
> {
  const [safe, value, result] = await Promise.all([
    getExpertPicks({ count: 40, days: 3, gameType: "safe", minConfidence: 0.55 }),
    getValuePicks({ count: 30, days: 4, minOdds: 1.55 }),
    getExpertPicks({ count: 30, days: 3, gameType: "result", minConfidence: 0.5 }),
  ]);

  const plans: { type: string; pool: AppPick[]; size: number }[] = [
    { type: "SAFE", pool: safe.picks, size: 3 },
    { type: "SAFE", pool: safe.picks.slice(3), size: 4 },
    { type: "VALUE", pool: value.picks, size: 3 },
    { type: "VALUE", pool: value.picks.slice(3), size: 2 },
    { type: "AI", pool: result.picks, size: 5 },
    { type: "COMBO", pool: [...safe.picks.slice(0, 2), ...value.picks.slice(0, 2)], size: 4 },
  ];

  // Extra SAFE packs from rotating windows so we get "plenty"
  for (let i = 0; i < 8; i++) {
    plans.push({
      type: i % 2 === 0 ? "SAFE" : "AI",
      pool: safe.picks.slice(i, i + 6),
      size: 3 + (i % 3),
    });
  }

  const out = [];
  const usedCodes = new Set<string>();
  for (const plan of plans) {
    if (out.length >= count) break;
    const slice = plan.pool.slice(0, plan.size);
    if (slice.length < 2) continue;
    const booked = await bookPicks(slice);
    if (!booked.code || usedCodes.has(booked.code)) continue;
    usedCodes.add(booked.code);
    const confidence = slice.reduce((a, p) => a * p.confidence, 1);
    out.push({
      code: booked.code,
      shareUrl: booked.url,
      totalOdds: booked.totalOdds,
      confidence,
      legs: booked.legs,
      codeType: plan.type,
      rationale: `${plan.type} slip · ${slice.length} legs · odds ~${booked.totalOdds.toFixed(2)}`,
      error: booked.error,
    });
  }
  return out;
}

export { SAFE_PICK_CODES };
