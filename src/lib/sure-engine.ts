/**
 * Max-hit SureCode engine — multi-sport singles only.
 * Past data: singles ~62% vs doubles ~43%. Priority = win rate / profit survival.
 */
import {
  createBookingCode,
  getAllSportyFixtures,
  impliedProb,
  PICKS,
  sportyOpenUrl,
  type BookableLeg,
  type SbEvent,
  type SportKey,
} from "./sporty";
import { chatPlain } from "./openai";
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

/** Football elite + cross-sport moneyline favourites */
export const QUALITY_PICK_CODES = [
  "O05",
  "DC1X",
  "DCX2",
  "O15",
  "HO05",
  "AO05",
  "DNBH",
  "DNBA",
  "BBH",
  "BBA",
  "TNH",
  "TNA",
  "1",
  "2",
] as const;

const MIN_LEG_ODDS = 1.1;
const MAX_LEG_ODDS = 1.55; // singles-only band — short prices
const MIN_LEG_SCORE = 1.35;
const MIN_FAV_EDGE = 0.1; // stronger favourites only
const MIN_IMPLIED = 0.68; // ~odds ≤ 1.47

type AnalyzedLeg = BookableLeg & {
  score: number;
  analysis: string[];
  favSide: "home" | "away" | "coin";
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

function moneylineFav(ev: SbEvent): { side: "home" | "away"; odds: number; code: string } | null {
  const sport = ev.sport || "football";
  if (sport === "basketball") {
    const h = ev.outcomes.BBH;
    const a = ev.outcomes.BBA;
    if (!h || !a) return null;
    if (h <= a && h <= MAX_LEG_ODDS && h >= MIN_LEG_ODDS)
      return { side: "home", odds: h, code: "BBH" };
    if (a < h && a <= MAX_LEG_ODDS && a >= MIN_LEG_ODDS)
      return { side: "away", odds: a, code: "BBA" };
    return null;
  }
  if (sport === "tennis") {
    const h = ev.outcomes.TNH;
    const a = ev.outcomes.TNA;
    if (!h || !a) return null;
    // Tennis: only heavy favourites
    if (h <= a && h <= 1.35 && h >= MIN_LEG_ODDS)
      return { side: "home", odds: h, code: "TNH" };
    if (a < h && a <= 1.35 && a >= MIN_LEG_ODDS)
      return { side: "away", odds: a, code: "TNA" };
    return null;
  }
  if (sport === "hockey" || sport === "baseball") {
    const h = ev.outcomes["1"];
    const a = ev.outcomes["2"];
    if (!h || !a) return null;
    if (h <= a && h <= 1.45 && h >= MIN_LEG_ODDS)
      return { side: "home", odds: h, code: "1" };
    if (a < h && a <= 1.45 && a >= MIN_LEG_ODDS)
      return { side: "away", odds: a, code: "2" };
    return null;
  }
  return null;
}

function analyzeFootballPick(
  ev: SbEvent,
  pickCode: string,
  snap: LearningSnapshot,
): AnalyzedLeg | null {
  const meta = PICKS[pickCode];
  if (!meta) return null;
  const odds = ev.outcomes[pickCode];
  if (!odds || odds < MIN_LEG_ODDS || odds > MAX_LEG_ODDS) return null;
  if (impliedProb(odds) < MIN_IMPLIED && pickCode !== "O05") return null;

  const probs = deVig1x2(ev);
  const analysis: string[] = [];
  let favSide: "home" | "away" | "coin" = "coin";

  if (probs) {
    if (probs.home - probs.away >= MIN_FAV_EDGE) favSide = "home";
    else if (probs.away - probs.home >= MIN_FAV_EDGE) favSide = "away";
    analysis.push(
      `1X2 de-vig H ${Math.round(probs.home * 100)}% / D ${Math.round(probs.draw * 100)}% / A ${Math.round(probs.away * 100)}%`,
    );

    if (["DC1X", "DNBH", "HO05", "1"].includes(pickCode)) {
      if (favSide !== "home" || probs.home < 0.48) return null;
    }
    if (["DCX2", "DNBA", "AO05", "2"].includes(pickCode)) {
      if (favSide !== "away" || probs.away < 0.48) return null;
    }
    if (pickCode === "O05" && odds > 1.28) return null;
    if (pickCode === "O15") {
      if (odds > 1.4 || probs.draw > 0.33) return null;
    }
    if (favSide === "coin" && !["O05", "O15"].includes(pickCode)) return null;
  } else if (!["O05", "O15"].includes(pickCode)) {
    return null;
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
    sport: "football",
    sportLabel: "Football",
  };

  const pickStat = snap.byPick.find((p) => p.pickCode === pickCode);
  if (pickStat && pickStat.plays >= 20 && pickStat.winRate < 0.55) return null;

  let score = scoreLeg(leg, snap);
  if (pickCode === "O05") score += 0.55;
  if (odds <= 1.25) score += 0.5;
  else if (odds <= 1.35) score += 0.25;
  if (probs && favSide === "home") score += probs.home * 0.9;
  if (probs && favSide === "away") score += probs.away * 0.9;
  if (score < MIN_LEG_SCORE) return null;

  analysis.push(`Football · ${pickCode} @ ${odds.toFixed(2)}`);
  if (pickStat && pickStat.plays >= 8) {
    analysis.push(`History ${Math.round(pickStat.winRate * 100)}% of ${pickStat.plays}`);
  }

  return { ...leg, score, analysis, favSide };
}

function analyzeMoneyline(ev: SbEvent, snap: LearningSnapshot): AnalyzedLeg | null {
  const fav = moneylineFav(ev);
  if (!fav) return null;
  const meta = PICKS[fav.code];
  if (!meta) return null;

  const edge =
    fav.side === "home"
      ? 1 / fav.odds - 1 / (ev.outcomes.BBA || ev.outcomes.TNA || ev.outcomes["2"] || 3)
      : 1 / fav.odds - 1 / (ev.outcomes.BBH || ev.outcomes.TNH || ev.outcomes["1"] || 3);
  if (edge < 0.08 && (ev.sport === "basketball" || ev.sport === "tennis")) {
    // require clear price gap
    const other =
      fav.side === "home"
        ? ev.outcomes.BBA || ev.outcomes.TNA || ev.outcomes["2"]
        : ev.outcomes.BBH || ev.outcomes.TNH || ev.outcomes["1"];
    if (!other || other / fav.odds < 1.15) return null;
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
    pickCode: fav.code,
    pickLabel: meta.label.replace("Home", ev.home).replace("Away", ev.away),
    odds: fav.odds,
    implied: impliedProb(fav.odds),
    sport: ev.sport,
    sportLabel: ev.sportLabel,
  };

  let score = scoreLeg(leg, snap) + impliedProb(fav.odds) * 1.2;
  if (fav.odds <= 1.25) score += 0.55;
  if (ev.sport === "tennis" && fav.odds <= 1.22) score += 0.35;
  if (score < MIN_LEG_SCORE) return null;

  return {
    ...leg,
    score,
    analysis: [
      `${ev.sportLabel || ev.sport} favourite`,
      `@${fav.odds.toFixed(2)} (~${Math.round(leg.implied * 100)}%)`,
      "Singles-only max-hit mode",
    ],
    favSide: fav.side,
  };
}

function buildPool(fixtures: SbEvent[], snap: LearningSnapshot): AnalyzedLeg[] {
  const all: AnalyzedLeg[] = [];

  for (const ev of fixtures) {
    const sport = (ev.sport || "football") as SportKey;
    if (sport === "football") {
      for (const code of [
        "O05",
        "DC1X",
        "DCX2",
        "O15",
        "HO05",
        "AO05",
        "DNBH",
        "DNBA",
      ] as const) {
        const a = analyzeFootballPick(ev, code, snap);
        if (a) all.push(a);
      }
    } else {
      const a = analyzeMoneyline(ev, snap);
      if (a) all.push(a);
    }
  }

  all.sort((a, b) => b.score - a.score);

  const pool: AnalyzedLeg[] = [];
  const usedEvents = new Set<string>();
  const sportCount = new Map<string, number>();
  const leagueCount = new Map<string, number>();

  for (const leg of all) {
    if (usedEvents.has(leg.eventId)) continue;
    const best = all.filter((x) => x.eventId === leg.eventId).sort((a, b) => b.score - a.score)[0];
    if (best.pickCode !== leg.pickCode) continue;

    const sp = leg.sport || "football";
    if ((sportCount.get(sp) ?? 0) >= 2) continue; // diversify sports
    const lg = leg.league || "unknown";
    if ((leagueCount.get(lg) ?? 0) >= 2) continue;

    usedEvents.add(leg.eventId);
    sportCount.set(sp, (sportCount.get(sp) ?? 0) + 1);
    leagueCount.set(lg, (leagueCount.get(lg) ?? 0) + 1);
    pool.push(leg);
    if (pool.length >= 12) break;
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
        `[${l.sportLabel || l.sport || "Sport"}] ${l.home} vs ${l.away} → ${l.pickLabel} @ ${l.odds.toFixed(2)} | ${l.analysis.join("; ")}`,
    )
    .join("\n");

  const text = await chatPlain({
    system:
      "You are a multi-sport betting analyst. Explain why this SINGLE max-hit pick was chosen. Mention the sport. Never guarantee. 2–3 short sentences.",
    user: `Max-hit SureCode single. Odds ${totalOdds.toFixed(2)}, model ~${Math.round(conf * 100)}%.\nTips: ${snap.advice.join(" | ")}\n${analysisBlock}`,
    temperature: 0.25,
    maxTokens: 200,
  });

  if (text) return text;
  const l = legs[0];
  return (
    `Max-hit ${l?.sportLabel || "sport"} single after full analysis. ` +
    `${l?.home} vs ${l?.away}: ${l?.pickLabel} @ ${totalOdds.toFixed(2)} ` +
    `(~${Math.round(conf * 100)}% model). Singles-only — past doubles underperformed. Not a guarantee.`
  );
}

async function bookSlip(
  slot: number,
  legs: AnalyzedLeg[],
  snap: LearningSnapshot,
): Promise<SureSlip | null> {
  if (legs.length !== 1) return null; // SINGLES ONLY
  const totalOdds = legs[0].odds;
  const confidence = legs[0].implied;
  if (confidence < MIN_IMPLIED && legs[0].pickCode !== "O05") return null;

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
 * Build up to N max-hit singles across all SportyBet sports.
 */
export async function buildSureSlipsOfDay(
  count = 3,
  _history: PastOutcomeSample[] = [],
  opts: { allowAi?: boolean; legHistory?: LegHistoryRow[] } = {},
): Promise<SureSlip[]> {
  const now = Date.now();
  const fixtures = (await getAllSportyFixtures({ maxPagesPerSport: 3 })).filter(
    (e) => e.kickoff > now + 40 * 60_000 && e.kickoff < now + 36 * 3600_000,
  );

  const snap = buildLearningSnapshot(opts.legHistory ?? []);
  const pool = buildPool(fixtures, snap);
  if (!pool.length) return [];

  const slips: SureSlip[] = [];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const slip = await bookSlip(i + 1, [pool[i]], snap);
    if (slip?.code) slips.push(slip);
  }

  void opts.allowAi;
  return slips;
}

export function lagosDay(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}
