/**
 * Matched-control selection lift (pure functions).
 *
 * Question: are the high-confidence picks the Sure engine selected better than
 * comparable picks it rejected? Each selected pick is matched to rejected
 * candidates from the same tier, sport, market and day, in the same lead-time
 * bucket and within a narrow implied-probability band (same league when such
 * controls exist). Matching uses only what was known before kickoff; results
 * are only used to score the matched groups.
 */

export type LiftCandidate = {
  id?: string;
  product_tier: string | null;
  sport: string | null;
  league: string | null;
  market: string | null;
  pick_code: string | null;
  event_id: string;
  odds: number | string | null;
  kickoff: string | null;
  evaluated_at: string | null;
  day: string | null;
  status: string;
  result: string;
};

export type LiftOptions = {
  /** Minimum raw implied probability (1/odds) for a selected pick to count as high-confidence. */
  minImplied: number;
  /** Max |implied(selected) − implied(control)|. */
  impliedTolerance: number;
  /** Controls per selected pick (nearest by implied probability, without replacement). */
  controlsPerSelected: number;
  /** Subgroups with fewer matched selected picks are reported but flagged. */
  minGroupSize: number;
};

export const DEFAULT_LIFT_OPTIONS: LiftOptions = {
  minImplied: 0.7,
  impliedTolerance: 0.05,
  controlsPerSelected: 3,
  minGroupSize: 30,
};

const LEAD_BUCKETS: [number, string][] = [
  [3, "0-3h"],
  [12, "3-12h"],
  [24, "12-24h"],
  [72, "24-72h"],
  [Infinity, "72h+"],
];

export function leadBucket(evaluatedAt: string | null, kickoff: string | null): string | null {
  const e = Date.parse(String(evaluatedAt ?? ""));
  const k = Date.parse(String(kickoff ?? ""));
  if (!Number.isFinite(e) || !Number.isFinite(k) || e >= k) return null;
  const hours = (k - e) / 3_600_000;
  return LEAD_BUCKETS.find(([max]) => hours < max)![1];
}

const implied = (odds: LiftCandidate["odds"]) => {
  const o = Number(odds);
  return o > 1 ? 1 / o : null;
};

type Prepared = LiftCandidate & { p: number; lead: string; y: 0 | 1 };

/**
 * One row per unique selection (event_id, pick_code) within a tier. The
 * candidate log keeps one row per day, so a fixture evaluated on two days
 * appears twice. Keeps the earliest selected row when the engine ever
 * selected it, otherwise the earliest rejected row.
 */
export function uniqueCandidates<T extends Pick<LiftCandidate, "event_id" | "pick_code" | "status" | "evaluated_at"> & { product_tier: string | null }>(
  rows: T[],
): T[] {
  const best = new Map<string, T>();
  const t = (r: T) => Date.parse(String(r.evaluated_at ?? "")) || Infinity;
  for (const r of rows) {
    const key = `${r.product_tier ?? ""}|${r.event_id}|${r.pick_code ?? ""}`;
    const cur = best.get(key);
    const better =
      !cur ||
      (r.status === "selected" && cur.status !== "selected") ||
      (r.status === cur.status && t(r) < t(cur));
    if (better) best.set(key, r);
  }
  return [...best.values()];
}

const selectionKey = (r: Pick<LiftCandidate, "event_id" | "pick_code">) => `${r.event_id}|${r.pick_code ?? ""}`;

/** Graded (win/loss), priced, evaluated before kickoff, one row per unique selection. */
function prepare(rows: LiftCandidate[]): Prepared[] {
  const out: Prepared[] = [];
  for (const r of uniqueCandidates(rows)) {
    if (r.result !== "win" && r.result !== "loss") continue;
    const p = implied(r.odds);
    const lead = leadBucket(r.evaluated_at, r.kickoff);
    if (p == null || !lead || !r.product_tier || !r.market || !r.day) continue;
    out.push({ ...r, p, lead, y: r.result === "win" ? 1 : 0 });
  }
  return out;
}

export type MatchedPair = { selected: Prepared; controls: Prepared[]; leagueMatched: boolean };

/** Greedy nearest-neighbour matching without replacement. */
export function matchControls(rows: LiftCandidate[], opts: LiftOptions = DEFAULT_LIFT_OPTIONS) {
  const prepared = prepare(rows);
  const cell = (r: Prepared) => [r.product_tier, r.sport ?? "", r.market, r.day, r.lead].join("|");
  const pool = new Map<string, Prepared[]>();
  for (const r of prepared) {
    if (r.status !== "rejected") continue;
    const list = pool.get(cell(r)) ?? [];
    list.push(r);
    pool.set(cell(r), list);
  }
  const selected = prepared
    .filter((r) => r.status === "selected" && r.p >= opts.minImplied)
    .sort((a, b) => Date.parse(String(a.evaluated_at)) - Date.parse(String(b.evaluated_at)));

  const used = new Set<Prepared>();
  const pairs: MatchedPair[] = [];
  let unmatched = 0;
  for (const s of selected) {
    const near = (pool.get(cell(s)) ?? []).filter(
      (c) => !used.has(c) && c.event_id !== s.event_id && Math.abs(c.p - s.p) <= opts.impliedTolerance,
    );
    const sameLeague = s.league ? near.filter((c) => c.league === s.league) : [];
    const candidates = sameLeague.length ? sameLeague : near;
    const controls = candidates
      .sort((a, b) => Math.abs(a.p - s.p) - Math.abs(b.p - s.p))
      .slice(0, opts.controlsPerSelected);
    if (!controls.length) {
      unmatched++;
      continue;
    }
    for (const c of controls) used.add(c);
    pairs.push({ selected: s, controls, leagueMatched: sameLeague.length > 0 });
  }
  return { pairs, eligibleSelected: selected.length, unmatched };
}

function wilson(k: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** Newcombe (method 10) 95% interval for a difference of two proportions. */
export function diffInterval(k1: number, n1: number, k2: number, n2: number): [number, number] | null {
  const a = wilson(k1, n1);
  const b = wilson(k2, n2);
  if (!a || !b) return null;
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const d = p1 - p2;
  return [d - Math.sqrt((p1 - a[0]) ** 2 + (b[1] - p2) ** 2), d + Math.sqrt((a[1] - p1) ** 2 + (p2 - b[0]) ** 2)];
}

const pct = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 10);

export type LiftRow = {
  group: string;
  unique_selected_n: number;
  unique_control_n: number;
  selected_n: number;
  selected_wins: number;
  selected_hit_rate_pct: number | null;
  rejected_n: number;
  rejected_wins: number;
  rejected_hit_rate_pct: number | null;
  selection_lift_pp: number | null;
  lift_ci95_pp: [number, number] | null;
  avg_implied_selected_pct: number | null;
  avg_implied_rejected_pct: number | null;
  league_matched_share_pct: number | null;
  sufficient: boolean;
};

export function summarizePairs(group: string, pairs: MatchedPair[], minGroupSize: number): LiftRow {
  const sel = pairs.map((p) => p.selected);
  const ctl = pairs.flatMap((p) => p.controls);
  const sw = sel.reduce((a, r) => a + r.y, 0);
  const cw = ctl.reduce((a, r) => a + r.y, 0);
  const sRate = sel.length ? sw / sel.length : null;
  const cRate = ctl.length ? cw / ctl.length : null;
  const ci = diffInterval(sw, sel.length, cw, ctl.length);
  const mean = (xs: Prepared[]) => (xs.length ? xs.reduce((a, r) => a + r.p, 0) / xs.length : null);
  return {
    group,
    unique_selected_n: new Set(sel.map(selectionKey)).size,
    unique_control_n: new Set(ctl.map(selectionKey)).size,
    selected_n: sel.length,
    selected_wins: sw,
    selected_hit_rate_pct: pct(sRate),
    rejected_n: ctl.length,
    rejected_wins: cw,
    rejected_hit_rate_pct: pct(cRate),
    selection_lift_pp: sRate != null && cRate != null ? pct(sRate - cRate) : null,
    lift_ci95_pp: ci ? [pct(ci[0])!, pct(ci[1])!] : null,
    avg_implied_selected_pct: pct(mean(sel)),
    avg_implied_rejected_pct: pct(mean(ctl)),
    league_matched_share_pct: pairs.length ? pct(pairs.filter((p) => p.leagueMatched).length / pairs.length) : null,
    sufficient: sel.length >= minGroupSize,
  };
}

export function selectionLiftReport(rows: LiftCandidate[], opts: LiftOptions = DEFAULT_LIFT_OPTIONS) {
  const { pairs, eligibleSelected, unmatched } = matchControls(rows, opts);
  const by = (key: (p: MatchedPair) => string) => {
    const m = new Map<string, MatchedPair[]>();
    for (const p of pairs) {
      const k = key(p);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return [...m.entries()]
      .map(([k, v]) => summarizePairs(k, v, opts.minGroupSize))
      .sort((a, b) => b.selected_n - a.selected_n);
  };
  const tierOf = (p: MatchedPair) => p.selected.product_tier ?? "unknown";
  return {
    options: opts,
    coverage: {
      candidate_rows: rows.length,
      unique_candidate_selections: uniqueCandidates(rows).length,
      graded_pre_kickoff_unique: prepare(rows).length,
      eligible_selected: eligibleSelected,
      matched_selected: pairs.length,
      unmatched_selected: unmatched,
    },
    /** Every pair was matched inside one tier, so pooling the pairs keeps tiers separate. */
    overall_matched_within_tier: summarizePairs("all tiers (matched within tier)", pairs, opts.minGroupSize),
    by_tier: by(tierOf),
    by_tier_sport: by((p) => `${tierOf(p)} · ${p.selected.sport ?? "unknown"}`),
    by_tier_market: by((p) => `${tierOf(p)} · ${p.selected.market}`),
  };
}
