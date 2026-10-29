/**
 * De-vig methods for Brief v3 task B1 (pure, for tests and reports).
 *
 * Every method turns the implied probabilities q_i = 1/odds_i of one market
 * into fair probabilities that sum to 1. Double chance (k = 2: every outcome
 * covers two of the three results) is first converted to the underlying
 * home / draw / away implied probabilities, de-vigged there and summed back.
 */

export const DEVIG_METHODS = ["proportional", "power", "shin"] as const;
export type DevigMethod = (typeof DEVIG_METHODS)[number];

/**
 * The method stored as `p_fair` on new rows. Chosen by the B1 comparison
 * (lowest log loss and ECE on 12,593 unique graded candidates since
 * 2026-10-17, see docs/EVALUATION_V3.md) and frozen before Phase D:
 * hypotheses are scored against it, so changing it invalidates every frozen
 * hypothesis.
 */
export const P_FAIR_METHOD: DevigMethod = "proportional";
export const P_FAIR_FROZEN_AT = "2026-10-29T00:00:00.000Z";

const EPS = 1e-9;

function bisect(f: (x: number) => number, lo: number, hi: number, iterations = 80): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < iterations; i++) {
    const m = (a + b) / 2;
    if (f(m) > 0) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

export function devigProportional(q: number[]): number[] {
  const s = q.reduce((a, x) => a + x, 0);
  return q.map((x) => x / s);
}

/** p_i = q_i^c with c chosen so the probabilities sum to 1 (shrinks longshots more). */
export function devigPower(q: number[]): number[] {
  const s = q.reduce((a, x) => a + x, 0);
  if (Math.abs(s - 1) < EPS || q.some((x) => !(x > 0 && x < 1))) return devigProportional(q);
  const c = bisect((c) => q.reduce((a, x) => a + x ** c, 0) - 1, 0.2, 10);
  return q.map((x) => x ** c);
}

/** Shin (1993): bookmaker margin as protection against insider trading; z solved so Σp = 1. */
export function devigShin(q: number[]): number[] {
  const Q = q.reduce((a, x) => a + x, 0);
  if (Q <= 1 + EPS) return devigProportional(q);
  const p = (z: number) => q.map((x) => (Math.sqrt(z * z + (4 * (1 - z) * x * x) / Q) - z) / (2 * (1 - z)));
  const z = bisect((z) => p(z).reduce((a, x) => a + x, 0) - 1, 0, 0.99);
  return devigProportional(p(z));
}

export function devig(q: number[], method: DevigMethod): number[] {
  if (method === "power") return devigPower(q);
  if (method === "shin") return devigShin(q);
  return devigProportional(q);
}

/** SportyBet market id → outcome ids in order (must match market-snapshot's MARKET_OUTCOMES). */
const DOUBLE_CHANCE = new Set(["10", "63"]);

export type MarketOddsLike = {
  market_id?: string;
  outcomes?: Record<string, number>;
  picked_outcome?: string;
};

/**
 * Fair probability of the picked outcome from a stored `market_odds` snapshot.
 * Null when the snapshot is incomplete.
 */
export function fairProbFromMarket(mo: MarketOddsLike | null | undefined, method: DevigMethod): number | null {
  if (!mo?.outcomes || !mo.picked_outcome || !mo.market_id) return null;
  const ids = Object.keys(mo.outcomes);
  const odds = ids.map((id) => Number(mo.outcomes![id]));
  if (!ids.includes(mo.picked_outcome) || odds.some((o) => !(o > 1))) return null;
  const q = odds.map((o) => 1 / o);

  if (DOUBLE_CHANCE.has(mo.market_id)) {
    // 9 = 1X, 10 = 12, 11 = X2  →  home = (1X + 12 − X2) / 2, draw = (1X + X2 − 12) / 2, away = (12 + X2 − 1X) / 2
    const g = (id: string) => 1 / Number(mo.outcomes![id]);
    if (!["9", "10", "11"].every((id) => Number(mo.outcomes![id]) > 1)) return null;
    const h = (g("9") + g("10") - g("11")) / 2;
    const d = (g("9") + g("11") - g("10")) / 2;
    const a = (g("10") + g("11") - g("9")) / 2;
    let fair: number[];
    if (h > 0 && d > 0 && a > 0) fair = devig([h, d, a], method);
    else {
      const s = g("9") + g("10") + g("11");
      fair = [(2 * g("9")) / s, (2 * g("10")) / s, (2 * g("11")) / s];
      const pick = { "9": fair[0], "10": fair[1], "11": fair[2] }[mo.picked_outcome];
      return pick != null && pick > 0 && pick < 1 ? pick : null;
    }
    const [ph, pd, pa] = fair;
    const pick = { "9": ph + pd, "10": ph + pa, "11": pd + pa }[mo.picked_outcome];
    return pick != null && pick > 0 && pick < 1 ? pick : null;
  }

  const fair = devig(q, method);
  const p = fair[ids.indexOf(mo.picked_outcome)];
  return p > 0 && p < 1 ? p : null;
}

// ───────────────────────────── B1 comparison ─────────────────────────────

export const ODDS_BANDS: [number, number, string][] = [
  [1, 1.3, "1.00-1.29"],
  [1.3, 1.6, "1.30-1.59"],
  [1.6, 2, "1.60-1.99"],
  [2, 3, "2.00-2.99"],
  [3, 5, "3.00-4.99"],
  [5, Infinity, "5.00+"],
];

export function oddsBand(odds: number): string | null {
  const b = ODDS_BANDS.find(([lo, hi]) => odds >= lo && odds < hi);
  return b ? b[2] : null;
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

function score(pairs: { p: number; y: 0 | 1 }[]) {
  const n = pairs.length;
  if (!n) return null;
  let ll = 0;
  let brier = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const { p, y } of pairs) {
    const c = Math.min(1 - 1e-6, Math.max(1e-6, p));
    ll -= y ? Math.log(c) : Math.log(1 - c);
    brier += (c - y) ** 2;
    const b = bins[Math.min(9, Math.floor(c * 10))];
    b.n++;
    b.p += c;
    b.y += y;
  }
  const ece = bins.reduce((a, b) => (b.n ? a + (b.n / n) * Math.abs(b.y / b.n - b.p / b.n) : a), 0);
  return {
    n,
    hit_rate: r4(pairs.reduce((a, x) => a + x.y, 0) / n),
    mean_p: r4(pairs.reduce((a, x) => a + x.p, 0) / n),
    log_loss: r4(ll / n),
    brier: r4(brier / n),
    ece: r4(ece),
  };
}

export type DevigTestRow = { market_odds: MarketOddsLike | null; odds: number | string | null; result: string };

/**
 * Log loss, Brier and ECE of each method on the same graded rows (rows any
 * method can't price are dropped for all), overall and by odds band.
 * `best` = lowest overall log loss (ties: lower ECE).
 */
export function devigTest(rows: DevigTestRow[]) {
  const usable = rows
    .filter((r) => r.result === "win" || r.result === "loss")
    .map((r) => {
      const ps = DEVIG_METHODS.map((m) => fairProbFromMarket(r.market_odds, m));
      return { odds: Number(r.odds), y: (r.result === "win" ? 1 : 0) as 0 | 1, ps };
    })
    .filter((r) => r.odds > 1 && r.ps.every((p) => p != null));
  const by = (subset: typeof usable) =>
    Object.fromEntries(DEVIG_METHODS.map((m, i) => [m, score(subset.map((r) => ({ p: r.ps[i] as number, y: r.y })))]));
  const overall = by(usable);
  const ranked = [...DEVIG_METHODS].sort((a, b) => {
    const x = overall[a];
    const y = overall[b];
    if (!x || !y) return 0;
    return x.log_loss - y.log_loss || x.ece - y.ece;
  });
  return {
    rows_in: rows.length,
    rows_scored: usable.length,
    overall,
    by_odds_band: ODDS_BANDS.map(([, , label]) => ({ band: label, ...by(usable.filter((r) => oddsBand(r.odds) === label)) })),
    best: usable.length ? ranked[0] : null,
    frozen: { method: P_FAIR_METHOD, frozen_at: P_FAIR_FROZEN_AT },
  };
}
