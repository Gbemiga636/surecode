/**
 * SureCode engine — profit-max stack (never 100% sure):
 *  - safe:     short-odds singles / tiny cross-sport packs (bankroll protect)
 *  - boost:    larger favourite-backed odds, cross-sport 2–3 folds
 *  - longshot: multi-day cross-sport accumulators (higher odds, still filtered)
 * AI play-out can veto multi-leg slips when OPENAI_API_KEY is set.
 * Sports: football, basketball, tennis, hockey, baseball.
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
import { chatJson, chatPlain } from "./openai";
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
    minOdds: 1.08,
    maxOdds: 1.42,
    minImplied: 0.72,
    minFavEdge: 0.1,
    minScore: 1.45,
    allowDoubles: true,
    maxDoubleOdds: 2.25, // cross-sport 2–3 short elites
    tennisMax: 1.28,
    hockeyMax: 1.35,
  },
  boost: {
    minOdds: 1.5,
    maxOdds: 2.4,
    minImplied: 0.4,
    minFavEdge: 0.06,
    minScore: 1.15,
    allowDoubles: true,
    maxDoubleOdds: 4.5,
    tennisMax: 1.9,
    hockeyMax: 2.1,
  },
  /** Multi-day profit lane: solid per-leg favourites → larger combined odds */
  longshot: {
    minOdds: 1.35,
    maxOdds: 2.85,
    minImplied: 0.35,
    minFavEdge: 0.08,
    minScore: 1.08,
    allowDoubles: true,
    maxDoubleOdds: 22,
    tennisMax: 2.25,
    hockeyMax: 2.45,
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
  const homeFloor = mode === "safe" ? 0.48 : mode === "boost" ? 0.42 : 0.44;

  if (probs) {
    if (probs.home - probs.away >= lim.minFavEdge) favSide = "home";
    else if (probs.away - probs.home >= lim.minFavEdge) favSide = "away";
    analysis.push(
      `De-vig 1X2 → Home ${Math.round(probs.home * 100)}% · Draw ${Math.round(probs.draw * 100)}% · Away ${Math.round(probs.away * 100)}%`,
    );

    if (["DC1X", "DNBH", "HO05", "1"].includes(pickCode)) {
      if (favSide !== "home" || probs.home < homeFloor) return null;
      analysis.push(`Home favourite edge ${(probs.home - probs.away).toFixed(2)}`);
    }
    if (["DCX2", "DNBA", "AO05", "2"].includes(pickCode)) {
      if (favSide !== "away" || probs.away < homeFloor) return null;
      analysis.push(`Away favourite edge ${(probs.away - probs.home).toFixed(2)}`);
    }
    if (pickCode === "O05" && mode === "safe" && odds > 1.28) return null;
    if (pickCode === "O05" && mode !== "safe") return null; // O05 only in safe
    if (pickCode === "1HO05") {
      if (mode === "longshot") return null;
      if (odds > (mode === "safe" ? 1.32 : 1.55)) return null;
      analysis.push("1st-half Over 0.5 — high-hit period market");
    }
    if (pickCode === "1HDC1X") {
      if (favSide !== "home" || probs.home < 0.45) return null;
      analysis.push("1st-half double chance on home favourite");
    }
    if (pickCode === "1HDCX2") {
      if (favSide !== "away" || probs.away < 0.45) return null;
      analysis.push("1st-half double chance on away favourite");
    }
    if (pickCode === "O15") {
      if (mode === "safe" && (odds > 1.4 || probs.draw > 0.33)) return null;
      if (mode === "boost" && odds > 2.2) return null;
      if (mode === "longshot" && (odds > 2.4 || probs.draw > 0.32)) return null;
      analysis.push("Goals market aligned with match tempo");
    }
    if (pickCode === "O25") {
      if (mode === "safe") return null;
      if (probs.draw > 0.3) return null;
      analysis.push("Over 2.5 — open game profile");
    }
    if (pickCode === "BTTSY") {
      if (mode === "safe") return null;
      if (probs.draw > 0.34) return null;
      analysis.push("BTTS Yes — both sides expected to score");
    }
    if (
      favSide === "coin" &&
      !["O05", "O15", "O25", "BTTSY", "1HO05"].includes(pickCode)
    ) {
      return null;
    }
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
  if (snap.avoidMarkets.includes(pickCode) && mode === "safe") return null;
  if (
    mode === "safe" &&
    snap.eliteMarkets.length >= 2 &&
    !snap.eliteMarkets.includes(pickCode) &&
    !["O05", "DC1X", "DCX2", "HO05", "AO05"].includes(pickCode)
  ) {
    // When training is mature, stick to elite + core high-hit markets
    return null;
  }
  if (pickStat && pickStat.plays >= 12 && pickStat.smoothed < (mode === "safe" ? 0.58 : 0.5)) {
    return null;
  }

  let score = scoreLeg(leg, snap);
  if (pickCode === "O05") score += 0.55;
  if (mode === "safe") {
    if (odds <= 1.25) score += 0.5;
    else if (odds <= 1.4) score += 0.2;
  } else if (mode === "boost") {
    if (odds >= 1.65 && odds <= 2.1) score += 0.55;
    else if (odds >= 1.55) score += 0.3;
    score += Math.min(0.45, (odds - 1.55) * 0.5);
  } else {
    // longshot: reward mid-high prices that still look favoured
    if (odds >= 1.55 && odds <= 2.35) score += 0.5;
    score += Math.min(0.55, (odds - 1.4) * 0.35);
  }
  if (probs && favSide === "home") score += probs.home * 0.9;
  if (probs && favSide === "away") score += probs.away * 0.9;
  if (score < lim.minScore) return null;

  analysis.push(`Market ${pickCode} @ ${odds.toFixed(2)} (~${Math.round(leg.implied * 100)}% implied)`);
  if (pickStat && pickStat.plays >= 6) {
    analysis.push(
      `Trained ${pickCode}: ~${Math.round(pickStat.smoothed * 100)}% smoothed (${pickStat.plays} settled)`,
    );
  }
  if (snap.eliteMarkets.includes(pickCode)) {
    analysis.push("Category ranked elite by Sure AI training");
  }

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
  if (mode === "longshot" && fav.odds >= 1.45) score += 0.35;
  if (score < lim.minScore) return null;

  const modeNote =
    mode === "safe"
      ? "Safe-mode short price"
      : mode === "boost"
        ? "Boost-mode larger but still favoured"
        : "Longshot-mode multi-day favourite";

  return {
    ...leg,
    score,
    analysis: [
      `${ev.sportLabel || ev.sport} moneyline favourite`,
      `Price ${fav.odds.toFixed(2)} (~${Math.round(leg.implied * 100)}% implied)`,
      other ? `Opponent price ${Number(other).toFixed(2)}` : "Clear market favourite",
      modeNote,
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
      const codes =
        mode === "safe"
          ? ([
              "O05",
              "1HO05",
              "DC1X",
              "DCX2",
              "O15",
              "HO05",
              "AO05",
              "DNBH",
              "DNBA",
              "1HDC1X",
              "1HDCX2",
            ] as const)
          : mode === "boost"
            ? (["DC1X", "DCX2", "O15", "O25", "DNBH", "DNBA", "BTTSY", "1HDC1X", "1HDCX2", "1", "2"] as const)
            : (["DC1X", "DCX2", "O15", "O25", "DNBH", "DNBA", "BTTSY", "1", "2"] as const);
      for (const code of codes) {
        const a = analyzeFootballPick(ev, code, snap, lim, mode);
        if (a) all.push(a);
      }
    } else {
      const a = analyzeMoneyline(ev, snap, lim, mode);
      if (a) all.push(a);
    }
  }

  all.sort((a, b) => {
    if (mode === "safe") return b.score - a.score;
    // boost + longshot: favour expected-value style ranking (score × odds)
    const sa = a.score * Math.log(a.odds + 0.15);
    const sb = b.score * Math.log(b.odds + 0.15);
    return sb - sa;
  });

  const pool: AnalyzedLeg[] = [];
  const usedEvents = new Set<string>();
  const sportCount = new Map<string, number>();
  const leagueCount = new Map<string, number>();
  const sportCap = mode === "longshot" ? 4 : mode === "boost" ? 3 : 2;
  const poolCap = mode === "longshot" ? 20 : 14;

  for (const leg of all) {
    if (usedEvents.has(leg.eventId)) continue;
    const best = all.filter((x) => x.eventId === leg.eventId).sort((a, b) => b.score - a.score)[0];
    if (best.pickCode !== leg.pickCode) continue;

    const sp = leg.sport || "football";
    if ((sportCount.get(sp) ?? 0) >= sportCap) continue;
    const lg = leg.league || "unknown";
    if ((leagueCount.get(lg) ?? 0) >= 2) continue;

    usedEvents.add(leg.eventId);
    sportCount.set(sp, (sportCount.get(sp) ?? 0) + 1);
    leagueCount.set(lg, (leagueCount.get(lg) ?? 0) + 1);
    pool.push(leg);
    if (pool.length >= poolCap) break;
  }
  return pool;
}

type PlayOutResult = {
  pass: boolean;
  confidence: number;
  story: string;
  risk: string;
};

/**
 * AI pre-play: mentally walk the fixtures and veto thin multi-leg slips.
 * Conservative — rejects when the model is unsure. Never a guarantee.
 */
async function aiPlayOutLegs(
  legs: AnalyzedLeg[],
  mode: SureMode,
  totalOdds: number,
): Promise<PlayOutResult | null> {
  const block = legs
    .map(
      (l, i) =>
        `${i + 1}. [${l.sportLabel || l.sport}] ${l.home} vs ${l.away}\n` +
        `   Market: ${l.pickLabel} @ ${l.odds.toFixed(2)} (kickoff ${new Date(l.kickoff).toISOString()})\n` +
        `   Signals: ${l.analysis.slice(0, 3).join("; ")}`,
    )
    .join("\n");

  const result = await chatJson<PlayOutResult>({
    system:
      "You are a conservative multi-sport match simulator for a betting desk. " +
      "Mentally play out each fixture using only the prices and signals given. " +
      "Reject thin edges. Prefer favourites that look structurally strong. " +
      "Never invent injuries, lineups, or sources not provided. " +
      'Return JSON: {"pass":boolean,"confidence":0-1,"story":"2-4 sentences","risk":"one clear risk"}. ' +
      "pass=true only if you would stake your own bankroll at this price.",
    user:
      `Mode: ${mode}\nCombined odds: ${totalOdds.toFixed(2)}\nLegs:\n${block}\n` +
      `Be strict for longshot stacks. Cross-sport diversification helps but does not remove risk.`,
    temperature: 0.15,
    maxTokens: 420,
  });

  if (!result || typeof result.pass !== "boolean") return null;
  return {
    pass: result.pass,
    confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
    story: String(result.story || "").slice(0, 600),
    risk: String(result.risk || "").slice(0, 200),
  };
}

async function explainSlip(
  legs: AnalyzedLeg[],
  totalOdds: number,
  conf: number,
  snap: LearningSnapshot,
  mode: SureMode,
  playOut?: PlayOutResult | null,
): Promise<string> {
  if (playOut?.story) {
    return (
      `[${mode.toUpperCase()}] AI play-out (~${Math.round(playOut.confidence * 100)}%): ${playOut.story}` +
      (playOut.risk ? ` Risk: ${playOut.risk}` : "") +
      ` Combined odds ${totalOdds.toFixed(2)}. Not a guarantee.`
    );
  }

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
      ? "SAFE — elite short prices; may mix sports into a small accumulator"
      : mode === "boost"
        ? "BOOST — larger favourite-backed prices; cross-sport stacks allowed"
        : "LONGSHOT — multi-day cross-sport accumulator aiming at larger payouts with filtered favourites";

  const sports = [...new Set(legs.map((l) => l.sportLabel || l.sport || "Sport"))].join(" + ");

  const text = await chatPlain({
    system:
      "You are Sure AI for a multi-sport betting desk. Explain why these legs were combined across sports. Cover: (1) each sport/market briefly, (2) why the stack still aims at hit rate / profit, (3) training/history signal if present, (4) one clear risk. 4–6 short sentences. No guarantees. Never invent data sources.",
    user: `${modeLabel}\nSports in slip: ${sports}\nCombined odds ${totalOdds.toFixed(2)} · model ~${Math.round(conf * 100)}%.\nTraining: ${snap.advice.slice(0, 5).join(" | ") || "warming up"}\nElite markets: ${snap.eliteMarkets.join(", ") || "n/a"}\n\nSignals:\n${analysisBlock}`,
    temperature: 0.28,
    maxTokens: 380,
  });

  if (text) return `[${mode.toUpperCase()}] ${text}`;

  const l = legs[0];
  return (
    `[${mode.toUpperCase()}] ${mode} slip — ` +
    `${legs.map((x) => `${x.sportLabel || x.sport}: ${x.home}/${x.away} ${x.pickLabel}`).join(" · ")}. ` +
    `Odds ~${totalOdds.toFixed(2)} · model ~${Math.round(conf * 100)}%. ` +
    `${l?.analysis?.slice(0, 2).join(". ") || "Full market screen passed"}. Not a guarantee.`
  );
}

async function bookSlip(
  slot: number,
  legs: AnalyzedLeg[],
  snap: LearningSnapshot,
  mode: SureMode,
  allowAi: boolean,
): Promise<SureSlip | null> {
  if (!legs.length) return null;
  const lim = LIMITS[mode];
  if (legs.length > 1 && !lim.allowDoubles) return null;
  const totalOdds = legs.reduce((a, l) => a * l.odds, 1);
  if (legs.length >= 2 && totalOdds > lim.maxDoubleOdds) return null;
  const confidence = legs.reduce((a, l) => a * l.implied, 1);
  if (
    mode === "safe" &&
    legs.length === 1 &&
    confidence < lim.minImplied &&
    legs[0].pickCode !== "O05" &&
    legs[0].pickCode !== "1HO05"
  )
    return null;
  if (mode === "safe" && legs.length >= 2 && confidence < 0.45) return null;
  if (mode === "boost" && legs.length >= 2 && confidence < 0.26) return null;
  if (mode === "longshot") {
    if (legs.length < 2) return null; // longshot is always a multi-leg profit pack
    if (totalOdds < 2.8) return null;
    if (confidence < 0.1) return null;
  }

  let playOut: PlayOutResult | null = null;
  if (allowAi && legs.length >= 2) {
    playOut = await aiPlayOutLegs(legs, mode, totalOdds);
    const floor = mode === "safe" ? 0.55 : mode === "boost" ? 0.4 : 0.28;
    if (playOut && (!playOut.pass || playOut.confidence < floor)) {
      return null; // AI veto — thin edge
    }
  }

  const rationale = await explainSlip(legs, totalOdds, confidence, snap, mode, playOut);
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

async function pickCrossSportPack(
  pool: AnalyzedLeg[],
  used: Set<string>,
  legsWanted: number,
  maxComboOdds: number,
  minComboOdds: number,
  preferEv = false,
): Promise<AnalyzedLeg[] | null> {
  const available = pool
    .filter((l) => !used.has(l.eventId))
    .slice()
    .sort((a, b) => {
      if (!preferEv) return b.score - a.score;
      return b.score * Math.log(b.odds + 0.15) - a.score * Math.log(a.odds + 0.15);
    });
  if (available.length < legsWanted) return null;

  // Greedy: take best remaining legs from distinct sports first
  const pack: AnalyzedLeg[] = [];
  const sports = new Set<string>();
  let combo = 1;

  for (const leg of available) {
    if (pack.length >= legsWanted) break;
    const sp = leg.sport || "football";
    if (sports.has(sp) && sports.size < legsWanted) continue;
    if (combo * leg.odds > maxComboOdds) continue;
    pack.push(leg);
    sports.add(sp);
    combo *= leg.odds;
  }

  // Fill remaining if diversity left gaps
  if (pack.length < legsWanted) {
    for (const leg of available) {
      if (pack.length >= legsWanted) break;
      if (pack.some((p) => p.eventId === leg.eventId)) continue;
      if (combo * leg.odds > maxComboOdds) continue;
      pack.push(leg);
      combo *= leg.odds;
    }
  }

  if (pack.length < legsWanted) return null;
  if (combo < minComboOdds || combo > maxComboOdds) return null;
  return pack;
}

async function buildModeSlips(
  mode: SureMode,
  fixtures: SbEvent[],
  snap: LearningSnapshot,
  count: number,
  excludeEvents: Set<string>,
  allowAi: boolean,
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

  // Slot plan — longshot is always multi-leg profit packs
  const plans: ("single" | "x2" | "x3" | "x4")[] =
    mode === "safe"
      ? ["single", "single", "x2"]
      : mode === "boost"
        ? ["single", "x2", "x3"]
        : ["x3", "x4", "x3"];

  for (let i = 0; i < count && slips.length < count; i++) {
    const slot = slots[slips.length] ?? slots[slots.length - 1]! + slips.length;
    const plan = plans[i] ?? (mode === "longshot" ? "x3" : "single");

    if (plan === "x2" || plan === "x3" || plan === "x4") {
      const n = plan === "x4" ? 4 : plan === "x3" ? 3 : 2;
      const minCombo = mode === "safe" ? 1.2 : mode === "boost" ? 2.2 : 3.2;
      let pack = await pickCrossSportPack(
        pool,
        used,
        n,
        lim.maxDoubleOdds,
        minCombo,
        mode !== "safe",
      );
      // Longshot: step down legs if 4-fold not available
      if (!pack && mode === "longshot" && n > 2) {
        for (const alt of [3, 2] as const) {
          if (alt >= n) continue;
          pack = await pickCrossSportPack(
            pool,
            used,
            alt,
            lim.maxDoubleOdds,
            alt === 2 ? 2.8 : 3.2,
            true,
          );
          if (pack) break;
        }
      }
      if (pack) {
        for (const l of pack) used.add(l.eventId);
        const slip = await bookSlip(slot, pack, snap, mode, allowAi);
        if (slip?.code) {
          slips.push(slip);
          continue;
        }
        for (const l of pack) used.delete(l.eventId);
      }
      if (mode === "longshot") continue; // no single fallback for longshot
      // fallback single for safe/boost
    }

    if (mode === "longshot") continue;
    const next = pool.find((l) => !used.has(l.eventId));
    if (!next) break;
    used.add(next.eventId);
    const slip = await bookSlip(slot, [next], snap, mode, allowAi);
    if (slip?.code) slips.push(slip);
  }

  return slips;
}

/**
 * Build Safe (1–3) + Boost (4–6) + Longshot (7–9) Sure slips.
 */
export async function buildSureSlipsOfDay(
  count = 3,
  _history: PastOutcomeSample[] = [],
  opts: { allowAi?: boolean; legHistory?: LegHistoryRow[]; modes?: SureMode[] } = {},
): Promise<SureSlip[]> {
  const now = Date.now();
  const allowAi = Boolean(opts.allowAi && process.env.OPENAI_API_KEY);
  const allFixtures = await getAllSportyFixtures({ maxPagesPerSport: 4 });

  const near = allFixtures.filter(
    (e) => e.kickoff > now + 40 * 60_000 && e.kickoff < now + 36 * 3600_000,
  );
  // Longshot window: later today through ~5 days (multi-day profit packs)
  const multiDay = allFixtures.filter(
    (e) => e.kickoff > now + 2 * 3600_000 && e.kickoff < now + 5 * 24 * 3600_000,
  );

  const snap = buildLearningSnapshot(opts.legHistory ?? []);
  const modes = opts.modes ?? (["safe", "boost", "longshot"] as SureMode[]);
  const slips: SureSlip[] = [];
  const used = new Set<string>();

  for (const mode of modes) {
    const fixtures = mode === "longshot" ? multiDay : near;
    // Fresh exclusion per mode so Longshot isn't starved by Safe/Larger legs
    const modeUsed = mode === "longshot" ? new Set<string>() : used;
    const built = await buildModeSlips(mode, fixtures, snap, count, modeUsed, allowAi);
    for (const s of built) {
      for (const l of s.legs) used.add(l.eventId);
      slips.push(s);
    }
  }

  return slips;
}

export function lagosDay(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}
