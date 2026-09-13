import {
  createBookingCode,
  getSportyFixtures,
  impliedProb,
  PICKS,
  SAFE_PICK_CODES,
  sportyOpenUrl,
  type BookableLeg,
  type SbEvent,
} from "./sporty";
import { chatJson, chatPlain } from "./openai";

export type SureSlip = {
  slot: number;
  legs: BookableLeg[];
  totalOdds: number;
  confidence: number;
  rationale: string;
  code?: string;
  shareUrl?: string;
  error?: string;
};

export type PastOutcomeSample = {
  day: string;
  outcome: string;
  totalOdds?: number | null;
  legs: { home: string; away: string; pick: string; odds: number }[];
};

function legFromEventPick(ev: SbEvent, pickCode: string): BookableLeg | null {
  const meta = PICKS[pickCode];
  if (!meta) return null;
  const odds = ev.outcomes[pickCode];
  if (!odds || odds < 1.05 || odds > 2.4) return null;
  return {
    eventId: ev.eventId,
    marketId: meta.marketId,
    specifier: meta.specifier,
    outcomeId: meta.outcomeId,
    home: ev.home,
    away: ev.away,
    league: ev.league,
    kickoff: ev.kickoff,
    pickCode,
    pickLabel: meta.label.replace("Home", ev.home).replace("Away", ev.away),
    odds,
    implied: impliedProb(odds),
  };
}

function buildRationaleFallback(legs: BookableLeg[], totalOdds: number, conf: number): string {
  const names = legs.map((l) => `${l.home} vs ${l.away} (${l.pickLabel} @ ${l.odds.toFixed(2)})`);
  return (
    `High-confidence accumulator from short-priced safe markets ` +
    `(double chance, over 1.5, team over 0.5, BTTS). ` +
    `Combined odds ~${totalOdds.toFixed(2)}, model confidence ~${Math.round(conf * 100)}%. ` +
    `Legs: ${names.join("; ")}. Not a guarantee — stake only what you can afford.`
  );
}

async function maybeAiRationale(
  legs: BookableLeg[],
  totalOdds: number,
  conf: number,
): Promise<string> {
  const text = await chatPlain({
    system:
      "You explain football betting slips briefly and honestly. Never claim a lock or 100% sure win. 2-3 short sentences.",
    user: `Explain why this SportyBet slip is relatively high-confidence. Odds ${totalOdds.toFixed(2)}, conf ${Math.round(conf * 100)}%. Legs: ${JSON.stringify(
      legs.map((l) => ({
        match: `${l.home} vs ${l.away}`,
        pick: l.pickLabel,
        odds: l.odds,
      })),
    )}`,
    temperature: 0.4,
    maxTokens: 220,
  });
  return text || buildRationaleFallback(legs, totalOdds, conf);
}

type AiScoutPlan = {
  slips?: {
    slot?: number;
    rationale?: string;
    legs?: { eventId: string; pickCode: string }[];
  }[];
  notes?: string;
};

/**
 * Ask OpenAI to pick today's best safe games using live odds + recent WON/LOST history.
 * Invalid event/pick pairs are dropped; we never invent odds.
 */
async function aiScoutSlips(
  candidates: BookableLeg[],
  history: PastOutcomeSample[],
  count: number,
): Promise<SureSlip[] | null> {
  if (!process.env.OPENAI_API_KEY || candidates.length < 4) return null;

  const byEvent = new Map<string, BookableLeg[]>();
  for (const leg of candidates) {
    const list = byEvent.get(leg.eventId) ?? [];
    list.push(leg);
    byEvent.set(leg.eventId, list);
  }

  const board = [...byEvent.entries()].slice(0, 40).map(([eventId, legs]) => ({
    eventId,
    match: `${legs[0].home} vs ${legs[0].away}`,
    league: legs[0].league ?? "",
    kickoff: new Date(legs[0].kickoff).toISOString(),
    options: legs.map((l) => ({
      pickCode: l.pickCode,
      label: l.pickLabel,
      odds: Number(l.odds.toFixed(2)),
      implied: Number(l.implied.toFixed(3)),
    })),
  }));

  const hist = history.slice(0, 18).map((h) => ({
    day: h.day,
    outcome: h.outcome,
    odds: h.totalOdds,
    legs: h.legs,
  }));

  const plan = await chatJson<AiScoutPlan>({
    system: `You are SureCode's football scout for SportyBet (Nigeria).
Pick the day's SAFEST accumulators — prefer short prices and markets that historically hit.
Allowed pickCode values only: ${SAFE_PICK_CODES.join(", ")}.
Rules:
- Prefer teams/leagues that won recently in history; avoid patterns that lost (same pick style / fragile prices).
- Each slip: 3–5 legs from DIFFERENT eventIds. No duplicate matches across a slip.
- Prefer combined odds roughly 2.0–6.5 and high hit probability over big payouts.
- Never invent eventIds or pickCodes — only use options from the board.
- Be honest: not a guarantee.
Return JSON: {"slips":[{"slot":1,"rationale":"...","legs":[{"eventId":"...","pickCode":"DC1X"}]}],"notes":"..."}
Provide exactly ${count} slips when possible.`,
    user: JSON.stringify({
      goal: "Best sure codes of the day",
      historyOutcomes: hist,
      board,
      slipCount: count,
    }),
    temperature: 0.25,
    maxTokens: 1200,
  });

  if (!plan?.slips?.length) return null;

  const eventMap = new Map(candidates.map((c) => [c.eventId + "|" + c.pickCode, c]));
  const fixturesById = new Map<string, SbEvent>();
  // Rebuild from candidates uniquely
  for (const c of candidates) {
    if (!fixturesById.has(c.eventId)) {
      fixturesById.set(c.eventId, {
        eventId: c.eventId,
        home: c.home,
        away: c.away,
        league: c.league,
        kickoff: c.kickoff,
        outcomes: {},
      });
    }
    fixturesById.get(c.eventId)!.outcomes[c.pickCode] = c.odds;
  }

  const slips: SureSlip[] = [];
  for (let i = 0; i < plan.slips.length && slips.length < count; i++) {
    const raw = plan.slips[i];
    const used = new Set<string>();
    const legs: BookableLeg[] = [];
    for (const sel of raw.legs ?? []) {
      if (!sel?.eventId || !sel?.pickCode) continue;
      if (used.has(sel.eventId)) continue;
      let leg =
        eventMap.get(sel.eventId + "|" + sel.pickCode) ??
        (() => {
          const ev = fixturesById.get(sel.eventId);
          return ev ? legFromEventPick(ev, sel.pickCode) : null;
        })();
      if (!leg) continue;
      used.add(sel.eventId);
      legs.push(leg);
      if (legs.length >= 5) break;
    }
    if (legs.length < 2) continue;
    const totalOdds = legs.reduce((acc, l) => acc * l.odds, 1);
    const confidence = legs.reduce((acc, l) => acc * l.implied, 1);
    const rationale =
      (raw.rationale && raw.rationale.trim()) ||
      (await maybeAiRationale(legs, totalOdds, confidence));
    const booked = await createBookingCode(legs);
    slips.push({
      slot: slips.length + 1,
      legs,
      totalOdds,
      confidence,
      rationale,
      code: booked.code,
      shareUrl: booked.code ? booked.url || sportyOpenUrl(booked.code) : undefined,
      error: booked.error,
    });
  }

  return slips.length ? slips : null;
}

function expandCandidates(fixtures: SbEvent[]): BookableLeg[] {
  const out: BookableLeg[] = [];
  for (const ev of fixtures) {
    for (const code of SAFE_PICK_CODES) {
      const leg = legFromEventPick(ev, code);
      if (leg) out.push(leg);
    }
  }
  out.sort((a, b) => b.implied - a.implied);
  return out;
}

function heuristicSlips(candidates: BookableLeg[], count: number): Promise<SureSlip[]> {
  const usedEvents = new Set<string>();
  const usedLeagues = new Map<string, number>();
  const pool: BookableLeg[] = [];
  // One best safe pick per event for diversification
  const bestByEvent = new Map<string, BookableLeg>();
  for (const leg of candidates) {
    const cur = bestByEvent.get(leg.eventId);
    if (!cur || leg.implied > cur.implied) bestByEvent.set(leg.eventId, leg);
  }
  const ranked = [...bestByEvent.values()].sort((a, b) => b.implied - a.implied);

  for (const leg of ranked) {
    if (usedEvents.has(leg.eventId)) continue;
    const lg = leg.league || "unknown";
    if ((usedLeagues.get(lg) ?? 0) >= 2) continue;
    usedEvents.add(leg.eventId);
    usedLeagues.set(lg, (usedLeagues.get(lg) ?? 0) + 1);
    pool.push(leg);
    if (pool.length >= 24) break;
  }

  return (async () => {
    const slips: SureSlip[] = [];
    const sizes = [3, 4, 5];
    let cursor = 0;
    for (let slot = 1; slot <= count; slot++) {
      const n = sizes[(slot - 1) % sizes.length];
      const legs = pool.slice(cursor, cursor + n);
      cursor += n;
      if (legs.length < 2) break;
      const totalOdds = legs.reduce((acc, l) => acc * l.odds, 1);
      const confidence = legs.reduce((acc, l) => acc * l.implied, 1);
      const rationale = await maybeAiRationale(legs, totalOdds, confidence);
      const booked = await createBookingCode(legs);
      slips.push({
        slot,
        legs,
        totalOdds,
        confidence,
        rationale,
        code: booked.code,
        shareUrl: booked.code ? booked.url || sportyOpenUrl(booked.code) : undefined,
        error: booked.error,
      });
    }
    return slips;
  })();
}

/**
 * Build up to N sure slips for today from SportyBet live fixtures + OpenAI scout,
 * then create real share codes.
 */
export async function buildSureSlipsOfDay(
  count = 3,
  history: PastOutcomeSample[] = [],
  opts: { allowAi?: boolean } = {},
): Promise<SureSlip[]> {
  const now = Date.now();
  const fixtures = (await getSportyFixtures(6)).filter(
    (e) => e.kickoff > now + 30 * 60_000 && e.kickoff < now + 36 * 3600_000,
  );

  const candidates = expandCandidates(fixtures);
  if (candidates.length < 2) return [];

  const allowAi = opts.allowAi !== false;
  if (allowAi) {
    const ai = await aiScoutSlips(candidates, history, count);
    if (ai?.length) return ai;
  }

  return heuristicSlips(candidates, count);
}

/** Africa/Lagos calendar day YYYY-MM-DD */
export function lagosDay(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}
