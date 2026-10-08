/**
 * Official performance metrics for the prediction audit (pure functions).
 *
 * Legs and slips are always reported separately. Probability quality is
 * measured on whatever probability was logged (`confidence`) and, separately,
 * on the raw bookmaker-implied probability (1 / odds) so the two can be
 * compared honestly.
 */

export type ReportRow = {
  event_id: string | null;
  pick_code: string | null;
  source: string | null;
  product_tier?: string | null;
  data_origin?: string | null;
  sport: string | null;
  market: string | null;
  model_version: string | null;
  slip_code: string | null;
  odds: number | null;
  confidence: number | null;
  closing_odds: number | null;
  result: string;
  kickoff: string | null;
  created_at: string;
  settled_at: string | null;
  settle_note: string | null;
  slip_odds: number | null;
};

export type CandidateRow = {
  product_tier: string | null;
  market: string | null;
  sport: string | null;
  odds: number | null;
  status: string;
  result: string;
};

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Wilson 95% interval for a proportion. */
export function wilson(wins: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.96;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [r4(Math.max(0, centre - half)), r4(Math.min(1, centre + half))];
}

export function oddsBand(odds: number | null): string {
  if (!odds || odds <= 1) return "unknown";
  if (odds < 1.25) return "1.01-1.24";
  if (odds < 1.5) return "1.25-1.49";
  if (odds < 2) return "1.50-1.99";
  if (odds < 3) return "2.00-2.99";
  return "3.00+";
}

type ProbStats = { n: number; brier: number | null; log_loss: number | null; ece: number | null };

function probQuality(pairs: { p: number; y: 0 | 1 }[]): ProbStats & { buckets: unknown[] } {
  const valid = pairs.filter((x) => x.p > 0 && x.p < 1);
  if (!valid.length) return { n: 0, brier: null, log_loss: null, ece: null, buckets: [] };
  let brier = 0;
  let ll = 0;
  const buckets = new Map<number, { sumP: number; sumY: number; n: number }>();
  for (const { p, y } of valid) {
    brier += (p - y) ** 2;
    const pc = Math.min(1 - 1e-6, Math.max(1e-6, p));
    ll += -(y * Math.log(pc) + (1 - y) * Math.log(1 - pc));
    const b = Math.min(9, Math.floor(p * 10));
    const cur = buckets.get(b) ?? { sumP: 0, sumY: 0, n: 0 };
    cur.sumP += p;
    cur.sumY += y;
    cur.n++;
    buckets.set(b, cur);
  }
  let ece = 0;
  const out = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([b, v]) => {
      const expected = v.sumP / v.n;
      const observed = v.sumY / v.n;
      ece += (v.n / valid.length) * Math.abs(expected - observed);
      return {
        bucket: `${b * 10}-${b * 10 + 10}%`,
        n: v.n,
        expected: r4(expected),
        observed: r4(observed),
        ci95: wilson(v.sumY, v.n),
      };
    });
  return {
    n: valid.length,
    brier: r4(brier / valid.length),
    log_loss: r4(ll / valid.length),
    ece: r4(ece),
    buckets: out,
  };
}

function legSummary(rows: ReportRow[]) {
  const c = { total: rows.length, win: 0, loss: 0, void: 0, cancelled: 0, pending: 0 };
  let profit = 0;
  let staked = 0;
  let clvSum = 0;
  let clvN = 0;
  let beatClose = 0;
  for (const r of rows) {
    if (r.result in c) (c as Record<string, number>)[r.result]++;
    const odds = Number(r.odds) || 0;
    if (r.result === "win" || r.result === "loss" || r.result === "void") {
      staked++;
      if (r.result === "win") profit += odds - 1;
      else if (r.result === "loss") profit -= 1;
    }
    const close = Number(r.closing_odds) || 0;
    if (odds > 1 && close > 1) {
      clvSum += odds / close - 1;
      clvN++;
      if (odds > close) beatClose++;
    }
  }
  const graded = c.win + c.loss;
  return {
    ...c,
    graded,
    hit_rate: graded ? r4(c.win / graded) : null,
    hit_rate_ci95: wilson(c.win, graded),
    roi_flat_stake: staked ? r4(profit / staked) : null,
    profit_units: r4(profit),
    clv: clvN ? { n: clvN, avg: r4(clvSum / clvN), beat_close_rate: r4(beatClose / clvN) } : null,
  };
}

type SlipOutcome = "win" | "loss" | "void" | "pending";

function slipSummary(rows: ReportRow[]) {
  const slips = new Map<string, ReportRow[]>();
  for (const r of rows) {
    if (!r.slip_code) continue;
    const key = `${r.source}|${r.slip_code}`;
    const list = slips.get(key);
    if (list) list.push(r);
    else slips.set(key, [r]);
  }
  const c = { total: slips.size, win: 0, loss: 0, void: 0, pending: 0 };
  let profit = 0;
  let staked = 0;
  let oddsSum = 0;
  const byLegs = new Map<number, { n: number; win: number; graded: number }>();
  for (const legs of slips.values()) {
    let outcome: SlipOutcome;
    if (legs.some((l) => l.result === "loss")) outcome = "loss";
    else if (legs.some((l) => l.result === "pending")) outcome = "pending";
    else if (legs.every((l) => l.result === "void" || l.result === "cancelled")) outcome = "void";
    else outcome = "win";
    c[outcome]++;
    const live = legs.filter((l) => l.result === "win");
    const payout = live.reduce((a, l) => a * (Number(l.odds) || 1), 1);
    oddsSum += Number(legs[0].slip_odds) || legs.reduce((a, l) => a * (Number(l.odds) || 1), 1);
    if (outcome === "win") {
      staked++;
      profit += payout - 1;
    } else if (outcome === "loss") {
      staked++;
      profit -= 1;
    } else if (outcome === "void") staked++;
    const n = legs.length;
    const b = byLegs.get(n) ?? { n: 0, win: 0, graded: 0 };
    b.n++;
    if (outcome === "win" || outcome === "loss") b.graded++;
    if (outcome === "win") b.win++;
    byLegs.set(n, b);
  }
  const graded = c.win + c.loss;
  return {
    ...c,
    graded,
    win_rate: graded ? r4(c.win / graded) : null,
    win_rate_ci95: wilson(c.win, graded),
    avg_slip_odds: slips.size ? r4(oddsSum / slips.size) : null,
    roi_flat_stake: staked ? r4(profit / staked) : null,
    by_leg_count: [...byLegs.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([legs, v]) => ({
        legs,
        slips: v.n,
        graded: v.graded,
        win_rate: v.graded ? r4(v.win / v.graded) : null,
        ci95: wilson(v.win, v.graded),
      })),
  };
}

function groupBy(rows: ReportRow[], key: (r: ReportRow) => string) {
  const m = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const k = key(r) || "unknown";
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return [...m.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([k, list]) => {
      const s = legSummary(list);
      return {
        key: k,
        legs: s.total,
        graded: s.graded,
        hit_rate: s.hit_rate,
        ci95: s.hit_rate_ci95,
        roi_flat_stake: s.roi_flat_stake,
        avg_clv: s.clv?.avg ?? null,
      };
    });
}

function dataQuality(rows: ReportRow[]) {
  const now = Date.now();
  let overdue = 0;
  let review = 0;
  let late = 0;
  let noEvent = 0;
  for (const r of rows) {
    const ko = r.kickoff ? Date.parse(r.kickoff) : NaN;
    if (r.result === "pending" && !r.settled_at && Number.isFinite(ko) && now - ko > 6 * 3_600_000) overdue++;
    if (r.result === "pending" && r.settle_note?.startsWith("needs manual grading")) review++;
    if (Number.isFinite(ko) && Date.parse(r.created_at) >= ko) late++;
    if (!r.event_id) noEvent++;
  }
  return {
    pending_overdue_6h: overdue,
    needs_manual_grading: review,
    logged_after_kickoff: late,
    missing_event_id: noEvent,
  };
}

/** Selected vs rejected hit rate inside matched tier × market × odds-band cells. */
export function selectionLift(rows: CandidateRow[]) {
  const settled = rows.filter((r) => r.result === "win" || r.result === "loss");
  const cells = new Map<string, { tier: string; sel: [number, number]; rej: [number, number] }>();
  for (const r of settled) {
    const tier = r.product_tier || "unknown";
    const key = `${tier}|${r.market || "?"}|${oddsBand(r.odds)}`;
    const cell = cells.get(key) ?? { tier, sel: [0, 0], rej: [0, 0] };
    const side = r.status === "selected" ? cell.sel : cell.rej;
    side[1]++;
    if (r.result === "win") side[0]++;
    cells.set(key, cell);
  }
  const byTier = new Map<string, { w: number; lift: number; selN: number; rejN: number; cells: number }>();
  const detail: unknown[] = [];
  for (const [key, c] of cells) {
    if (!c.sel[1] || !c.rej[1]) continue;
    const selRate = c.sel[0] / c.sel[1];
    const rejRate = c.rej[0] / c.rej[1];
    const t = byTier.get(c.tier) ?? { w: 0, lift: 0, selN: 0, rejN: 0, cells: 0 };
    t.w += c.sel[1];
    t.lift += c.sel[1] * (selRate - rejRate);
    t.selN += c.sel[1];
    t.rejN += c.rej[1];
    t.cells++;
    byTier.set(c.tier, t);
    const [tier, market, band] = key.split("|");
    detail.push({
      tier,
      market,
      odds_band: band,
      selected: { n: c.sel[1], hit_rate: r4(selRate), ci95: wilson(c.sel[0], c.sel[1]) },
      rejected: { n: c.rej[1], hit_rate: r4(rejRate), ci95: wilson(c.rej[0], c.rej[1]) },
      lift: r4(selRate - rejRate),
    });
  }
  return {
    settled_candidates: settled.length,
    by_tier: [...byTier.entries()].map(([tier, t]) => ({
      tier,
      matched_cells: t.cells,
      selected_n: t.selN,
      control_n: t.rejN,
      selection_lift: t.w ? r4(t.lift / t.w) : null,
    })),
    cells: detail,
    note:
      "Lift = selected hit rate − rejected hit rate within the same tier, market and odds band, weighted by selected count. Treat small cells as noise.",
  };
}

/**
 * One row per distinct selection (source, tier, event, market), keeping the
 * first time it was published. The Sure board is re-booked through the day,
 * so the same leg can sit in many slips; per-row leg stats weight it by the
 * number of slips it appeared in.
 */
export function uniqueSelections(rows: ReportRow[]): ReportRow[] {
  const first = new Map<string, ReportRow>();
  for (const r of rows) {
    const key = `${r.source ?? ""}|${r.product_tier ?? ""}|${r.event_id ?? ""}|${r.pick_code ?? ""}`;
    const cur = first.get(key);
    if (!cur || Date.parse(r.created_at) < Date.parse(cur.created_at)) first.set(key, r);
  }
  return [...first.values()];
}

export function buildReport(rows: ReportRow[], candidates: CandidateRow[] | null) {
  const settled = rows.filter((r) => r.result === "win" || r.result === "loss");
  const y = (r: ReportRow): 0 | 1 => (r.result === "win" ? 1 : 0);
  return {
    legs: legSummary(rows),
    unique_selections: legSummary(uniqueSelections(rows)),
    slips: slipSummary(rows),
    probability_quality: {
      logged_confidence: probQuality(
        settled.filter((r) => r.confidence != null).map((r) => ({ p: Number(r.confidence), y: y(r) })),
      ),
      bookmaker_implied: probQuality(
        settled.filter((r) => Number(r.odds) > 1).map((r) => ({ p: 1 / Number(r.odds), y: y(r) })),
      ),
    },
    breakdown: {
      by_source: groupBy(rows, (r) => r.source ?? ""),
      by_tier: groupBy(rows, (r) => r.product_tier ?? ""),
      by_sport: groupBy(rows, (r) => r.sport ?? ""),
      by_market: groupBy(rows, (r) => r.market ?? ""),
      by_odds_band: groupBy(rows, (r) => oddsBand(Number(r.odds))),
      by_model_version: groupBy(rows, (r) => r.model_version ?? ""),
      by_data_origin: groupBy(rows, (r) => r.data_origin ?? "prospective"),
    },
    data_quality: dataQuality(rows),
    selection_lift: candidates ? selectionLift(candidates) : null,
  };
}
