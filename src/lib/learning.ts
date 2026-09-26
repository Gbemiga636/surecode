/**
 * Learning layer: aggregate settled SportyBet legs into pick/league/odds-band stats
 * and score today's candidates for maximum hit rate.
 */
import type { BookableLeg } from "./sporty";

export type LegHistoryRow = {
  event_id: string;
  home: string;
  away: string;
  league?: string | null;
  pick_code: string;
  pick_label?: string | null;
  odds?: number | null;
  home_score?: number | null;
  away_score?: number | null;
  won: boolean;
};

export type PickStat = {
  pickCode: string;
  plays: number;
  wins: number;
  winRate: number;
  avgOdds: number;
  /** Bayesian-smoothed win rate */
  smoothed: number;
};

export type LeaguePickStat = {
  league: string;
  pickCode: string;
  plays: number;
  wins: number;
  winRate: number;
  smoothed: number;
};

export type OddsBandStat = {
  band: string;
  plays: number;
  wins: number;
  winRate: number;
  smoothed: number;
};

export type LearningSnapshot = {
  totalLegs: number;
  byPick: PickStat[];
  byLeaguePick: LeaguePickStat[];
  byOddsBand: OddsBandStat[];
  eliteMarkets: string[];
  avoidMarkets: string[];
  advice: string[];
};

function oddsBand(odds: number): string {
  if (odds < 1.2) return "1.00-1.19";
  if (odds < 1.35) return "1.20-1.34";
  if (odds < 1.5) return "1.35-1.49";
  if (odds < 1.75) return "1.50-1.74";
  if (odds < 2.1) return "1.75-2.09";
  return "2.10+";
}

/** Beta(α,β) style shrink toward prior — more stable with thin samples */
function smoothRate(wins: number, plays: number, prior = 0.58, strength = 8): number {
  if (plays <= 0) return prior;
  return (wins + prior * strength) / (plays + strength);
}

export function buildLearningSnapshot(rows: LegHistoryRow[]): LearningSnapshot {
  const pickMap = new Map<string, { plays: number; wins: number; oddsSum: number }>();
  const leagueMap = new Map<string, { plays: number; wins: number }>();
  const bandMap = new Map<string, { plays: number; wins: number }>();

  for (const r of rows) {
    const code = r.pick_code;
    const p = pickMap.get(code) ?? { plays: 0, wins: 0, oddsSum: 0 };
    p.plays++;
    if (r.won) p.wins++;
    p.oddsSum += Number(r.odds) || 0;
    pickMap.set(code, p);

    const lg = (r.league || "unknown").trim() || "unknown";
    const key = `${lg}|${code}`;
    const l = leagueMap.get(key) ?? { plays: 0, wins: 0 };
    l.plays++;
    if (r.won) l.wins++;
    leagueMap.set(key, l);

    const band = oddsBand(Number(r.odds) || 0);
    const b = bandMap.get(band) ?? { plays: 0, wins: 0 };
    b.plays++;
    if (r.won) b.wins++;
    bandMap.set(band, b);
  }

  const byPick: PickStat[] = [...pickMap.entries()]
    .map(([pickCode, v]) => ({
      pickCode,
      plays: v.plays,
      wins: v.wins,
      winRate: v.plays ? v.wins / v.plays : 0,
      avgOdds: v.plays ? v.oddsSum / v.plays : 0,
      smoothed: smoothRate(v.wins, v.plays),
    }))
    .sort((a, b) => b.smoothed - a.smoothed || b.plays - a.plays);

  const byLeaguePick: LeaguePickStat[] = [...leagueMap.entries()]
    .map(([key, v]) => {
      const [league, pickCode] = key.split("|");
      return {
        league,
        pickCode,
        plays: v.plays,
        wins: v.wins,
        winRate: v.plays ? v.wins / v.plays : 0,
        smoothed: smoothRate(v.wins, v.plays, 0.55, 6),
      };
    })
    .filter((x) => x.plays >= 3)
    .sort((a, b) => b.smoothed - a.smoothed || b.plays - a.plays);

  const byOddsBand: OddsBandStat[] = [...bandMap.entries()]
    .map(([band, v]) => ({
      band,
      plays: v.plays,
      wins: v.wins,
      winRate: v.plays ? v.wins / v.plays : 0,
      smoothed: smoothRate(v.wins, v.plays, 0.55, 10),
    }))
    .sort((a, b) => b.smoothed - a.smoothed);

  const eliteMarkets = byPick
    .filter((p) => p.plays >= 10 && p.smoothed >= 0.62)
    .map((p) => p.pickCode);
  const avoidMarkets = byPick
    .filter((p) => p.plays >= 10 && p.smoothed < 0.5)
    .map((p) => p.pickCode);

  const advice: string[] = [];
  if (eliteMarkets.length) {
    advice.push(
      `Elite trained markets: ${byPick
        .filter((p) => eliteMarkets.includes(p.pickCode))
        .slice(0, 5)
        .map((p) => `${p.pickCode} ${Math.round(p.smoothed * 100)}%`)
        .join(", ")}`,
    );
  }
  if (avoidMarkets.length) {
    advice.push(
      `Trained avoid list: ${avoidMarkets
        .slice(0, 4)
        .map((c) => {
          const p = byPick.find((x) => x.pickCode === c)!;
          return `${c} ${Math.round(p.smoothed * 100)}%`;
        })
        .join(", ")}`,
    );
  }
  const bestBand = byOddsBand.find((b) => b.plays >= 12);
  if (bestBand) {
    advice.push(
      `Best odds band historically: ${bestBand.band} (~${Math.round(bestBand.smoothed * 100)}% of ${bestBand.plays})`,
    );
  }
  advice.push(
    rows.length < 80
      ? `Training bank: ${rows.length} settled legs — grows every crawl.`
      : `Training bank: ${rows.length} settled SportyBet legs powering Sure AI.`,
  );

  return {
    totalLegs: rows.length,
    byPick,
    byLeaguePick,
    byOddsBand,
    eliteMarkets,
    avoidMarkets,
    advice,
  };
}

/** Score a live candidate — higher = better for sure slips. */
export function scoreLeg(leg: BookableLeg, snap: LearningSnapshot): number {
  const pick = snap.byPick.find((p) => p.pickCode === leg.pickCode);
  const league = snap.byLeaguePick.find(
    (p) => p.league === (leg.league || "unknown") && p.pickCode === leg.pickCode,
  );
  const band = snap.byOddsBand.find((b) => b.band === oddsBand(leg.odds));

  let winPrior = 0.58;
  if (pick && pick.plays >= 4) winPrior = pick.smoothed;
  if (league && league.plays >= 3) {
    winPrior = winPrior * 0.4 + league.smoothed * 0.6;
  }
  if (band && band.plays >= 8) {
    winPrior = winPrior * 0.7 + band.smoothed * 0.3;
  }

  // Hard penalty for trained-weak markets
  if (snap.avoidMarkets.includes(leg.pickCode)) winPrior *= 0.72;
  // Boost trained-elite markets
  if (snap.eliteMarkets.includes(leg.pickCode)) winPrior *= 1.12;

  const odds = leg.odds;
  let oddsFit = 0;
  if (odds >= 1.12 && odds <= 1.32) oddsFit = 1.25;
  else if (odds > 1.32 && odds <= 1.45) oddsFit = 1.1;
  else if (odds > 1.45 && odds <= 1.65) oddsFit = 0.85;
  else if (odds > 1.65 && odds <= 1.95) oddsFit = 0.55;
  else if (odds > 1.95 && odds <= 2.3) oddsFit = 0.35;
  else oddsFit = 0.12;

  return winPrior * 3.1 + oddsFit * 1.4 + leg.implied * 1.15;
}

export function formatLearningForAi(snap: LearningSnapshot): object {
  return {
    settledLegs: snap.totalLegs,
    eliteMarkets: snap.eliteMarkets,
    avoidMarkets: snap.avoidMarkets,
    pickWinRates: snap.byPick.slice(0, 20).map((p) => ({
      pick: p.pickCode,
      winRate: Number(p.smoothed.toFixed(3)),
      raw: Number(p.winRate.toFixed(3)),
      plays: p.plays,
      avgOdds: Number(p.avgOdds.toFixed(2)),
    })),
    oddsBands: snap.byOddsBand.slice(0, 8),
    hotLeaguePicks: snap.byLeaguePick.slice(0, 15).map((p) => ({
      league: p.league,
      pick: p.pickCode,
      winRate: Number(p.smoothed.toFixed(3)),
      plays: p.plays,
    })),
    advice: snap.advice,
  };
}
