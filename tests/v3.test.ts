import { test } from "node:test";
import assert from "node:assert/strict";
import { DEVIG_METHODS, devigPower, devigProportional, devigShin, devigTest, fairProbFromMarket } from "../src/lib/devig";
import {
  benjaminiHochberg,
  evaluateHypothesis,
  matchSharpEvent,
  matchesHypothesis,
  meanCi,
  nameSimilarity,
  pairDoubles,
  patternScan,
  phase0Gaps,
  sharpFairForPick,
  type Hypothesis,
  type ShadowRow,
} from "../src/lib/eval-v3";
import { gradeSelection, parseEventResult, settlementScore } from "../src/lib/prediction-settle";
import { lateCustomerSlip } from "../src/lib/prediction-log";
import { shadowRowsFor } from "../src/lib/shadow-log";
import { closingCoverage, coverageTable, tennisTier, uniqueSelections } from "../src/lib/eval-v3-data";

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// ───────────────────────────── B1 de-vig ─────────────────────────────

test("every de-vig method returns probabilities summing to 1", () => {
  const q = [1 / 1.5, 1 / 4.2, 1 / 6.5];
  for (const f of [devigProportional, devigPower, devigShin]) close(sum(f(q)), 1);
});

test("power and Shin shrink the longshot more than proportional", () => {
  const q = [1 / 1.25, 1 / 5.5, 1 / 13];
  const p = devigProportional(q);
  assert.ok(devigPower(q)[2] < p[2]);
  assert.ok(devigShin(q)[2] < p[2]);
  assert.ok(devigShin(q)[0] > p[0]);
});

test("double chance de-vigs through the underlying 1X2 (proportional matches the stored devig_prob)", () => {
  const mo = { market_id: "10", outcomes: { "9": 1.25, "10": 1.3, "11": 1.9 }, picked_outcome: "9" };
  const s = 1 / 1.25 + 1 / 1.3 + 1 / 1.9;
  close(fairProbFromMarket(mo, "proportional")!, (2 * (1 / 1.25)) / s);
  for (const m of DEVIG_METHODS) {
    const p = fairProbFromMarket(mo, m)!;
    assert.ok(p > 0.5 && p < 1, m);
  }
});

test("fairProbFromMarket rejects incomplete snapshots", () => {
  assert.equal(fairProbFromMarket({ market_id: "1", outcomes: { "1": 2, "2": 0, "3": 3 }, picked_outcome: "1" }, "shin"), null);
  assert.equal(fairProbFromMarket(null, "proportional"), null);
});

test("devigTest scores every method on the same rows and names a best method", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    market_odds: { market_id: "186", outcomes: { "4": 1.4, "5": 2.9 }, picked_outcome: "4" },
    odds: 1.4,
    result: i % 10 < 7 ? "win" : "loss",
  }));
  const t = devigTest(rows);
  assert.equal(t.rows_scored, 60);
  assert.ok(t.best && DEVIG_METHODS.includes(t.best));
  assert.equal(t.overall.proportional?.n, 60);
});

// ───────────────────────────── A2 settlement ─────────────────────────────

const stalledItf = {
  eventId: "sr:match:111111114617212",
  estimateStartTime: 1793197980000,
  status: 6,
  setScore: "1:0",
  gameScore: ["6:3", "6:3"],
  period: "Set 2",
  matchStatus: "set 2",
  playedSeconds: "78:17",
  sport: { id: "sr:sport:5", name: "Tennis", category: { name: "ITF", tournament: { name: "ITF M15 João Pessoa" } } },
};

test("an ITF feed stalled after the last set is graded from completed set game scores", () => {
  const ev = parseEventResult(stalledItf);
  assert.equal(ev.state, "ended");
  assert.deepEqual(ev.ft, { home: 2, away: 0 });
  assert.equal(gradeSelection("TNA", settlementScore("TNA", ev), ev.ht).result, "loss");
  assert.equal(gradeSelection("TNH", settlementScore("TNH", ev), ev.ht).result, "win");
});

test("an unfinished set or a split match is not inferred as final", () => {
  assert.equal(parseEventResult({ ...stalledItf, gameScore: ["6:3", "5:4"] }).state, "live");
  assert.equal(parseEventResult({ ...stalledItf, gameScore: ["6:3", "4:6"] }).state, "live");
  assert.equal(parseEventResult({ ...stalledItf, gameScore: ["6:3", "4:6", "10:8"] }).state, "ended");
  assert.equal(parseEventResult({ ...stalledItf, gameScore: ["7:6", "7:5"] }).state, "ended");
});

test("retirement and walkover are their own state (SportyBet voids undecided markets)", () => {
  const ev = parseEventResult({ ...stalledItf, matchStatus: "Player 1 retired, player 2 won" });
  assert.equal(ev.state, "retired");
  assert.equal(parseEventResult({ ...stalledItf, matchStatus: "Walkover" }).state, "retired");
});

// ───────────────────────────── A3 late customer slips ─────────────────────────────

test("customer slips created after their first kickoff are not logged", () => {
  const now = Date.parse("2026-10-13T14:21:20Z");
  const legs = (k: string) => [{ eventId: "e1", home: "A", away: "B", odds: 1.5, kickoff: k }];
  assert.equal(lateCustomerSlip({ source: "book", slipCode: "SFKA5Y", legs: legs("2026-09-26T12:00:00Z") }, now), true);
  assert.equal(lateCustomerSlip({ source: "builder", slipCode: "X", legs: legs("2026-10-14T12:00:00Z") }, now), false);
  assert.equal(lateCustomerSlip({ source: "sure", slipCode: "S", legs: legs("2026-09-26T12:00:00Z") }, now), false);
  assert.equal(lateCustomerSlip({ source: "book", slipCode: "R", legs: legs("2026-09-26T12:00:00Z"), dataOrigin: "recovered" }, now), false);
});

// ───────────────────────────── D hypotheses ─────────────────────────────

const H1: Hypothesis = {
  id: "H1",
  title: "1X2 / Winner 2.00–2.99",
  definition: { kind: "market_band", markets: ["1X2", "Winner"], odds_min: 2, odds_max: 2.99, legs: [1] },
  success_rule: { metric: "hit_rate_minus_p_fair", ci: 0.95 },
  frozen_at: "2026-10-29T00:00:00Z",
  min_n: 20,
  status: "active",
};
const H2: Hypothesis = { ...H1, id: "H2", definition: { kind: "market_band", markets: ["Team Goals", "Double Chance"], legs: [1, 2] } };
const H3: Hypothesis = {
  ...H1,
  id: "H3",
  definition: { kind: "sharp_value", min_edge: 0.03, max_price_gap_minutes: 5, legs: [1] },
  success_rule: { metric: "mean_clv_sharp", ci: 0.95 },
};

test("market-band and sharp-value hypotheses match only their definition", () => {
  assert.equal(matchesHypothesis(H1, { market: "Winner", sport: "tennis", odds: 2.5, p_fair: 0.38 }), true);
  assert.equal(matchesHypothesis(H1, { market: "Winner", sport: "tennis", odds: 2.99, p_fair: 0.32 }), true);
  assert.equal(matchesHypothesis(H1, { market: "Winner", sport: "tennis", odds: 3.0, p_fair: 0.32 }), false);
  assert.equal(matchesHypothesis(H1, { market: "Double Chance", sport: "football", odds: 2.2, p_fair: 0.4 }), false);
  assert.equal(matchesHypothesis(H2, { market: "Double Chance", sport: "football", odds: 1.3, p_fair: 0.74 }), true);
  assert.equal(matchesHypothesis(H3, { market: "1X2", sport: "football", odds: 2.1, p_fair: null }, { fair: 0.5, gapMinutes: 1 }), true);
  assert.equal(matchesHypothesis(H3, { market: "1X2", sport: "football", odds: 2.05, p_fair: null }, { fair: 0.5, gapMinutes: 1 }), false);
  assert.equal(matchesHypothesis(H3, { market: "1X2", sport: "football", odds: 2.2, p_fair: null }, { fair: 0.5, gapMinutes: 6 }), false);
});

const shadow = (i: number, over: Partial<ShadowRow> = {}): ShadowRow => ({
  hypothesis_id: "H1",
  event_id: `e${i}`,
  pick_code: "1",
  odds: 2.5,
  p_fair: 0.38,
  created_at: `2026-10-30T${String(10 + (i % 12)).padStart(2, "0")}:00:00Z`,
  kickoff: "2026-10-30T23:00:00Z",
  result: i % 2 ? "win" : "loss",
  ...over,
});

test("the evaluator ignores rows created before frozen_at and needs min_n", () => {
  const rows = [...Array.from({ length: 10 }, (_, i) => shadow(i)), shadow(99, { created_at: "2026-10-28T10:00:00Z", result: "win" })];
  const r = evaluateHypothesis(H1, rows);
  assert.equal(r.verdict, "insufficient_n");
  assert.ok("singles" in r && r.singles.n === 10);
});

test("hit rate above p_fair with ROI ≥ 0 passes; draft hypotheses are not evaluated", () => {
  const rows = Array.from({ length: 40 }, (_, i) => shadow(i, { result: i % 5 === 0 ? "loss" : "win" }));
  const r = evaluateHypothesis(H1, rows);
  assert.equal(r.verdict, "pass");
  assert.equal(evaluateHypothesis({ ...H3, status: "draft", frozen_at: null }, rows).verdict, "not_frozen");
});

test("H2 doubles pair legs from different events on the same day", () => {
  const rows = [shadow(1), shadow(2), shadow(3, { event_id: "e2" }), shadow(4, { created_at: "2026-10-31T10:00:00Z" })];
  const pairs = pairDoubles(rows);
  assert.equal(pairs.length, 1);
  assert.notEqual(pairs[0][0].event_id, pairs[0][1].event_id);
});

test("shadow rows are only created after frozen_at and before kickoff", () => {
  const cand = (evaluated: string, kickoff: string) => ({
    event_id: "e1",
    pick_code: "TNH",
    market: "Winner",
    sport: "tennis",
    odds: 2.4,
    p_fair: 0.4,
    evaluated_at: evaluated,
    kickoff,
    dedupe_key: "k",
  });
  assert.equal(shadowRowsFor([cand("2026-10-30T10:00:00Z", "2026-10-30T12:00:00Z")], [H1]).length, 1);
  assert.equal(shadowRowsFor([cand("2026-10-28T10:00:00Z", "2026-10-30T12:00:00Z")], [H1]).length, 0);
  assert.equal(shadowRowsFor([cand("2026-10-30T13:00:00Z", "2026-10-30T12:00:00Z")], [H1]).length, 0);
  assert.equal(shadowRowsFor([cand("2026-10-30T10:00:00Z", "2026-10-30T12:00:00Z")], [{ ...H1, status: "draft" }]).length, 0);
});

// ───────────────────────────── D5 scanner / statistics ─────────────────────────────

test("Benjamini–Hochberg at 10% FDR", () => {
  assert.deepEqual(benjaminiHochberg([0.001, 0.02, 0.03, 0.5], 0.1), [true, true, true, false]);
  assert.deepEqual(benjaminiHochberg([0.2, 0.5, 0.9], 0.1), [false, false, false]);
});

test("meanCi is reproducible and brackets the mean", () => {
  const xs = Array.from({ length: 200 }, (_, i) => (i % 3 ? 0.1 : -0.05));
  const a = meanCi(xs);
  assert.deepEqual(a, meanCi(xs));
  assert.ok(a.ci95 && a.ci95[0] <= a.mean! && a.mean! <= a.ci95[1]);
});

test("pattern scanner only tests cells with n ≥ min_n and labels output as hypothesis", () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ market: "Winner", league: "ITF", odds: 1.5, p_fair: 0.64, result: i % 4 ? "win" : "loss" }));
  rows.push(...Array.from({ length: 50 }, () => ({ market: "1X2", league: "EPL", odds: 2.1, p_fair: 0.45, result: "win" })));
  const s = patternScan(rows, { minN: 400 });
  assert.equal(s.cells_tested, 1);
  assert.equal(s.cells[0].label, "hypothesis");
  assert.equal(s.cells[0].n, 500);
});

// ───────────────────────────── Phase 0 ─────────────────────────────

test("phase0 gaps: episodes, duration brackets and the go/no-go rule", () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 1, h, m)).toISOString();
  const pairs = [
    { sportybet_event_id: "a", pick_code: "1", sporty_odds: 2.0, sharp_fair_prob: 0.5, captured_at: at(10) },
    { sportybet_event_id: "a", pick_code: "1", sporty_odds: 2.2, sharp_fair_prob: 0.5, captured_at: at(10, 30) },
    { sportybet_event_id: "a", pick_code: "1", sporty_odds: 2.2, sharp_fair_prob: 0.5, captured_at: at(11) },
    { sportybet_event_id: "a", pick_code: "1", sporty_odds: 2.0, sharp_fair_prob: 0.5, captured_at: at(11, 30) },
  ];
  const g = phase0Gaps(pairs, 0.03, { minPerDay: 1, minMedianMinutes: 10 });
  assert.equal(g.gaps, 1);
  assert.deepEqual(g.median_duration_minutes, { lower_bound: 30, upper_bound: 90 });
  assert.equal(g.decision, "go");
  assert.equal(phase0Gaps(pairs).decision, "no_go");
  assert.equal(phase0Gaps([]).decision, "no_data");
});

// ───────────────────────────── C1 / C2 ─────────────────────────────

test("name matching handles name order, accents and club suffixes", () => {
  assert.ok(nameSimilarity("Kalinina, Anhelina", "Anhelina Kalinina") === 1);
  assert.ok(nameSimilarity("Atlético Madrid", "Atletico Madrid") === 1);
  assert.ok(nameSimilarity("Manchester United FC", "Manchester United") === 1);
  assert.ok(nameSimilarity("Arsenal", "Chelsea") === 0);
});

test("event matching requires both names and kickoff within ±15 minutes", () => {
  const k = Date.parse("2026-11-01T15:00:00Z");
  const pool = [
    { id: "p1", home: "Cremonese", away: "Lazio", kickoffMs: k + 10 * 60_000 },
    { id: "p2", home: "Cremonese", away: "Lazio", kickoffMs: k + 3 * 3_600_000 },
  ];
  assert.equal(matchSharpEvent({ id: "s", home: "US Cremonese", away: "SS Lazio", kickoffMs: k }, pool)?.event.id, "p1");
  assert.equal(matchSharpEvent({ id: "s", home: "Cremonese", away: "Roma", kickoffMs: k }, pool), null);
});

test("sharp fair probabilities map onto our pick codes", () => {
  const periods = {
    num_0: {
      money_line: { home: 2.45, draw: 3.3, away: 2.9 },
      totals: { "2.5": { points: 2.5, over: 1.9, under: 1.98 } },
      team_totals: { home: { "0.5": { over: 1.2, under: 4.5 } } },
    },
  };
  const h = sharpFairForPick(periods, "1", "proportional")!;
  const x = sharpFairForPick(periods, "X", "proportional")!;
  const dc = sharpFairForPick(periods, "DC1X", "proportional")!;
  close(dc.fair, h.fair + x.fair);
  assert.equal(dc.odds, null);
  assert.equal(h.odds, 2.45);
  assert.ok(sharpFairForPick(periods, "O25", "proportional")!.fair > 0.5);
  assert.ok(sharpFairForPick(periods, "HO05", "proportional")!.fair > 0.7);
  assert.equal(sharpFairForPick(periods, "BTTSY", "proportional"), null);
  // A 2-way (incl. overtime) moneyline can't price our regulation 1X2 or a 3-way winner.
  assert.equal(sharpFairForPick({ num_0: { money_line: { home: 1.8, away: 2.1 } } }, "1", "proportional"), null);
  assert.ok(sharpFairForPick({ num_0: { money_line: { home: 1.8, away: 2.1 } } }, "BBH", "proportional"));
});

// ───────────────────────────── report helpers ─────────────────────────────

test("coverage table counts unique selections; closing coverage needs a price ≤ 15 min before kickoff", () => {
  const rows = [
    { event_id: "e1", pick_code: "1", sport: "football", league: "EPL", market: "1X2", odds: 2, result: "win", evaluated_at: "2026-10-20T10:00:00Z" },
    { event_id: "e1", pick_code: "1", sport: "football", league: "EPL", market: "1X2", odds: 2, result: "win", evaluated_at: "2026-10-20T09:00:00Z" },
    { event_id: "e2", pick_code: "TNH", sport: "tennis", league: "ITF M15 Lima", market: "Winner", odds: 1.5, result: "pending", evaluated_at: "2026-10-20T09:00:00Z" },
  ];
  assert.equal(uniqueSelections(rows).length, 2);
  const c = coverageTable(rows);
  assert.equal(c.unique_candidates, 2);
  assert.equal(c.unique_graded, 1);
  assert.equal(tennisTier("ATP Challenger Lisbon"), "Challenger");
  const now = Date.parse("2026-11-01T12:00:00Z");
  const cov = closingCoverage(
    [
      { kickoff: "2026-11-01T10:00:00Z", sporty_close_at: "2026-11-01T09:56:00Z" },
      { kickoff: "2026-11-01T10:00:00Z", sporty_close_at: "2026-11-01T09:30:00Z" },
      { kickoff: "2026-11-01T13:00:00Z", sporty_close_at: null },
    ],
    null,
    now,
  );
  assert.deepEqual([cov.due, cov.covered], [2, 1]);
});
