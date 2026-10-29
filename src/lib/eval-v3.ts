/**
 * Brief v3 evaluation logic (pure, for tests and the v3 report).
 *
 *  - hypotheses (D1/D3/D4): matching, frozen-window evaluation, success rules
 *  - pattern scanner (D5): descriptive cells with Benjamini–Hochberg FDR
 *  - Phase 0 (0.4): SportyBet vs sharp gap frequency and duration
 *  - sharp event matching (C2) and pick → sharp fair probability (C1)
 */
import { devig, oddsBand, type DevigMethod } from "./devig";
import { mulberry32 } from "./evaluation";

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const ms = (iso: string | null | undefined) => Date.parse(String(iso ?? ""));

// ───────────────────────────── statistics ─────────────────────────────

function percentile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Mean with a seeded percentile-bootstrap 95% interval. */
export function meanCi(values: number[], iterations = 2_000, seed = 20_261_023) {
  const n = values.length;
  if (!n) return { n: 0, mean: null, ci95: null };
  const mean = values.reduce((a, x) => a + x, 0) / n;
  if (n < 2) return { n, mean: r4(mean), ci95: null };
  const rand = mulberry32(seed);
  const means: number[] = new Array(iterations);
  for (let it = 0; it < iterations; it++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[Math.floor(rand() * n)];
    means[it] = s / n;
  }
  means.sort((a, b) => a - b);
  return { n, mean: r4(mean), ci95: [r4(percentile(means, 0.025)), r4(percentile(means, 0.975))] as [number, number] };
}

/** Two-sided normal-approximation p-value that the mean is zero. */
export function meanPValue(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((a, x) => a + x, 0) / n;
  const sd = Math.sqrt(values.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1));
  if (!(sd > 0)) return mean === 0 ? 1 : 0;
  const z = Math.abs(mean / (sd / Math.sqrt(n)));
  // Abramowitz–Stegun 7.1.26 erfc approximation.
  const t = 1 / (1 + 0.3275911 * (z / Math.SQRT2));
  const erfc =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-((z / Math.SQRT2) ** 2));
  return Math.min(1, Math.max(0, erfc));
}

/** Benjamini–Hochberg: which of the p-values are discoveries at false-discovery rate q. */
export function benjaminiHochberg(pValues: number[], q = 0.1): boolean[] {
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  let cutoff = -1;
  order.forEach(({ p }, rank) => {
    if (p <= ((rank + 1) / m) * q) cutoff = rank;
  });
  const out = new Array<boolean>(m).fill(false);
  for (let r = 0; r <= cutoff; r++) out[order[r].i] = true;
  return out;
}

// ───────────────────────────── hypotheses ─────────────────────────────

export type HypothesisDefinition =
  | { kind: "market_band"; markets: string[]; odds_min?: number; odds_max?: number; sports?: string[]; legs: number[] }
  | { kind: "sharp_value"; min_edge: number; max_price_gap_minutes: number; legs: number[] };

export type Hypothesis = {
  id: string;
  title: string;
  definition: HypothesisDefinition;
  success_rule: { metric: "hit_rate_minus_p_fair" | "mean_clv_sharp"; ci: number; gate_deciding?: boolean };
  frozen_at: string | null;
  min_n: number;
  status: "draft" | "active" | "retired";
};

export type ShadowCandidate = {
  market: string | null;
  sport: string | null;
  odds: number | string | null;
  p_fair: number | string | null;
};

/** Does a candidate (at creation) fall inside a market-band hypothesis? Sharp-value matching needs a sharp price. */
export function matchesHypothesis(h: Pick<Hypothesis, "definition">, c: ShadowCandidate, sharp?: { fair: number; gapMinutes: number }): boolean {
  const d = h.definition;
  const odds = Number(c.odds);
  if (!(odds > 1)) return false;
  if (d.kind === "market_band") {
    if (!c.market || !d.markets.includes(c.market)) return false;
    if (d.sports?.length && !d.sports.includes(String(c.sport))) return false;
    if (d.odds_min != null && odds < d.odds_min) return false;
    if (d.odds_max != null && odds > d.odds_max + 1e-9) return false;
    return true;
  }
  if (!sharp || !(sharp.fair > 0 && sharp.fair < 1) || sharp.gapMinutes > d.max_price_gap_minutes) return false;
  return odds * sharp.fair - 1 >= d.min_edge - 1e-9;
}

export function isFrozenActive(h: Pick<Hypothesis, "status" | "frozen_at">): boolean {
  return h.status === "active" && Boolean(h.frozen_at) && Number.isFinite(ms(h.frozen_at));
}

export type ShadowRow = {
  id?: string;
  hypothesis_id: string;
  event_id: string;
  pick_code: string;
  odds: number | string;
  p_fair: number | string | null;
  created_at: string;
  kickoff: string | null;
  result: string;
  clv_sporty?: number | string | null;
  clv_sharp?: number | string | null;
};

type Unit = { y: 0 | 1; p: number; odds: number; clvSporty: number | null; clvSharp: number | null };

function unitStats(units: Unit[], seed: number) {
  const n = units.length;
  const wins = units.reduce((a, u) => a + u.y, 0);
  const priced = units.filter((u) => u.p > 0 && u.p < 1);
  const edge = meanCi(priced.map((u) => u.y - u.p), 2_000, seed);
  const roi = meanCi(units.map((u) => (u.y ? u.odds - 1 : -1)), 2_000, seed + 1);
  const cs = units.map((u) => u.clvSporty).filter((x): x is number => x != null && Number.isFinite(x));
  const ch = units.map((u) => u.clvSharp).filter((x): x is number => x != null && Number.isFinite(x));
  return {
    n,
    wins,
    hit_rate: n ? r4(wins / n) : null,
    mean_p_fair: priced.length ? r4(priced.reduce((a, u) => a + u.p, 0) / priced.length) : null,
    edge_vs_p_fair: edge,
    roi_flat_stake: roi,
    clv_sporty: meanCi(cs, 2_000, seed + 2),
    clv_sharp: meanCi(ch, 2_000, seed + 3),
  };
}

/**
 * H2 two-leg slips: graded singles paired in creation order within the same
 * UTC day, never two legs from one event. Deterministic, so re-running gives
 * the same slips.
 */
export function pairDoubles(rows: ShadowRow[]): [ShadowRow, ShadowRow][] {
  const byDay = new Map<string, ShadowRow[]>();
  for (const r of [...rows].sort((a, b) => ms(a.created_at) - ms(b.created_at) || a.event_id.localeCompare(b.event_id))) {
    const day = r.created_at.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), r]);
  }
  const out: [ShadowRow, ShadowRow][] = [];
  for (const list of byDay.values()) {
    const open = [...list];
    while (open.length >= 2) {
      const a = open.shift()!;
      const j = open.findIndex((b) => b.event_id !== a.event_id);
      if (j < 0) break;
      out.push([a, open.splice(j, 1)[0]]);
    }
  }
  return out;
}

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** Evaluate one frozen hypothesis on its shadow rows (rows created at or before frozen_at are ignored). */
export function evaluateHypothesis(h: Hypothesis, rows: ShadowRow[]) {
  const frozen = isFrozenActive(h);
  const base = { id: h.id, title: h.title, status: h.status, frozen_at: h.frozen_at, min_n: h.min_n, metric: h.success_rule.metric };
  if (!frozen) return { ...base, verdict: "not_frozen" as const, note: "Draft hypotheses are not evaluated." };
  const after = rows.filter((r) => r.hypothesis_id === h.id && ms(r.created_at) > ms(h.frozen_at));
  const graded = after.filter((r) => r.result === "win" || r.result === "loss");
  const toUnit = (r: ShadowRow): Unit => ({
    y: r.result === "win" ? 1 : 0,
    p: Number(r.p_fair) || 0,
    odds: Number(r.odds),
    clvSporty: num(r.clv_sporty),
    clvSharp: num(r.clv_sharp),
  });
  const singles = unitStats(graded.map(toUnit), 20_261_023);
  const doubles = h.definition.legs.includes(2)
    ? unitStats(
        pairDoubles(graded).map(([a, b]) => {
          const ua = toUnit(a);
          const ub = toUnit(b);
          return { y: (ua.y && ub.y ? 1 : 0) as 0 | 1, p: ua.p * ub.p, odds: ua.odds * ub.odds, clvSporty: null, clvSharp: null };
        }),
        20_261_024,
      )
    : null;

  const decide = (s: ReturnType<typeof unitStats>, n: number) => {
    if (n < h.min_n) return "insufficient_n" as const;
    if (h.success_rule.metric === "mean_clv_sharp") return (s.clv_sharp.ci95?.[0] ?? -1) > 0 ? ("pass" as const) : ("fail" as const);
    const lowOk = (s.edge_vs_p_fair.ci95?.[0] ?? -1) > 0;
    const roiOk = (s.roi_flat_stake.mean ?? -1) >= 0;
    return lowOk && roiOk ? ("pass" as const) : ("fail" as const);
  };
  const n = h.success_rule.metric === "mean_clv_sharp" ? singles.clv_sharp.n : singles.n;
  return {
    ...base,
    logged_since_frozen: after.length,
    pending: after.filter((r) => r.result === "pending").length,
    singles,
    doubles,
    verdict: decide(singles, n),
    doubles_verdict: doubles ? decide(doubles, doubles.n) : null,
  };
}

// ───────────────────────────── D5 pattern scanner ─────────────────────────────

export type ScanRow = { market: string | null; league: string | null; odds: number | string | null; p_fair: number | null; result: string };

/**
 * Descriptive cells (market × league × odds band) with n ≥ minN: hit rate,
 * mean p_fair, edge (hit − p_fair) with bootstrap CI, ROI, and BH-adjusted
 * discoveries at `fdr`. Output is labelled "hypothesis" and never feeds live selection.
 */
export function patternScan(rows: ScanRow[], opts: { minN?: number; fdr?: number } = {}) {
  const minN = opts.minN ?? 400;
  const fdr = opts.fdr ?? 0.1;
  const cells = new Map<string, { y: 0 | 1; p: number; odds: number }[]>();
  for (const r of rows) {
    const odds = Number(r.odds);
    if ((r.result !== "win" && r.result !== "loss") || !(odds > 1) || !(Number(r.p_fair) > 0)) continue;
    const band = oddsBand(odds);
    if (!band) continue;
    const key = `${r.market ?? "?"}|${r.league ?? "?"}|${band}`;
    const list = cells.get(key) ?? [];
    list.push({ y: r.result === "win" ? 1 : 0, p: Number(r.p_fair), odds });
    cells.set(key, list);
  }
  const tested = [...cells.entries()].filter(([, l]) => l.length >= minN);
  const stats = tested.map(([key, list], i) => {
    const [market, league, band] = key.split("|");
    const edges = list.map((u) => u.y - u.p);
    const roi = list.map((u) => (u.y ? u.odds - 1 : -1));
    return {
      label: "hypothesis" as const,
      market,
      league,
      odds_band: band,
      n: list.length,
      hit_rate: r4(list.reduce((a, u) => a + u.y, 0) / list.length),
      mean_p_fair: r4(list.reduce((a, u) => a + u.p, 0) / list.length),
      edge: meanCi(edges, 1_000, 20_261_100 + i),
      roi_flat_stake: r4(roi.reduce((a, x) => a + x, 0) / roi.length),
      p_value: meanPValue(edges),
    };
  });
  const disc = benjaminiHochberg(stats.map((s) => s.p_value ?? 1), fdr);
  return {
    label: "hypothesis — descriptive only, never used for live selection",
    min_n: minN,
    fdr,
    cells_total: cells.size,
    cells_tested: stats.length,
    discoveries: disc.filter(Boolean).length,
    cells: stats.map((s, i) => ({ ...s, bh_discovery: disc[i] })).sort((a, b) => (a.p_value ?? 1) - (b.p_value ?? 1)),
  };
}

// ───────────────────────────── Phase 0 gaps ─────────────────────────────

export type ProbePair = {
  sportybet_event_id: string;
  pick_code: string;
  sporty_odds: number | string;
  sharp_fair_prob: number | string;
  captured_at: string;
  sporty_captured_at?: string;
  sharp_captured_at?: string;
};

/**
 * Gap episodes: consecutive observations of one selection where
 * sporty_odds ≥ sharp_fair_odds × (1 + threshold). Duration is bracketed by
 * the polling interval: `min` = first→last observation inside the gap,
 * `max` = last observation before → first observation after.
 */
export function phase0Gaps(pairs: ProbePair[], threshold = 0.03, rule = { minPerDay: 5, minMedianMinutes: 10 }) {
  const series = new Map<string, ProbePair[]>();
  for (const p of pairs) {
    const k = `${p.sportybet_event_id}|${p.pick_code}`;
    series.set(k, [...(series.get(k) ?? []), p]);
  }
  const episodes: { key: string; start: string; minMinutes: number; maxMinutes: number | null }[] = [];
  const days = new Set<string>();
  for (const [key, list] of series) {
    list.sort((a, b) => ms(a.captured_at) - ms(b.captured_at));
    let i = 0;
    while (i < list.length) {
      days.add(list[i].captured_at.slice(0, 10));
      const gap = (p: ProbePair) => Number(p.sporty_odds) * Number(p.sharp_fair_prob) - 1 >= threshold - 1e-9;
      if (!gap(list[i])) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < list.length && gap(list[j + 1])) {
        j++;
        days.add(list[j].captured_at.slice(0, 10));
      }
      const before = i > 0 ? ms(list[i - 1].captured_at) : null;
      const after = j + 1 < list.length ? ms(list[j + 1].captured_at) : null;
      episodes.push({
        key,
        start: list[i].captured_at,
        minMinutes: (ms(list[j].captured_at) - ms(list[i].captured_at)) / 60_000,
        maxMinutes: before != null && after != null ? (after - before) / 60_000 : null,
      });
      i = j + 1;
    }
  }
  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return r4(percentile(s, 0.5));
  };
  const perDay = days.size ? episodes.length / days.size : 0;
  const medMin = median(episodes.map((e) => e.minMinutes));
  const maxes = episodes.map((e) => e.maxMinutes).filter((x): x is number => x != null);
  const medMax = median(maxes);
  let decision: "go" | "no_go" | "inconclusive" | "no_data";
  if (!pairs.length) decision = "no_data";
  else if (perDay < rule.minPerDay) decision = "no_go";
  else if ((medMin ?? 0) >= rule.minMedianMinutes) decision = "go";
  else if (medMax != null && medMax < rule.minMedianMinutes) decision = "no_go";
  else decision = "inconclusive";
  return {
    threshold,
    rule: `go if ≥ ${rule.minPerDay} gaps/day and median duration ≥ ${rule.minMedianMinutes} min`,
    observations: pairs.length,
    selections: series.size,
    days_observed: days.size,
    gaps: episodes.length,
    gaps_per_day: r4(perDay),
    median_duration_minutes: { lower_bound: medMin, upper_bound: medMax },
    decision,
    decision_note:
      decision === "inconclusive"
        ? "Gaps are frequent but the polling interval is too coarse to show they last 10+ minutes; poll more often."
        : null,
    by_day: [...days].sort().map((d) => ({ day: d, gaps: episodes.filter((e) => e.start.startsWith(d)).length })),
  };
}

// ───────────────────────────── sharp matching (C2) ─────────────────────────────

const STOP = new Set(["fc", "cf", "sc", "ac", "afc", "cd", "fk", "sk", "if", "bk", "club", "de", "the", "u", "ud", "sd", "sv", "us", "as", "ca"]);

export function normalizeName(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !STOP.has(t));
}

/** Token overlap (Dice) with prefix tolerance ("utd" ~ "united", "man" ~ "manchester"). */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x.length || !y.length) return 0;
  const used = new Set<number>();
  let hits = 0;
  for (const t of x) {
    const j = y.findIndex((u, i) => !used.has(i) && (u === t || (t.length >= 3 && u.startsWith(t)) || (u.length >= 3 && t.startsWith(u))));
    if (j >= 0) {
      used.add(j);
      hits++;
    }
  }
  return (2 * hits) / (x.length + y.length);
}

export type MatchableEvent = { id: string; home: string; away: string; kickoffMs: number };

/** Best sharp event within ±15 min whose home and away names both resemble ours; null if none is good enough. */
export function matchSharpEvent(ev: MatchableEvent, pool: MatchableEvent[], opts = { windowMin: 15, minSide: 0.5 }) {
  let best: { event: MatchableEvent; confidence: number } | null = null;
  for (const s of pool) {
    if (Math.abs(s.kickoffMs - ev.kickoffMs) > opts.windowMin * 60_000) continue;
    const h = nameSimilarity(ev.home, s.home);
    const a = nameSimilarity(ev.away, s.away);
    if (h < opts.minSide || a < opts.minSide) continue;
    const confidence = r4((h + a) / 2);
    if (!best || confidence > best.confidence) best = { event: s, confidence };
  }
  return best;
}

// ───────────────────────────── pick → sharp fair (C1) ─────────────────────────────

export type SharpPeriod = {
  money_line?: { home?: number; away?: number; draw?: number } | null;
  totals?: Record<string, { points?: number; over?: number; under?: number }> | null;
  team_total?: { home?: { points?: number; over?: number; under?: number }; away?: { points?: number; over?: number; under?: number } } | null;
  team_totals?: { home?: Record<string, { over?: number; under?: number }>; away?: Record<string, { over?: number; under?: number }> } | null;
};

const ok = (x: unknown): x is number => typeof x === "number" && x > 1;

function threeWay(p: SharpPeriod | undefined, method: DevigMethod) {
  const m = p?.money_line;
  if (!m || !ok(m.home) || !ok(m.draw) || !ok(m.away)) return null;
  const [h, d, a] = devig([1 / m.home, 1 / m.draw, 1 / m.away], method);
  return { h, d, a, m };
}

function twoWay(over: unknown, under: unknown, method: DevigMethod) {
  if (!ok(over) || !ok(under)) return null;
  const [o, u] = devig([1 / over, 1 / under], method);
  return { o, u };
}

function teamLine(p: SharpPeriod | undefined, side: "home" | "away", points: number) {
  const alt = p?.team_totals?.[side]?.[String(points)] ?? p?.team_totals?.[side]?.[points.toFixed(1)];
  if (alt) return alt;
  const main = p?.team_total?.[side];
  return main && Number(main.points) === points ? main : null;
}

const TOTALS: Record<string, [number, "over" | "under"]> = {
  O05: [0.5, "over"],
  O15: [1.5, "over"],
  O25: [2.5, "over"],
  U15: [1.5, "under"],
  U25: [2.5, "under"],
};

/**
 * Sharp fair probability (and the sharp price when the outcome is priced
 * directly) for one of our pick codes. `periods.num_0` = full game,
 * `num_1` = first half. Null when the sharp book has no comparable market
 * (e.g. BTTS, or a 2-way hockey moneyline against our regulation 1X2).
 */
export function sharpFairForPick(
  periods: Record<string, SharpPeriod> | null | undefined,
  pickCode: string,
  method: DevigMethod,
): { odds: number | null; fair: number } | null {
  const g = periods?.num_0;
  const h1 = periods?.num_1;
  const valid = (r: { odds: number | null; fair: number } | null) => (r && r.fair > 0 && r.fair < 1 ? r : null);
  switch (pickCode) {
    case "1":
    case "X":
    case "2": {
      const t = threeWay(g, method);
      if (!t) return null;
      return valid(pickCode === "1" ? { odds: t.m.home!, fair: t.h } : pickCode === "X" ? { odds: t.m.draw!, fair: t.d } : { odds: t.m.away!, fair: t.a });
    }
    case "DC1X":
    case "DC12":
    case "DCX2":
    case "1HDC1X":
    case "1HDCX2": {
      const t = threeWay(pickCode.startsWith("1H") ? h1 : g, method);
      if (!t) return null;
      const fair = pickCode.endsWith("1X") ? t.h + t.d : pickCode.endsWith("12") ? t.h + t.a : t.d + t.a;
      return valid({ odds: null, fair });
    }
    case "DNBH":
    case "DNBA": {
      const t = threeWay(g, method);
      if (!t) return null;
      return valid({ odds: null, fair: pickCode === "DNBH" ? t.h / (t.h + t.a) : t.a / (t.h + t.a) });
    }
    case "BBH":
    case "BBA":
    case "TNH":
    case "TNA": {
      const m = g?.money_line;
      if (!m || !ok(m.home) || !ok(m.away) || ok(m.draw)) return null;
      const [ph, pa] = devig([1 / m.home, 1 / m.away], method);
      return valid(pickCode.endsWith("H") ? { odds: m.home, fair: ph } : { odds: m.away, fair: pa });
    }
    case "HO05":
    case "AO05": {
      const line = teamLine(g, pickCode === "HO05" ? "home" : "away", 0.5);
      const t = line ? twoWay(line.over, line.under, method) : null;
      return t ? valid({ odds: line!.over ?? null, fair: t.o }) : null;
    }
    case "1HO05": {
      const line = h1?.totals?.["0.5"];
      const t = line ? twoWay(line.over, line.under, method) : null;
      return t ? valid({ odds: line!.over ?? null, fair: t.o }) : null;
    }
    default: {
      const tot = TOTALS[pickCode];
      if (!tot) return null;
      const line = g?.totals?.[String(tot[0])] ?? g?.totals?.[tot[0].toFixed(1)];
      const t = line ? twoWay(line.over, line.under, method) : null;
      if (!t) return null;
      return valid(tot[1] === "over" ? { odds: line!.over ?? null, fair: t.o } : { odds: line!.under ?? null, fair: t.u });
    }
  }
}
