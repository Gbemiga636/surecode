import { test } from "node:test";
import assert from "node:assert/strict";
import { leadBucket, matchControls, selectionLiftReport, type LiftCandidate } from "../src/lib/selection-lift";
import { settlePatchFor } from "../src/lib/prediction-settle";

const KO = "2026-10-10T15:00:00Z";
const row = (o: Partial<LiftCandidate>): LiftCandidate => ({
  product_tier: "safe",
  sport: "football",
  league: "EPL",
  market: "1X2",
  pick_code: "1",
  event_id: Math.random().toString(36),
  odds: 1.3,
  kickoff: KO,
  evaluated_at: "2026-10-10T10:00:00Z",
  day: "2026-10-10",
  status: "rejected",
  result: "win",
  ...o,
});

test("lead time buckets use only pre-kickoff evaluations", () => {
  assert.equal(leadBucket("2026-10-10T13:00:00Z", KO), "0-3h");
  assert.equal(leadBucket("2026-10-10T10:00:00Z", KO), "3-12h");
  assert.equal(leadBucket(KO, KO), null);
  assert.equal(leadBucket("2026-10-10T16:00:00Z", KO), null);
});

test("controls come from the same tier, sport, market, day and lead bucket", () => {
  const s = row({ status: "selected", odds: 1.3 });
  const rows = [
    s,
    row({ odds: 1.32, result: "loss" }),
    row({ odds: 1.3, product_tier: "boost" }),
    row({ odds: 1.3, market: "Over/Under" }),
    row({ odds: 1.3, day: "2026-10-11" }),
    row({ odds: 1.3, evaluated_at: "2026-10-10T14:00:00Z" }),
    row({ odds: 2.5 }),
    row({ odds: 1.3, result: "pending" }),
  ];
  const { pairs } = matchControls(rows);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].controls.length, 1);
  assert.equal(pairs[0].controls[0].result, "loss");
});

test("same-league controls are preferred and never reused", () => {
  const rows = [
    row({ status: "selected", event_id: "a" }),
    row({ status: "selected", event_id: "b" }),
    row({ league: "EPL", event_id: "c" }),
    row({ league: "Serie A", event_id: "d" }),
  ];
  const { pairs } = matchControls(rows, { minImplied: 0.7, impliedTolerance: 0.05, controlsPerSelected: 1, minGroupSize: 1 });
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].controls[0].league, "EPL");
  assert.equal(pairs[0].leagueMatched, true);
  assert.equal(pairs[1].controls[0].league, "Serie A");
  assert.equal(pairs[1].leagueMatched, false);
});

test("selection lift is selected hit rate minus matched rejected hit rate", () => {
  const rows = [
    row({ status: "selected", result: "win" }),
    row({ status: "selected", result: "win" }),
    row({ result: "win" }),
    row({ result: "loss" }),
    row({ result: "loss" }),
    row({ result: "loss" }),
  ];
  const r = selectionLiftReport(rows, { minImplied: 0.7, impliedTolerance: 0.05, controlsPerSelected: 2, minGroupSize: 30 });
  const o = r.overall_matched_within_tier;
  assert.equal(o.selected_n, 2);
  assert.equal(o.rejected_n, 4);
  assert.equal(o.selected_hit_rate_pct, 100);
  assert.equal(o.rejected_hit_rate_pct, 25);
  assert.equal(o.selection_lift_pp, 75);
  assert.equal(o.sufficient, false);
});

test("low-confidence selections are not counted as high-confidence", () => {
  const r = selectionLiftReport([row({ status: "selected", odds: 2.0 }), row({ odds: 2.0 })]);
  assert.equal(r.coverage.eligible_selected, 0);
});

test("candidate settlement patches drop columns the candidate table lacks", () => {
  const patch = { result: "win", final_score: "2-1", settled_at: "x", result_source: "auto", ht_score: undefined };
  assert.deepEqual(settlePatchFor("prediction_candidates", true, patch), { result: "win", final_score: "2-1", settled_at: "x" });
  assert.equal(settlePatchFor("prediction_log", true, patch).result_source, "auto");
  assert.deepEqual(Object.keys(settlePatchFor("prediction_log", false, { ...patch, settle_attempts: 2 })).sort(), ["final_score", "result", "settled_at"]);
});
