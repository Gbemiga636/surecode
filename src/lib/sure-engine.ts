import {
  createBookingCode,
  getSportyFixtures,
  impliedProb,
  PICKS,
  sportyOpenUrl,
  type BookableLeg,
  type SbEvent,
} from "./sporty";
import { chatJson, chatPlain } from "./openai";
import { fixturePageBudget } from "./budget";
import {
  buildLearningSnapshot,
  formatLearningForAi,
  scoreLeg,
  type LearningSnapshot,
  type LegHistoryRow,
} from "./learning";

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

/**
 * Quality markets — not ultra-short 1.05 DC spam.
 * Fewer legs + mid prices = better combined odds.
 */
export const QUALITY_PICK_CODES = [
  "1",
  "2",
  "DC1X",
  "DCX2",
  "DNBH",
  "DNBA",
  "O15",
  "O25",
  "BTTSY",
  "HO05",
  "AO05",
] as const;

/** Per-leg odds band: skip junk shorts and wild longshots */
const MIN_LEG_ODDS = 1.32;
const MAX_LEG_ODDS = 2.45;
/** Target combined slip odds */
const MIN_SLIP_ODDS = 3.8;
const MAX_SLIP_ODDS = 14;

function legFromEventPick(ev: SbEvent, pickCode: string): BookableLeg | null {
  const meta = PICKS[pickCode];
  if (!meta) return null;
  const odds = ev.outcomes[pickCode];
  if (!odds || odds < MIN_LEG_ODDS || odds > MAX_LEG_ODDS) return null;
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

function buildRationaleFallback(
  legs: BookableLeg[],
  totalOdds: number,
  conf: number,
  advice: string[],
): string {
  const names = legs.map((l) => `${l.home} vs ${l.away} (${l.pickLabel} @ ${l.odds.toFixed(2)})`);
  const tip = advice[0] ? ` ${advice[0]}` : "";
  return (
    `${legs.length}-fold quality slip (not tiny prices). Combined odds ~${totalOdds.toFixed(2)}, ` +
    `model ~${Math.round(conf * 100)}%. Legs: ${names.join("; ")}.${tip} ` +
    `Not a guarantee — stake only what you can afford.`
  );
}

async function maybeAiRationale(
  legs: BookableLeg[],
  totalOdds: number,
  conf: number,
  advice: string[],
): Promise<string> {
  const text = await chatPlain({
    system:
      "You explain football betting slips briefly and honestly. Never claim a lock. 2 short sentences. Prefer quality over tiny odds.",
    user: `Explain this ${legs.length}-fold SportyBet slip. Odds ${totalOdds.toFixed(2)}, conf ${Math.round(conf * 100)}%. Learning: ${advice.join(" | ")}. Legs: ${JSON.stringify(
      legs.map((l) => ({ match: `${l.home} vs ${l.away}`, pick: l.pickLabel, odds: l.odds })),
    )}`,
    temperature: 0.35,
    maxTokens: 180,
  });
  return text || buildRationaleFallback(legs, totalOdds, conf, advice);
}

type AiScoutPlan = {
  slips?: {
    slot?: number;
    rationale?: string;
    legs?: { eventId: string; pickCode: string }[];
  }[];
  notes?: string;
};

async function aiScoutSlips(
  candidates: BookableLeg[],
  history: PastOutcomeSample[],
  snap: LearningSnapshot,
  count: number,
): Promise<SureSlip[] | null> {
  if (!process.env.OPENAI_API_KEY || candidates.length < 3) return null;

  const byEvent = new Map<string, BookableLeg[]>();
  for (const leg of candidates) {
    const list = byEvent.get(leg.eventId) ?? [];
    list.push(leg);
    byEvent.set(leg.eventId, list);
  }

  const board = [...byEvent.entries()]
    .map(([eventId, legs]) => {
      const scored = [...legs].sort(
        (a, b) => scoreLeg(b, snap) - scoreLeg(a, snap),
      );
      return {
        eventId,
        match: `${legs[0].home} vs ${legs[0].away}`,
        league: legs[0].league ?? "",
        kickoff: new Date(legs[0].kickoff).toISOString(),
        options: scored.slice(0, 4).map((l) => ({
          pickCode: l.pickCode,
          label: l.pickLabel,
          odds: Number(l.odds.toFixed(2)),
          score: Number(scoreLeg(l, snap).toFixed(3)),
        })),
      };
    })
    .sort(
      (a, b) => (b.options[0]?.score ?? 0) - (a.options[0]?.score ?? 0),
    )
    .slice(0, 28);

  const plan = await chatJson<AiScoutPlan>({
    system: `You are SureCode's SportyBet scout (Nigeria).
Build SHARP slips: FEWER legs, BETTER prices — users hate 5+ tiny-odds games.
Allowed pickCodes: ${QUALITY_PICK_CODES.join(", ")}.
Rules:
- Each slip: exactly 2 or 3 legs from DIFFERENT eventIds.
- Prefer combined odds ${MIN_SLIP_ODDS}–${MAX_SLIP_ODDS} (sweet spot ~5–9).
- Prefer options with higher "score" and historically strong pick/league win rates.
- Avoid ultra-short prices; pick quality mid-odds favourites / DC / O1.5 / BTTS when justified.
- Never invent eventIds or pickCodes.
Return JSON: {"slips":[{"slot":1,"rationale":"...","legs":[{"eventId":"...","pickCode":"1"}]}],"notes":"..."}
Provide exactly ${count} slips when possible.`,
    user: JSON.stringify({
      goal: "Best quality codes — fewer games, stronger odds",
      learning: formatLearningForAi(snap),
      recentSlipOutcomes: history.slice(0, 12),
      board,
      slipCount: count,
    }),
    temperature: 0.2,
    maxTokens: 1100,
  });

  if (!plan?.slips?.length) return null;

  const eventMap = new Map(candidates.map((c) => [c.eventId + "|" + c.pickCode, c]));
  const fixturesById = new Map<string, SbEvent>();
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
      const leg =
        eventMap.get(sel.eventId + "|" + sel.pickCode) ??
        (() => {
          const ev = fixturesById.get(sel.eventId);
          return ev ? legFromEventPick(ev, sel.pickCode) : null;
        })();
      if (!leg) continue;
      used.add(sel.eventId);
      legs.push(leg);
      if (legs.length >= 3) break;
    }
    if (legs.length < 2) continue;
    const totalOdds = legs.reduce((acc, l) => acc * l.odds, 1);
    if (totalOdds < MIN_SLIP_ODDS * 0.85 || totalOdds > MAX_SLIP_ODDS * 1.15) {
      // Soft reject extreme slips
      if (totalOdds < 2.8 || totalOdds > 18) continue;
    }
    const confidence = legs.reduce((acc, l) => acc * l.implied, 1);
    const rationale =
      (raw.rationale && raw.rationale.trim()) ||
      (await maybeAiRationale(legs, totalOdds, confidence, snap.advice));
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
    for (const code of QUALITY_PICK_CODES) {
      const leg = legFromEventPick(ev, code);
      if (leg) out.push(leg);
    }
  }
  return out;
}

function heuristicSlips(
  candidates: BookableLeg[],
  snap: LearningSnapshot,
  count: number,
): Promise<SureSlip[]> {
  const ranked = [...candidates].sort(
    (a, b) => scoreLeg(b, snap) - scoreLeg(a, snap),
  );

  const usedEvents = new Set<string>();
  const usedLeagues = new Map<string, number>();
  const pool: BookableLeg[] = [];
  for (const leg of ranked) {
    if (usedEvents.has(leg.eventId)) continue;
    const lg = leg.league || "unknown";
    if ((usedLeagues.get(lg) ?? 0) >= 2) continue;
    usedEvents.add(leg.eventId);
    usedLeagues.set(lg, (usedLeagues.get(lg) ?? 0) + 1);
    pool.push(leg);
    if (pool.length >= 18) break;
  }

  return (async () => {
    const slips: SureSlip[] = [];
    // 2-fold, 3-fold, 2-fold — fewer games
    const sizes = [2, 3, 2];
    let cursor = 0;
    for (let slot = 1; slot <= count; slot++) {
      const n = sizes[(slot - 1) % sizes.length];
      let legs = pool.slice(cursor, cursor + n);
      cursor += n;
      if (legs.length < 2) break;

      let totalOdds = legs.reduce((acc, l) => acc * l.odds, 1);
      // If too short, try swap last leg for higher odds from remaining pool
      if (totalOdds < MIN_SLIP_ODDS && cursor < pool.length) {
        const alt = pool[cursor];
        if (alt && !legs.some((l) => l.eventId === alt.eventId)) {
          legs = [...legs.slice(0, -1), alt];
          cursor++;
          totalOdds = legs.reduce((acc, l) => acc * l.odds, 1);
        }
      }

      const confidence = legs.reduce((acc, l) => acc * l.implied, 1);
      const rationale = await maybeAiRationale(
        legs,
        totalOdds,
        confidence,
        snap.advice,
      );
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

export async function buildSureSlipsOfDay(
  count = 3,
  history: PastOutcomeSample[] = [],
  opts: { allowAi?: boolean; legHistory?: LegHistoryRow[] } = {},
): Promise<SureSlip[]> {
  const now = Date.now();
  const fixtures = (await getSportyFixtures(fixturePageBudget())).filter(
    (e) => e.kickoff > now + 30 * 60_000 && e.kickoff < now + 36 * 3600_000,
  );

  const snap = buildLearningSnapshot(opts.legHistory ?? []);
  const candidates = expandCandidates(fixtures);
  if (candidates.length < 2) return [];

  // Prefer historically strong markets when we have enough data
  const scored = [...candidates].sort(
    (a, b) => scoreLeg(b, snap) - scoreLeg(a, snap),
  );

  const allowAi = opts.allowAi !== false;
  if (allowAi) {
    const ai = await aiScoutSlips(scored, history, snap, count);
    if (ai?.length) return ai;
  }

  return heuristicSlips(scored, snap, count);
}

export function lagosDay(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}
