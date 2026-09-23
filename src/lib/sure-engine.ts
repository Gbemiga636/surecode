/**
 * SureCode engine — two user modes:
 *  - safe:  short-odds singles (max hit rate)
 *  - boost: larger odds still filtered as sure (singles or rare 2-folds)
 * Multi-sport: football, basketball, tennis, hockey, baseball.
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
import { modeForSlot, slotsForMode, type SureMode } from "./sure-mode";

export type { SureMode };
export { modeForSlot, slotsForMode };

export type SureSlip = {
  slot: number;
  mode: SureMode;
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

type ModeLimits = {
  minOdds: number;
  maxOdds: number;
  minImplied: number;
  minFavEdge: number;
  minScore: number;
  allowDoubles: boolean;
  maxDoubleOdds: number;
  tennisMax: number;
  hockeyMax: number;
};

const LIMITS: Record<SureMode, ModeLimits> = {
  safe: {
    minOdds: 1.1,
    maxOdds: 1.45,
    minImplied: 0.7,
    minFavEdge: 0.1,
    minScore: 1.35,
    allowDoubles: false,
    maxDoubleOdds: 0,
    tennisMax: 1.32,
    hockeyMax: 1.4,
  },
  boost: {
    minOdds: 1.35,
    maxOdds: 2.15,
    minImplied: 0.48,
    minFavEdge: 0.07,
    minScore: 1.15,
    allowDoubles: true,
    maxDoubleOdds: 3.6,
    tennisMax: 1.75,
    hockeyMax: 1.95,
  },
};

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

function moneylineFav(
  ev: SbEvent,
  lim: ModeLimits,
): { side: "home" | "away"; odds: number; code: string } | null {
  const sport = ev.sport || "football";
  if (sport === "basketball") {
    const h = ev.outcomes.BBH;
    const a = ev.outcomes.BBA;
    if (!h || !a) return null;
    if (h <= a && h <= lim.maxOdds && h >= lim.minOdds)
      return { side: "home", odds: h, code: "BBH" };
    if (a < h && a <= lim.maxOdds && a >= lim.minOdds)
      return { side: "away", odds: a, code: "BBA" };
    return null;
  }
  if (sport === "tennis") {
    const h = ev.outcomes.TNH;
    const a = ev.outcomes.TNA;
    if (!h || !a) return null;
    const cap = lim.tennisMax;
    if (h <= a && h <= cap && h >= lim.minOdds) return { side: "home", odds: h, code: "TNH" };
    if (a < h && a <= cap && a >= lim.minOdds) return { side: "away", odds: a, code: "TNA" };
    return null;
  }
  if (sport === "hockey" || sport === "baseball") {
    const h = ev.outcomes["1"];
    const a = ev.outcomes["2"];
    if (!h || !a) return null;
    const cap = lim.hockeyMax;
    if (h <= a && h <= cap && h >= lim.minOdds) return { side: "home", odds: h, code: "1" };
    if (a < h && a <= cap && a >= lim.minOdds) return { side: "away", odds: a, code: "2" };
    return null;
  }
  return null;
}

function analyzeFootballPick(
  ev: SbEvent,
  pickCode: string,
  snap: LearningSnapshot,
  lim: ModeLimits,
  mode: SureMode,
): AnalyzedLeg | null {
  const meta = PICKS[pickCode];
  if (!meta) return null;
  const odds = ev.outcomes[pickCode];
  if (!odds || odds < lim.minOdds || odds > lim.maxOdds) return null;
  if (mode === "safe" && impliedProb(odds) < lim.minImplied && pickCode !== "O05") return null;

  const probs = deVig1x2(ev);
  const analysis: string[] = [];
  let favSide: "home" | "away" | "coin" = "coin";

  if (probs) {
    if (probs.home - probs.away >= lim.minFavEdge) favSide = "home";
    else if (probs.away - probs.home >= lim.minFavEdge) favSide = "away";
    analysis.push(
      `De-vig 1X2 → Home ${Math.round(probs.home * 100)}% · Draw ${Math.round(probs.draw * 100)}% · Away ${Math.round(probs.away * 100)}%`,
    );

    if (["DC1X", "DNBH", "HO05", "1"].includes(pickCode)) {
      if (favSide !== "home" || probs.home < (mode === "safe" ? 0.48 : 0.42)) return null;
      analysis.push(`Home favourite edge ${(probs.home - probs.away).toFixed(2)}`);
    }
    if (["DCX2", "DNBA", "AO05", "2"].includes(pickCode)) {
      if (favSide !== "away" || probs.away < (mode === "safe" ? 0.48 : 0.42)) return null;
      analysis.push(`Away favourite edge ${(probs.away - probs.home).toFixed(2)}`);
    }
    if (pickCode === "O05" && mode === "safe" && odds > 1.28) return null;
    if (pickCode === "O15") {
      if (mode === "safe" && (odds > 1.4 || probs.draw > 0.33)) return null;
      if (mode === "boost" && odds > 1.85) return null;
      analysis.push("Goals market aligned with match tempo");
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
  if (pickStat && pickStat.plays >= 20 && pickStat.winRate < (mode === "safe" ? 0.55 : 0.48)) {
    return null;
  }

  let score = scoreLeg(leg, snap);
  if (pickCode === "O05") score += 0.55;
  if (odds <= 1.25) score += 0.5;
  else if (odds <= 1.45) score += 0.2;
  if (mode === "boost" && odds >= 1.55 && odds <= 1.95) score += 0.25; // sweet value band
  if (probs && favSide === "home") score += probs.home * 0.9;
  if (probs && favSide === "away") score += probs.away * 0.9;
  if (score < lim.minScore) return null;

  analysis.push(`Market ${pickCode} @ ${odds.toFixed(2)} (~${Math.round(leg.implied * 100)}% implied)`);
  if (pickStat && pickStat.plays >= 8) {
    analysis.push(
      `Settled history: ${Math.round(pickStat.winRate * 100)}% wins across ${pickStat.plays} similar legs`,
    );
  }
  if (ev.league) analysis.push(`Competition: ${ev.league}`);

  return { ...leg, score, analysis, favSide };
}

function analyzeMoneyline(
  ev: SbEvent,
  snap: LearningSnapshot,
  lim: ModeLimits,
  mode: SureMode,
): AnalyzedLeg | null {
  const fav = moneylineFav(ev, lim);
  if (!fav) return null;
  const meta = PICKS[fav.code];
  if (!meta) return null;

  const other =
    fav.side === "home"
      ? ev.outcomes.BBA || ev.outcomes.TNA || ev.outcomes["2"]
      : ev.outcomes.BBH || ev.outcomes.TNH || ev.outcomes["1"];
  if (other && other / fav.odds < (mode === "safe" ? 1.15 : 1.08)) return null;

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
  if (mode === "boost" && fav.odds >= 1.5) score += 0.2;
  if (score < lim.minScore) return null;

  return {
    ...leg,
    score,
    analysis: [
      `${ev.sportLabel || ev.sport} moneyline favourite`,
      `Price ${fav.odds.toFixed(2)} (~${Math.round(leg.implied * 100)}% implied)`,
      other ? `Opponent price ${Number(other).toFixed(2)}` : "Clear market favourite",
      mode === "safe" ? "Safe-mode short price" : "Boost-mode larger but still favoured",
      ev.league ? `League: ${ev.league}` : "Open market",
    ],
    favSide: fav.side,
  };
}

function buildPool(
  fixtures: SbEvent[],
  snap: LearningSnapshot,
  mode: SureMode,
): AnalyzedLeg[] {
  const lim = LIMITS[mode];
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
        const a = analyzeFootballPick(ev, code, snap, lim, mode);
        if (a) all.push(a);
      }
    } else {
      const a = analyzeMoneyline(ev, snap, lim, mode);
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
    if ((sportCount.get(sp) ?? 0) >= (mode === "boost" ? 3 : 2)) continue;
    const lg = leg.league || "unknown";
    if ((leagueCount.get(lg) ?? 0) >= 2) continue;

    usedEvents.add(leg.eventId);
    sportCount.set(sp, (sportCount.get(sp) ?? 0) + 1);
    leagueCount.set(lg, (leagueCount.get(lg) ?? 0) + 1);
    pool.push(leg);
    if (pool.length >= 14) break;
  }
  return pool;
}

async function explainSlip(
  legs: AnalyzedLeg[],
  totalOdds: number,
  conf: number,
  snap: LearningSnapshot,
  mode: SureMode,
): Promise<string> {
  const analysisBlock = legs
    .map(
      (l) =>
        `[${l.sportLabel || l.sport || "Sport"}] ${l.home} vs ${l.away}\n` +
        `  Pick: ${l.pickLabel} @ ${l.odds.toFixed(2)}\n` +
        `  Score: ${l.score.toFixed(2)}\n` +
        `  Signals: ${l.analysis.join(" · ")}`,
    )
    .join("\n");

  const modeLabel =
    mode === "safe"
      ? "SAFE mode (short-odds single, maximize hit rate)"
      : "BOOST mode (larger odds, still favourite-backed)";

  const text = await chatPlain({
    system:
      "You are a senior multi-sport betting analyst. Write a richer SureCode analysis: (1) why this market, (2) key probability/favourite signal, (3) risk note. 4–5 short sentences max. Never claim a guarantee. Mention the sport and mode.",
    user: `${modeLabel}\nCombined odds ${totalOdds.toFixed(2)} · model confidence ~${Math.round(conf * 100)}%.\nLearning bank tips: ${snap.advice.slice(0, 4).join(" | ") || "warming up"}\n\nFull signals:\n${analysisBlock}`,
    temperature: 0.3,
    maxTokens: 320,
  });

  if (text) return `[${mode.toUpperCase()}] ${text}`;

  const l = legs[0];
  return (
    `[${mode.toUpperCase()}] ${mode === "safe" ? "Safe single" : "Boost slip"} — ` +
    `${l?.sportLabel || "sport"}: ${legs.map((x) => `${x.home}/${x.away} ${x.pickLabel}`).join(" · ")}. ` +
    `Odds ~${totalOdds.toFixed(2)} · model ~${Math.round(conf * 100)}%. ` +
    `${l?.analysis?.slice(0, 2).join(". ") || "Full market screen passed"}. Not a guarantee.`
  );
}

async function bookSlip(
  slot: number,
  legs: AnalyzedLeg[],
  snap: LearningSnapshot,
  mode: SureMode,
): Promise<SureSlip | null> {
  if (!legs.length) return null;
  const lim = LIMITS[mode];
  if (legs.length > 1 && !lim.allowDoubles) return null;
  const totalOdds = legs.reduce((a, l) => a * l.odds, 1);
  if (legs.length >= 2 && totalOdds > lim.maxDoubleOdds) return null;
  const confidence = legs.reduce((a, l) => a * l.implied, 1);
  if (mode === "safe" && confidence < lim.minImplied && legs[0].pickCode !== "O05") return null;
  if (mode === "boost" && legs.length >= 2 && confidence < 0.28) return null;

  const rationale = await explainSlip(legs, totalOdds, confidence, snap, mode);
  const booked = await createBookingCode(legs);
  return {
    slot,
    mode,
    legs,
    totalOdds,
    confidence,
    rationale,
    code: booked.code,
    shareUrl: booked.code ? booked.url || sportyOpenUrl(booked.code) : undefined,
    error: booked.error,
  };
}

async function buildModeSlips(
  mode: SureMode,
  fixtures: SbEvent[],
  snap: LearningSnapshot,
  count: number,
  excludeEvents: Set<string>,
): Promise<SureSlip[]> {
  const lim = LIMITS[mode];
  const pool = buildPool(
    fixtures.filter((e) => !excludeEvents.has(e.eventId)),
    snap,
    mode,
  );
  const slots = slotsForMode(mode);
  const slips: SureSlip[] = [];
  const used = new Set<string>(excludeEvents);

  let cursor = 0;
  for (let i = 0; i < count && slips.length < count; i++) {
    const slot = slots[slips.length] ?? slots[slots.length - 1]! + slips.length;

    if (mode === "boost" && lim.allowDoubles && slips.length === count - 1 && pool.length - cursor >= 2) {
      // last boost slip can be a 2-fold if prices fit
      const pair: AnalyzedLeg[] = [];
      for (let j = cursor; j < pool.length && pair.length < 2; j++) {
        if (used.has(pool[j].eventId)) continue;
        pair.push(pool[j]);
      }
      if (pair.length === 2 && pair[0].odds * pair[1].odds <= lim.maxDoubleOdds) {
        used.add(pair[0].eventId);
        used.add(pair[1].eventId);
        const slip = await bookSlip(slot, pair, snap, mode);
        if (slip?.code) slips.push(slip);
        continue;
      }
    }

    while (cursor < pool.length && used.has(pool[cursor].eventId)) cursor++;
    if (cursor >= pool.length) break;
    const leg = pool[cursor++];
    used.add(leg.eventId);
    const slip = await bookSlip(slot, [leg], snap, mode);
    if (slip?.code) slips.push(slip);
  }

  return slips;
}

/**
 * Build safe (slots 1–3) + boost (slots 4–6) Sure slips.
 */
export async function buildSureSlipsOfDay(
  count = 3,
  _history: PastOutcomeSample[] = [],
  opts: { allowAi?: boolean; legHistory?: LegHistoryRow[]; modes?: SureMode[] } = {},
): Promise<SureSlip[]> {
  const now = Date.now();
  const fixtures = (await getAllSportyFixtures({ maxPagesPerSport: 3 })).filter(
    (e) => e.kickoff > now + 40 * 60_000 && e.kickoff < now + 36 * 3600_000,
  );

  const snap = buildLearningSnapshot(opts.legHistory ?? []);
  const modes = opts.modes ?? (["safe", "boost"] as SureMode[]);
  const slips: SureSlip[] = [];
  const used = new Set<string>();

  for (const mode of modes) {
    const built = await buildModeSlips(mode, fixtures, snap, count, used);
    for (const s of built) {
      for (const l of s.legs) used.add(l.eventId);
      slips.push(s);
    }
  }

  void opts.allowAi;
  return slips;
}

export function lagosDay(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}
