/**
 * Learning layer: aggregate settled SportyBet legs into pick/league stats
 * and score today's candidates for stronger, fewer-leg slips.
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
};

export type LeaguePickStat = {
  league: string;
  pickCode: string;
  plays: number;
  wins: number;
  winRate: number;
};

export type LearningSnapshot = {
  totalLegs: number;
  byPick: PickStat[];
  byLeaguePick: LeaguePickStat[];
  advice: string[];
};

export function buildLearningSnapshot(rows: LegHistoryRow[]): LearningSnapshot {
  const pickMap = new Map<string, { plays: number; wins: number; oddsSum: number }>();
  const leagueMap = new Map<string, { plays: number; wins: number }>();

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
  }

  const byPick: PickStat[] = [...pickMap.entries()]
    .map(([pickCode, v]) => ({
      pickCode,
      plays: v.plays,
      wins: v.wins,
      winRate: v.plays ? v.wins / v.plays : 0,
      avgOdds: v.plays ? v.oddsSum / v.plays : 0,
    }))
    .sort((a, b) => b.plays - a.plays);

  const byLeaguePick: LeaguePickStat[] = [...leagueMap.entries()]
    .map(([key, v]) => {
      const [league, pickCode] = key.split("|");
      return {
        league,
        pickCode,
        plays: v.plays,
        wins: v.wins,
        winRate: v.plays ? v.wins / v.plays : 0,
      };
    })
    .filter((x) => x.plays >= 3)
    .sort((a, b) => b.winRate - a.winRate || b.plays - a.plays);

  const advice: string[] = [];
  const strong = byPick.filter((p) => p.plays >= 8 && p.winRate >= 0.65);
  const weak = byPick.filter((p) => p.plays >= 8 && p.winRate < 0.55);
  if (strong.length) {
    advice.push(
      `Historically strong markets: ${strong
        .slice(0, 4)
        .map((p) => `${p.pickCode} ${Math.round(p.winRate * 100)}% (${p.plays})`)
        .join(", ")}`,
    );
  }
  if (weak.length) {
    advice.push(
      `Avoid or reduce: ${weak
        .slice(0, 3)
        .map((p) => `${p.pickCode} ${Math.round(p.winRate * 100)}%`)
        .join(", ")}`,
    );
  }
  if (rows.length < 50) {
    advice.push(
      `Learning bank: ${rows.length} settled legs — grows each crawl. Aim for 1000+ for sharper weights.`,
    );
  } else {
    advice.push(`Learning bank: ${rows.length} settled SportyBet legs.`);
  }

  return { totalLegs: rows.length, byPick, byLeaguePick, advice };
}

/** Score a live candidate using history (higher = better for sure slips). */
export function scoreLeg(
  leg: BookableLeg,
  snap: LearningSnapshot,
): number {
  const pick = snap.byPick.find((p) => p.pickCode === leg.pickCode);
  const league = snap.byLeaguePick.find(
    (p) => p.league === (leg.league || "unknown") && p.pickCode === leg.pickCode,
  );

  // Prior when thin history
  let winPrior = 0.55;
  if (pick && pick.plays >= 5) winPrior = pick.winRate;
  if (league && league.plays >= 4) {
    winPrior = winPrior * 0.45 + league.winRate * 0.55;
  }

  // Prefer SHORT-MID elite prices for hit rate (sure mode)
  const odds = leg.odds;
  let oddsFit = 0;
  if (odds >= 1.18 && odds <= 1.45) oddsFit = 1.15;
  else if (odds > 1.45 && odds <= 1.65) oddsFit = 1.0;
  else if (odds > 1.65 && odds <= 1.85) oddsFit = 0.7;
  else if (odds > 1.85 && odds <= 2.2) oddsFit = 0.4;
  else oddsFit = 0.15;

  // Expected hit orientation (not bankroll growth)
  return winPrior * 2.6 + oddsFit * 1.35 + leg.implied * 0.9;
}

export function formatLearningForAi(snap: LearningSnapshot): object {
  return {
    settledLegs: snap.totalLegs,
    pickWinRates: snap.byPick.slice(0, 20).map((p) => ({
      pick: p.pickCode,
      winRate: Number(p.winRate.toFixed(3)),
      plays: p.plays,
      avgOdds: Number(p.avgOdds.toFixed(2)),
    })),
    hotLeaguePicks: snap.byLeaguePick.slice(0, 15).map((p) => ({
      league: p.league,
      pick: p.pickCode,
      winRate: Number(p.winRate.toFixed(3)),
      plays: p.plays,
    })),
    advice: snap.advice,
  };
}
