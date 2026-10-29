/**
 * Data access + section builders for the Brief v3 report
 * (/api/prediction-log/v3). Read-only; every section degrades to a clear
 * "not available yet" when sql/schema-eval-v3.sql or the sharp feed is missing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CANDIDATES_TABLE,
  EVAL_VIEW,
  EVENT_MAP_TABLE,
  HYPOTHESES_TABLE,
  LINE_PROBE_TABLE,
  PREDICTION_LOG_TABLE,
  SHADOW_VIEW,
  SHARP_ODDS_TABLE,
  auditSchema,
} from "./audit-db";
import { P_FAIR_FROZEN_AT, P_FAIR_METHOD, devigTest, fairProbFromMarket, type MarketOddsLike } from "./devig";
import { evaluateHypothesis, patternScan, phase0Gaps, type Hypothesis, type ProbePair, type ShadowRow } from "./eval-v3";

const PAGE = 1_000;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const ms = (iso: string | null | undefined) => Date.parse(String(iso ?? ""));

/** Everything matching `build` (paged by id), up to `max` rows. */
export async function pageRows<T>(sb: SupabaseClient, table: string, cols: string, build: (q: any) => any, max = 120_000, orderBy = "id") {
  const rows: T[] = [];
  let truncated = false;
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build(sb.from(table).select(cols)).order(orderBy, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return { rows, truncated };
    if (from + PAGE >= max) truncated = true;
  }
  return { rows, truncated };
}

type CandRow = {
  event_id: string;
  pick_code: string | null;
  sport: string | null;
  league: string | null;
  market: string | null;
  odds: number | string | null;
  result: string;
  evaluated_at: string;
  market_odds?: MarketOddsLike | null;
  product_tier?: string | null;
  status?: string | null;
};

/** First evaluation of each (event, pick): the unit every v3 candidate metric counts. */
export function uniqueSelections<T extends { event_id: string; pick_code: string | null; evaluated_at: string }>(rows: T[]): T[] {
  const first = new Map<string, T>();
  for (const r of rows) {
    const k = `${r.event_id}|${r.pick_code}`;
    const cur = first.get(k);
    if (!cur || ms(r.evaluated_at) < ms(cur.evaluated_at)) first.set(k, r);
  }
  return [...first.values()];
}

export function tennisTier(league: string | null): string {
  const l = String(league ?? "");
  if (/itf/i.test(l)) return "ITF";
  if (/challenger/i.test(l)) return "Challenger";
  if (/atp|wta|open|grand slam|davis|billie/i.test(l)) return "ATP/WTA";
  return "other";
}

/** 0.1 coverage table: unique candidates by sport, market and league. */
export function coverageTable(rows: CandRow[]) {
  const u = uniqueSelections(rows);
  const count = (key: (r: CandRow) => string, top = Infinity) =>
    Object.entries(u.reduce<Record<string, number>>((a, r) => ((a[key(r)] = (a[key(r)] ?? 0) + 1), a), {}))
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([k, n]) => ({ key: k, n, share: r4(n / u.length) }));
  const events = new Map(u.map((r) => [r.event_id, r]));
  return {
    unique_candidates: u.length,
    unique_graded: u.filter((r) => r.result === "win" || r.result === "loss").length,
    unique_events: events.size,
    with_market_odds: u.filter((r) => r.market_odds).length,
    by_sport: count((r) => r.sport ?? "?"),
    by_sport_market: count((r) => `${r.sport}|${r.market}`),
    tennis_by_tier: count((r) => (r.sport === "tennis" ? tennisTier(r.league) : "_not_tennis")).filter((x) => x.key !== "_not_tennis"),
    top_leagues: count((r) => `${r.sport}|${r.league}`, 60),
    events_by_sport: Object.entries([...events.values()].reduce<Record<string, number>>((a, r) => ((a[r.sport ?? "?"] = (a[r.sport ?? "?"] ?? 0) + 1), a), {})),
  };
}

/** B2 acceptance: share of selections that kicked off since `sinceIso` with a SportyBet price ≤ 15 min before kickoff. */
export function closingCoverage(rows: { kickoff: string | null; sporty_close_at: string | null }[], sinceIso: string | null, now = Date.now()) {
  const due = rows.filter((r) => {
    const k = ms(r.kickoff);
    return Number.isFinite(k) && k < now && (!sinceIso || k >= ms(sinceIso));
  });
  const covered = due.filter((r) => {
    const at = ms(r.sporty_close_at);
    const k = ms(r.kickoff);
    return Number.isFinite(at) && at <= k && k - at <= 15 * 60_000;
  }).length;
  return { since: sinceIso, due: due.length, covered, coverage: due.length ? r4(covered / due.length) : null, target: 0.95 };
}

const CAND_COLS = "event_id, pick_code, sport, league, market, odds, result, evaluated_at, product_tier, status";

export async function coverageSection(sb: SupabaseClient, fromIso: string) {
  const { rows, truncated } = await pageRows<CandRow>(sb, CANDIDATES_TABLE, `${CAND_COLS}, market_odds`, (q) => q.gte("created_at", fromIso));
  return { from: fromIso, truncated, ...coverageTable(rows) };
}

async function gradedWithMarket(sb: SupabaseClient, fromIso: string) {
  const { rows, truncated } = await pageRows<CandRow>(sb, CANDIDATES_TABLE, `${CAND_COLS}, market_odds`, (q) =>
    q.gte("created_at", fromIso).in("result", ["win", "loss"]).not("market_odds", "is", null),
  );
  return { rows: uniqueSelections(rows), truncated };
}

export async function devigSection(sb: SupabaseClient, fromIso: string) {
  const { rows, truncated } = await gradedWithMarket(sb, fromIso);
  return { from: fromIso, unit: "unique (event, pick) candidate, first evaluation", truncated, ...devigTest(rows as never) };
}

export async function patternsSection(sb: SupabaseClient, fromIso: string, minN: number) {
  const { rows, truncated } = await gradedWithMarket(sb, fromIso);
  const scan = patternScan(
    rows.map((r) => ({ market: r.market, league: r.league, odds: r.odds, result: r.result, p_fair: fairProbFromMarket(r.market_odds, P_FAIR_METHOD) })),
    { minN, fdr: 0.1 },
  );
  return { from: fromIso, p_fair_method: P_FAIR_METHOD, truncated, ...scan };
}

export async function phase0Section(sb: SupabaseClient, fromIso: string | null, threshold: number) {
  const { rows, truncated } = await pageRows<ProbePair & { sport: string | null }>(
    sb,
    LINE_PROBE_TABLE,
    "sportybet_event_id, pick_code, sporty_odds, sharp_fair_prob, captured_at, sport",
    (q) => (fromIso ? q.gte("captured_at", fromIso) : q),
    200_000,
  );
  const gaps = phase0Gaps(rows, threshold);
  const bySport = [...new Set(rows.map((r) => r.sport ?? "?"))].map((s) => {
    const g = phase0Gaps(rows.filter((r) => (r.sport ?? "?") === s), threshold);
    return { sport: s, observations: g.observations, gaps: g.gaps, gaps_per_day: g.gaps_per_day, median_duration_minutes: g.median_duration_minutes };
  });
  return { truncated, ...gaps, by_sport: bySport };
}

/** C1: share of in-scope candidate selections (since sharp capture began) with a sharp price at creation. */
export async function sharpCoverageSection(sb: SupabaseClient) {
  const first = await sb.from(SHARP_ODDS_TABLE).select("captured_at").order("captured_at", { ascending: true }).limit(1);
  const since = first.data?.[0]?.captured_at as string | undefined;
  const maps = await sb.from(EVENT_MAP_TABLE).select("sportybet_event_id", { count: "exact", head: true });
  if (!since) return { started_at: null, mapped_events: maps.count ?? 0, creation_coverage: null, target: 0.9 };
  const sports = (process.env.SHARP_SPORTS || "football,tennis,basketball,hockey").split(",").map((s) => s.trim());
  const [cands, sharp] = await Promise.all([
    pageRows<CandRow>(sb, CANDIDATES_TABLE, "event_id, pick_code, evaluated_at, sport", (q) => q.gte("created_at", since).in("sport", sports)),
    pageRows<{ sportybet_event_id: string; outcome: string }>(sb, SHARP_ODDS_TABLE, "sportybet_event_id, outcome", (q) => q.eq("phase", "creation")),
  ]);
  const have = new Set(sharp.rows.map((r) => `${r.sportybet_event_id}|${r.outcome}`));
  const u = uniqueSelections(cands.rows);
  const covered = u.filter((r) => have.has(`${r.event_id}|${r.pick_code}`)).length;
  const bySport = [...new Set(u.map((r) => r.sport ?? "?"))].map((s) => {
    const list = u.filter((r) => (r.sport ?? "?") === s);
    const k = list.filter((r) => have.has(`${r.event_id}|${r.pick_code}`)).length;
    return { sport: s, selections: list.length, with_sharp_at_creation: k, coverage: list.length ? r4(k / list.length) : null };
  });
  return {
    started_at: since,
    mapped_events: maps.count ?? 0,
    in_scope_selections: u.length,
    with_sharp_at_creation: covered,
    creation_coverage: u.length ? r4(covered / u.length) : null,
    by_sport: bySport,
    target: 0.9,
    note: "Selections the sharp book doesn't price (e.g. BTTS) count as uncovered.",
  };
}

/** C2: a reproducible random sample of event mappings for the 200-row manual spot check. */
export async function mappingSample(sb: SupabaseClient, n: number) {
  const { rows } = await pageRows<Record<string, unknown>>(
    sb,
    EVENT_MAP_TABLE,
    "sportybet_event_id, sharp_event_id, confidence, sportybet_fixture, sharp_fixture, sportybet_kickoff, sharp_kickoff",
    (q) => q,
    50_000,
    "sportybet_event_id",
  );
  let seed = 20_261_023;
  const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
  const shuffled = rows.map((r) => ({ r, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.r);
  return {
    total_mappings: rows.length,
    sample_size: Math.min(n, rows.length),
    acceptance: "≤ 2 mismatches in a 200-row spot check",
    lowest_confidence_first: shuffled.slice(0, n).sort((a, b) => Number(a.confidence) - Number(b.confidence)),
  };
}

export async function hypothesesSection(sb: SupabaseClient) {
  const schema = await auditSchema();
  if (!schema.evalV3) return { available: false, note: "Run sql/schema-eval-v3.sql" };
  const hyps = await sb.from(HYPOTHESES_TABLE).select("id, title, definition, success_rule, frozen_at, min_n, status, note").order("id");
  if (hyps.error) throw new Error(hyps.error.message);
  const { rows, truncated } = await pageRows<ShadowRow>(
    sb,
    SHADOW_VIEW,
    "id, hypothesis_id, event_id, pick_code, odds, p_fair, created_at, kickoff, result, clv_sporty, clv_sharp, sporty_close_at",
    (q) => q,
    200_000,
  );
  return {
    available: true,
    truncated,
    p_fair_method: { method: P_FAIR_METHOD, frozen_at: P_FAIR_FROZEN_AT },
    shadow_rows: rows.length,
    hypotheses: ((hyps.data ?? []) as (Hypothesis & { note?: string })[]).map((h) => ({ note: h.note ?? null, ...evaluateHypothesis(h, rows) })),
    shadow_closing_coverage: closingCoverage(rows as never, null),
  };
}

/** Integrity + acceptance numbers that come straight from the log / view. */
export async function integritySection(sb: SupabaseClient, fromIso: string) {
  const schema = await auditSchema();
  const head = await sb.from(EVAL_VIEW).select("event_id", { count: "exact", head: true }).gte("created_at", fromIso);
  const manualLog = await sb
    .from(PREDICTION_LOG_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("result", "pending")
    .like("settle_note", "needs manual grading%");
  const manualCand = await sb
    .from(CANDIDATES_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("result", "pending")
    .like("settle_note", "needs manual grading%");
  const out: Record<string, unknown> = {
    view_count_since_from: head.error ? null : head.count,
    needs_manual_grading_log: manualLog.error ? null : manualLog.count,
    needs_manual_grading_candidates: manualCand.error ? null : manualCand.count,
  };
  if (!schema.evalV3) return { ...out, v3_schema: false };

  const since = P_FAIR_FROZEN_AT;
  const [logAll, logFair, candAll, candFair, methods] = await Promise.all([
    sb.from(PREDICTION_LOG_TABLE).select("id", { count: "exact", head: true }).gte("created_at", since).eq("data_origin", "prospective").not("market_odds", "is", null),
    sb.from(PREDICTION_LOG_TABLE).select("id", { count: "exact", head: true }).gte("created_at", since).eq("data_origin", "prospective").not("p_fair", "is", null),
    sb.from(CANDIDATES_TABLE).select("id", { count: "exact", head: true }).gte("created_at", since).not("market_odds", "is", null),
    sb.from(CANDIDATES_TABLE).select("id", { count: "exact", head: true }).gte("created_at", since).not("p_fair", "is", null),
    sb.from(PREDICTION_LOG_TABLE).select("devig_method").gte("created_at", since).not("devig_method", "is", null).limit(5_000),
  ]);
  const share = (k?: number | null, n?: number | null) => (n ? r4((k ?? 0) / n) : null);
  const firstClose = await sb.from(PREDICTION_LOG_TABLE).select("sporty_close_at").not("sporty_close_at", "is", null).order("sporty_close_at").limit(1);
  const closeSince = (firstClose.data?.[0]?.sporty_close_at as string | undefined) ?? null;
  let closing: ReturnType<typeof closingCoverage> | null = null;
  if (closeSince) {
    const { rows } = await pageRows<{ kickoff: string; sporty_close_at: string | null }>(
      sb,
      PREDICTION_LOG_TABLE,
      "kickoff, sporty_close_at",
      (q) => q.eq("published", true).gte("kickoff", closeSince).lt("kickoff", new Date().toISOString()),
    );
    closing = closingCoverage(rows, closeSince);
  }
  const [view, maps] = await Promise.all([
    pageRows<{ event_id: string; clv_sporty: number | null; p_fair_sharp_close: number | null }>(
      sb,
      EVAL_VIEW,
      "event_id, clv_sporty, p_fair_sharp_close",
      (q) => q.gte("created_at", fromIso),
      120_000,
      "created_at",
    ),
    pageRows<{ sportybet_event_id: string }>(sb, EVENT_MAP_TABLE, "sportybet_event_id", (q) => q, 200_000, "sportybet_event_id"),
  ]);
  const mappedIds = new Set(maps.rows.map((m) => m.sportybet_event_id));
  const matched = view.rows.filter((r) => mappedIds.has(r.event_id));
  const withSharp = matched.filter((r) => r.p_fair_sharp_close != null).length;
  return {
    ...out,
    v3_schema: true,
    p_fair: {
      method: P_FAIR_METHOD,
      frozen_at: P_FAIR_FROZEN_AT,
      methods_seen: [...new Set((methods.data ?? []).map((r) => r.devig_method))],
      log_rows_with_market: logAll.count ?? 0,
      log_rows_with_p_fair: logFair.count ?? 0,
      log_coverage: share(logFair.count, logAll.count),
      candidate_rows_with_market: candAll.count ?? 0,
      candidate_rows_with_p_fair: candFair.count ?? 0,
      candidate_coverage: share(candFair.count, candAll.count),
    },
    closing_sporty: closing,
    view_rows: view.rows.length,
    view_rows_with_clv_sporty: view.rows.filter((r) => r.clv_sporty != null).length,
    clv_sharp: { matched_view_rows: matched.length, with_clv_sharp: withSharp, coverage: share(withSharp, matched.length), target: 0.95 },
  };
}
