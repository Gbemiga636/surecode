/**
 * Safe combo — a layer on top of the Champion's Safe lane (pure; no I/O).
 *
 * It never changes what the engine picks. From the legs that passed every Safe
 * filter it chooses 6–8 single picks and one combined code at ~2.0–2.6 odds.
 *
 * Rules come from the graded candidate history (Oct 17 → Oct 29, 13,954
 * unique legs): legs win at their de-vigged fair price, so the combined win
 * chance at fixed total odds is highest with the fewest, lowest-margin legs.
 * High-margin legs (≥9% overround), hockey and Draw No Bet lost the most.
 */
import type { BookableLeg } from "./sporty";

export const SAFE_COMBO = {
  legMinOdds: 1.06,
  legMaxOdds: 1.45,
  maxOverround: 0.09,
  excludeSports: ["hockey"] as readonly string[],
  excludePicks: ["DNBH", "DNBA"] as readonly string[],
  comboMinOdds: 2.0,
  comboMaxOdds: 2.6,
  /** Used only when nothing fits the main band. */
  comboFallbackMaxOdds: 3.0,
  comboSizes: [3, 4] as readonly number[],
  comboFallbackSizes: [2, 5] as readonly number[],
  picksMin: 6,
  picksMax: 8,
  /** Combo search runs over this many of the surest legs. */
  searchTop: 16,
  kickoffBufferMs: 45 * 60_000,
} as const;

export type SafeLeg = BookableLeg & {
  /** De-vigged fair probability at the current price. */
  pFair: number;
  overround: number;
  /** Leg was in one of the engine's own Safe slips. */
  engine?: boolean;
  aiNote?: string | null;
};

export type SafeComboChoice = { legs: SafeLeg[]; totalOdds: number; chance: number };

/** Why a leg can't be used, or null when it can. */
export function safeLegProblem(l: SafeLeg, now = Date.now()): string | null {
  if (!l?.eventId || !l.pickCode || !l.marketId || !l.outcomeId) return "not bookable";
  if (!(l.kickoff > now + SAFE_COMBO.kickoffBufferMs)) return "starts too soon";
  if (!(l.odds >= SAFE_COMBO.legMinOdds && l.odds <= SAFE_COMBO.legMaxOdds)) return "price outside Safe range";
  if (!(l.pFair > 0 && l.pFair < 1)) return "no fair price";
  if (!(l.overround < SAFE_COMBO.maxOverround)) return "bookmaker margin too high";
  if (SAFE_COMBO.excludeSports.includes(String(l.sport ?? ""))) return "sport excluded";
  if (SAFE_COMBO.excludePicks.includes(l.pickCode)) return "market excluded";
  return null;
}

/** Return per stake at the fair price (1 − effective margin). */
const valueOf = (l: SafeLeg) => l.pFair * l.odds;

/** One pick per match: the lowest-margin one, then the surest. */
export function bestPerEvent(legs: SafeLeg[]): SafeLeg[] {
  const best = new Map<string, SafeLeg>();
  for (const l of legs) {
    const cur = best.get(l.eventId);
    if (!cur || valueOf(l) > valueOf(cur) + 1e-9 || (Math.abs(valueOf(l) - valueOf(cur)) <= 1e-9 && l.pFair > cur.pFair)) {
      best.set(l.eventId, l);
    }
  }
  return [...best.values()];
}

/** Surest first; lower margin breaks ties. */
export function rankSurest(legs: SafeLeg[]): SafeLeg[] {
  return legs.slice().sort((a, b) => b.pFair - a.pFair || a.overround - b.overround || a.kickoff - b.kickoff);
}

export const comboChance = (legs: SafeLeg[]) => legs.reduce((a, l) => a * l.pFair, 1);
export const comboOdds = (legs: SafeLeg[]) => legs.reduce((a, l) => a * l.odds, 1);

/**
 * Highest-chance combination inside the odds band: distinct matches and
 * leagues, sizes tried as given. Returns null when nothing fits.
 */
export function chooseCombo(
  legs: SafeLeg[],
  opts: { minOdds: number; maxOdds: number; sizes: readonly number[]; searchTop?: number },
): SafeComboChoice | null {
  const pool = rankSurest(legs).slice(0, opts.searchTop ?? SAFE_COMBO.searchTop);
  let best: SafeComboChoice | null = null;
  const pick: SafeLeg[] = [];
  const walk = (start: number, size: number, odds: number) => {
    if (odds > opts.maxOdds) return;
    if (pick.length === size) {
      if (odds < opts.minOdds) return;
      const chance = comboChance(pick);
      if (!best || chance > best.chance + 1e-12) best = { legs: pick.slice(), totalOdds: odds, chance };
      return;
    }
    for (let i = start; i < pool.length; i++) {
      const l = pool[i];
      if (pick.some((p) => p.eventId === l.eventId || (l.league && p.league === l.league))) continue;
      pick.push(l);
      walk(i + 1, size, odds * l.odds);
      pick.pop();
    }
  };
  for (const size of opts.sizes) walk(0, size, 1);
  return best;
}

/** Main band first, then the wider fallback band. */
export function chooseSafeCombo(legs: SafeLeg[]): SafeComboChoice | null {
  return (
    chooseCombo(legs, { minOdds: SAFE_COMBO.comboMinOdds, maxOdds: SAFE_COMBO.comboMaxOdds, sizes: SAFE_COMBO.comboSizes }) ??
    chooseCombo(legs, {
      minOdds: SAFE_COMBO.comboMinOdds,
      maxOdds: SAFE_COMBO.comboFallbackMaxOdds,
      sizes: [...SAFE_COMBO.comboSizes, ...SAFE_COMBO.comboFallbackSizes],
    })
  );
}

/** The surest 6–8 singles, always including the combo's legs. */
export function chooseSinglePicks(legs: SafeLeg[], combo: SafeLeg[] = []): SafeLeg[] {
  const out = [...combo];
  for (const l of rankSurest(legs)) {
    if (out.length >= SAFE_COMBO.picksMax) break;
    if (!out.some((x) => x.eventId === l.eventId)) out.push(l);
  }
  return rankSurest(out);
}

/** Changes whenever the engine's Safe codes for the day change. */
export function safeComboSignature(safeCodes: (string | null | undefined)[]): string {
  return safeCodes.filter(Boolean).map(String).sort().join(",");
}

export type SafeComboPick = {
  eventId: string;
  pickCode: string;
  home: string;
  away: string;
  league?: string;
  sport?: string;
  sportLabel?: string;
  kickoff: number;
  pickLabel: string;
  odds: number;
  chance: number;
  code: string | null;
  url: string | null;
  engine?: boolean;
  note?: string | null;
};

export type SafeComboPayload = {
  day: string;
  status: "ready" | "empty";
  builtAt?: string;
  signature?: string;
  combo: {
    code: string;
    url: string;
    totalOdds: number;
    chance: number;
    legs: SafeComboPick[];
    rationale: string;
  } | null;
  picks: SafeComboPick[];
  ai: boolean;
  note?: string;
};
