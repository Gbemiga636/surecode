/**
 * High-hit SureCode engine.
 * Priority = win rate. Singles + rare 2-folds after full 1X2 + history analysis.
 */
import {
  createBookingCode,
  getSportyFixtures,
  impliedProb,
  PICKS,
  sportyOpenUrl,
  type BookableLeg,
  type SbEvent,
} from "./sporty";
import { chatPlain } from "./openai";
import { fixturePageBudget } from "./budget";
import {
  buildLearningSnapshot,
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
 * Elite high-hit markets (no BTTS / O2.5 / longshot 1X2 in sure slips).
 * O05 included — highest-hit totals line when market is priced.
 */
export const QUALITY_PICK_CODES = [
  "O05",
  "DC1X",
  "DCX2",
  "O15",
  "HO05",
  "AO05",
  "DNBH",
  "DNBA",
] as const;

const MIN_LEG_ODDS = 1.12;
const MAX_LEG_ODDS = 1.78;
const MAX_DOUBLE_ODDS = 2.95;
const MIN_LEG_SCORE = 1.2;
const MIN_FAV_EDGE = 0.055;

type AnalyzedLeg = BookableLeg & {
  score: number;
  analysis: string[];
  favSide: "home" | "away" | "coin";
  marketImplied: number;
};

function deVig1x2(ev: SbEvent): { home: number; draw: number; away: number } | null {
  const h = ev.outcomes["1"];
  const d = ev.outcomes.X;
  const a = ev.outcomes["2"];
  if (!h || !d || !a) return null;
  const ih = 1 / h;
  const id = 1 / d;
  const ia = 1 / a;
  const s = ih + id + ia;
  if (s <= 0) return null;
  return { home: ih / s, draw: id / s, away: ia / s };
}

function analyzeEventPick(ev: SbEvent, pickCode: string, snap: LearningSnapshot): AnalyzedLeg | null {
  const meta = PICKS[pickCode];
  if (!meta) return null;
  const odds = ev.outcomes[pickCode];
  if (!odds || odds < MIN_LEG_ODDS || odds > MAX_LEG_ODDS) return null;

  const probs = deVig1x2(ev);
  const analysis: string[] = [];
  let favSide: "home" | "away" | "coin" = "coin";

  if (probs) {
    if (probs.home - probs.away >= MIN_FAV_EDGE) favSide = "home";
    else if (probs.away - probs.home >= MIN_FAV_EDGE) favSide = "away";

    analysis.push(
      `1X2 de-vig H ${Math.round(probs.home * 100)}% / D ${Math.round(probs.draw * 100)}% / A ${Math.round(probs.away * 100)}%`,
    );

    if (pickCode === "DC1X" || pickCode === "DNBH" || pickCode === "HO05") {
      if (favSide !== "home") {
        analysis.push("Rejected: not a clear home favourite");
        return null;
      }
      if (probs.home < 0.4) {
        analysis.push("Rejected: home win prob too low");
        return null;
      }
    }
    if (pickCode === "DCX2" || pickCode === "DNBA" || pickCode === "AO05") {
      if (favSide !== "away") {
        analysis.push("Rejected: not a clear away favourite");
        return null;
      }
      if (probs.away < 0.4) {
        analysis.push("Rejected: away win prob too low");
        return null;
      }
    }

    if (pickCode === "O05") {
      if (odds > 1.35) {
        analysis.push("Rejected: Over 0.5 priced too long");
        return null;
      }
      analysis.push("Totals: Over 0.5 is elite hit market");
    }

    if (pickCode === "O15") {
      const o25 = ev.outcomes.O25;
      if (probs.draw > 0.34 && (!o25 || o25 > 2.55)) {
        analysis.push("Rejected: draw-heavy / low-goal profile for Over 1.5");
        return null;
      }
      if (odds > 1.62) {
        analysis.push("Rejected: Over 1.5 price too long");
        return null;
      }
      analysis.push("Totals: market supports goals");
    }

    // Coin-flip: still allow O05 (almost always hits) but skip directional markets
    if (favSide === "coin" && pickCode !== "O05" && pickCode !== "O15") {
      analysis.push("Knife-edge match — skipped for directional markets");
      return null;
    }
  } else {
    analysis.push("No full 1X2 book — limited analysis");
    if (!["O05", "O15"].includes(pickCode)) return null;
  }

  const leg: BookableLeg = {
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

  // Soft history gates — only when sample is large enough to trust
  const pickStat = snap.byPick.find((p) => p.pickCode === pickCode);
  if (pickStat && pickStat.plays >= 25 && pickStat.winRate < 0.52) {
    analysis.push(
      `Rejected: ${pickCode} historical win rate ${Math.round(pickStat.winRate * 100)}% < 52%`,
    );
    return null;
  }
  const lgStat = snap.byLeaguePick.find(
    (p) => p.league === (ev.league || "unknown") && p.pickCode === pickCode,
  );
  if (lgStat && lgStat.plays >= 12 && lgStat.winRate < 0.48) {
    analysis.push(
      `Rejected: weak in ${ev.league} for ${pickCode} (${Math.round(lgStat.winRate * 100)}%)`,
    );
    return null;
  }

  let score = scoreLeg(leg, snap);
  if (probs && favSide === "home" && ["DC1X", "DNBH", "HO05"].includes(pickCode)) {
    score += probs.home * 0.85;
    analysis.push("Aligned with home favourite");
  }
  if (probs && favSide === "away" && ["DCX2", "DNBA", "AO05"].includes(pickCode)) {
    score += probs.away * 0.85;
    analysis.push("Aligned with away favourite");
  }
  if (pickCode === "O05") score += 0.45;
  if (odds <= 1.35) score += 0.4;
  else if (odds <= 1.5) score += 0.2;

  if (score < MIN_LEG_SCORE) {
    analysis.push(`Rejected: score ${score.toFixed(2)} below ${MIN_LEG_SCORE}`);
    return null;
  }

  if (pickStat && pickStat.plays >= 8) {
    analysis.push(
      `History ${pickCode}: ${Math.round(pickStat.winRate * 100)}% of ${pickStat.plays}`,
    );
  }

  return {
    ...leg,
    score,
    analysis,
    favSide,
    marketImplied: leg.implied,
  };
}

function buildPool(fixtures: SbEvent[], snap: LearningSnapshot): AnalyzedLeg[] {
  const pool: AnalyzedLeg[] = [];
  const usedEvents = new Set<string>();

  const all: AnalyzedLeg[] = [];
  for (const ev of fixtures) {
    for (const code of QUALITY_PICK_CODES) {
      const a = analyzeEventPick(ev, code, snap);
      if (a) all.push(a);
    }
  }
  all.sort((a, b) => b.score - a.score);

  const leagueCount = new Map<string, number>();
  for (const leg of all) {
    if (usedEvents.has(leg.eventId)) continue;
    const bestForEvent = all
      .filter((x) => x.eventId === leg.eventId)
      .sort((a, b) => b.score - a.score)[0];
    if (bestForEvent.pickCode !== leg.pickCode) continue;

    const lg = leg.league || "unknown";
    if ((leagueCount.get(lg) ?? 0) >= 3) continue;

    usedEvents.add(leg.eventId);
    leagueCount.set(lg, (leagueCount.get(lg) ?? 0) + 1);
    pool.push(leg);
    if (pool.length >= 20) break;
  }
  return pool;
}

async function explainSlip(
  legs: AnalyzedLeg[],
  totalOdds: number,
  conf: number,
  snap: LearningSnapshot,
): Promise<string> {
  const analysisBlock = legs
    .map(
      (l) =>
        `${l.home} vs ${l.away} → ${l.pickLabel} @ ${l.odds.toFixed(2)} | score ${l.score.toFixed(2)} | ${l.analysis.join("; ")}`,
    )
    .join("\n");

  const text = await chatPlain({
    system:
      "You are a cautious football analyst. Explain why this HIGH-HIT slip was chosen after full analysis. Never claim a guarantee. 3 short sentences max.",
    user: `High-hit SureCode slip. Combined odds ${totalOdds.toFixed(2)}, joint implied ~${Math.round(conf * 100)}%.\nLearning tips: ${snap.advice.join(" | ")}\nAnalysis:\n${analysisBlock}`,
    temperature: 0.25,
    maxTokens: 220,
  });

  if (text) return text;

  return (
    `High-hit ${legs.length === 1 ? "single" : "2-fold"} after full 1X2 + history filter. ` +
    `Odds ~${totalOdds.toFixed(2)} · model ~${Math.round(conf * 100)}%. ` +
    legs.map((l) => `${l.home}/${l.away} ${l.pickLabel}`).join(" · ") +
    `. Not a guarantee.`
  );
}

async function bookSlip(
  slot: number,
  legs: AnalyzedLeg[],
  snap: LearningSnapshot,
): Promise<SureSlip | null> {
  if (!legs.length) return null;
  const totalOdds = legs.reduce((a, l) => a * l.odds, 1);
  if (legs.length >= 2 && totalOdds > MAX_DOUBLE_ODDS) return null;
  const confidence = legs.reduce((a, l) => a * l.implied, 1);
  if (legs.length >= 2 && confidence < 0.35) return null;

  const rationale = await explainSlip(legs, totalOdds, confidence, snap);
  const booked = await createBookingCode(legs);
  return {
    slot,
    legs,
    totalOdds,
    confidence,
    rationale,
    code: booked.code,
    shareUrl: booked.code ? booked.url || sportyOpenUrl(booked.code) : undefined,
    error: booked.error,
  };
}

/**
 * Build up to N high-hit slips: prefer singles, optional 2-fold last.
 */
export async function buildSureSlipsOfDay(
  count = 3,
  _history: PastOutcomeSample[] = [],
  opts: { allowAi?: boolean; legHistory?: LegHistoryRow[] } = {},
): Promise<SureSlip[]> {
  const now = Date.now();
  const fixtures = (await getSportyFixtures(Math.max(fixturePageBudget(), 6))).filter(
    (e) => e.kickoff > now + 45 * 60_000 && e.kickoff < now + 36 * 3600_000,
  );

  const snap = buildLearningSnapshot(opts.legHistory ?? []);
  const pool = buildPool(fixtures, snap);
  if (!pool.length) return [];

  const slips: SureSlip[] = [];
  const used = new Set<string>();

  const plan: ("single" | "double")[] = [];
  for (let i = 0; i < count; i++) {
    plan.push(i < 2 || count === 1 ? "single" : "double");
  }
  if (pool.length < 4) {
    for (let i = 0; i < plan.length; i++) plan[i] = "single";
  }

  let cursor = 0;
  for (let i = 0; i < plan.length && slips.length < count; i++) {
    if (plan[i] === "single") {
      while (cursor < pool.length && used.has(pool[cursor].eventId)) cursor++;
      if (cursor >= pool.length) break;
      const leg = pool[cursor++];
      used.add(leg.eventId);
      const slip = await bookSlip(slips.length + 1, [leg], snap);
      // Accept slip even without code so UI can show analysis; prefer coded
      if (slip?.code) slips.push(slip);
      else if (slip && !slip.code && slips.length === 0) {
        // retry once after tiny delay pattern — skip, try next leg
        continue;
      }
      continue;
    }

    const pair: AnalyzedLeg[] = [];
    for (let j = cursor; j < pool.length && pair.length < 2; j++) {
      if (used.has(pool[j].eventId)) continue;
      pair.push(pool[j]);
    }
    if (pair.length < 2) {
      while (cursor < pool.length && used.has(pool[cursor].eventId)) cursor++;
      if (cursor >= pool.length) break;
      const leg = pool[cursor++];
      used.add(leg.eventId);
      const slip = await bookSlip(slips.length + 1, [leg], snap);
      if (slip?.code) slips.push(slip);
      continue;
    }
    const combo = pair[0].odds * pair[1].odds;
    if (combo > MAX_DOUBLE_ODDS) {
      used.add(pair[0].eventId);
      const slip = await bookSlip(slips.length + 1, [pair[0]], snap);
      if (slip?.code) slips.push(slip);
      continue;
    }
    used.add(pair[0].eventId);
    used.add(pair[1].eventId);
    const slip = await bookSlip(slips.length + 1, pair, snap);
    if (slip?.code) slips.push(slip);
  }

  void opts.allowAi;
  return slips;
}

export function lagosDay(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}
