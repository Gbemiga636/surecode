import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSlips,
  customerSlipLevel,
  devigCoverage,
  enumCheck,
  evalSelections,
  legLevel,
  modelVsMarket,
  officialSlipLevel,
  productOf,
  recoveredBreakdown,
  tierOf,
  versionCheck,
  type EvalRow,
} from "../src/lib/evaluation";
import { snapshotFromBook } from "../src/lib/market-snapshot";
import { selectionLiftReport, uniqueCandidates, type LiftCandidate } from "../src/lib/selection-lift";

const row = (o: Partial<EvalRow>): EvalRow => ({
  event_id: "e1",
  pick_code: "DC1X",
  source: "sure",
  slot: 1,
  product_tier: "safe",
  data_origin: "prospective",
  published: true,
  predicted_before_kickoff: true,
  result: "win",
  odds: 1.25,
  confidence: 0.8,
  devig_prob: 0.84,
  created_at: "2026-10-10T08:00:00Z",
  kickoff: "2026-10-10T15:00:00Z",
  model_version: "sure-engine/2026.10",
  app_commit: "1c0a0bf",
  slip_code: "S1",
  slip_odds: 1.25,
  slip_confidence: 0.8,
  sport: "football",
  ...o,
});

test("product and tier mapping (task 2)", () => {
  assert.equal(productOf("sure"), "sure-engine");
  assert.equal(productOf("plenty"), "plenty-codes");
  assert.equal(productOf("builder"), "combo-builder");
  assert.equal(productOf("demo-auto"), "demo");
  assert.equal(productOf("sure-combine"), "user");
  assert.equal(productOf("book"), "user");
  // Sure: by slot, whatever product_tier says (recovered rows carry 'sure')
  assert.equal(tierOf("sure", 2, "sure"), "safe");
  assert.equal(tierOf("sure", 5, "sure"), "boost");
  assert.equal(tierOf("sure", 9, "longshot"), "longshot");
  assert.equal(tierOf("sure", null, "boost"), "boost");
  assert.equal(tierOf("plenty", null, "SAFE"), "safe");
  for (const t of ["VALUE", "AI", "COMBO", "tip", "user"]) assert.equal(tierOf("plenty", null, t), "none");
  assert.equal(tierOf("predictions", null, "tip"), "none");
  const check = enumCheck([row({}), row({ source: "plenty", product_tier: "VALUE", slot: null })]);
  assert.deepEqual(check, { tiers_outside_enum: 0, products_outside_enum: 0, published_rows_without_product: 0 });
});

test("evalSelections mirrors v_eval_selections (tasks 1 and 3)", () => {
  const rows = [
    row({ slip_code: "S1", created_at: "2026-10-10T09:00:00Z" }),
    row({ slip_code: "S2", created_at: "2026-10-10T08:00:00Z" }), // earliest copy is kept
    row({ slip_code: "S3", created_at: "2026-10-10T10:00:00Z" }),
    row({ event_id: "rec", data_origin: "recovered" }),
    row({ event_id: "late", predicted_before_kickoff: false }),
    row({ event_id: "unpub", published: false, source: "book" }),
    row({ event_id: "void", result: "void" }),
    row({ event_id: "pend", result: "pending" }),
    row({ event_id: "e2", result: "loss" }),
    row({ event_id: "e1", source: "plenty", product_tier: "SAFE", slip_code: "P1" }), // other product → own row
  ];
  const sel = evalSelections(rows);
  assert.equal(sel.length, 3);
  assert.equal(sel.filter((r) => r.data_origin === "recovered").length, 0);
  assert.equal(sel.find((r) => r.event_id === "e1" && r.product === "sure-engine")?.slip_code, "S2");
  const legs = legLevel(sel);
  assert.equal(legs.unique_selections, 3);
  assert.equal(legs.overall.wins, 2);
  const rec = recoveredBreakdown(rows);
  assert.equal(rec.graded_rows, 1);
});

test("official slips: void legs drop out, void slips stay out of ROI (tasks 5 and 9)", () => {
  const rows = [
    row({ slip_code: "A", event_id: "a1", odds: 1.5, result: "win" }),
    row({ slip_code: "A", event_id: "a2", odds: 1.4, result: "void" }),
    row({ slip_code: "B", event_id: "b1", odds: 1.3, result: "loss" }),
    row({ slip_code: "C", event_id: "c1", odds: 1.3, result: "cancelled" }),
  ];
  const slips = buildSlips(rows);
  assert.equal(slips.find((s) => s.slip_code === "A")?.outcome, "win");
  assert.equal(slips.find((s) => s.slip_code === "A")?.payout_odds, 1.5);
  const level = officialSlipLevel(rows, null, null);
  assert.equal(level.overall.void, 1);
  assert.equal(level.overall.graded, 2);
  assert.equal(level.overall.roi_flat_stake, Math.round(((0.5 - 1) / 2) * 10_000) / 10_000);
});

test("customer slips: only server-booked sources, created before the first kickoff (task 9)", () => {
  const rows = [
    row({ source: "builder", published: false, slip_code: "U1", event_id: "x" }),
    row({ source: "sure-combine", published: false, slip_code: "U2", event_id: "y" }),
    row({ source: "edit-code", published: false, slip_code: "U3", event_id: "z" }), // user-submitted code
    row({ source: "book", published: false, slip_code: "U4", event_id: "w", created_at: "2026-10-10T16:00:00Z" }),
    row({ source: "sure", slip_code: "S9", event_id: "v" }), // official, not customer
  ];
  const level = customerSlipLevel(rows, null, null);
  assert.equal(level.overall.slips, 2);
  assert.equal(level.excluded_created_after_first_kickoff, 1);
  assert.equal(level.all_created_before_first_kickoff, false);
  assert.equal(officialSlipLevel(rows, null, null).overall.slips, 1);
});

test("model vs market scores both forecasts on the same rows, reproducibly (task 10)", () => {
  const rows: EvalRow[] = [];
  for (let i = 0; i < 60; i++) {
    rows.push(row({ event_id: `m${i}`, confidence: 0.8, devig_prob: 0.85, result: i % 7 === 0 ? "loss" : "win" }));
  }
  rows.push(row({ event_id: "nodevig", devig_prob: null }));
  const a = modelVsMarket(rows, { iterations: 200, seed: 7 });
  const b = modelVsMarket(rows, { iterations: 200, seed: 7 });
  assert.equal(a.rows_scored, 60);
  assert.equal(a.rows_missing_devig, 1);
  assert.equal(a.overall?.n, 60);
  assert.deepEqual(a.overall?.ci95, b.overall?.ci95);
  const champ = a.overall!.champion.brier;
  const market = a.overall!.devig_market.brier;
  assert.equal(a.overall!.brier_skill_vs_devig, Math.round((1 - champ / market) * 10_000) / 10_000);
  const [lo, hi] = a.overall!.ci95.brier_skill_vs_devig!;
  assert.ok(lo <= hi);
});

test("version check flags more than one Sure engine version (task 7)", () => {
  assert.equal(versionCheck([row({}), row({ event_id: "e2" })]).one_sure_engine_version, true);
  const two = versionCheck([row({}), row({ event_id: "e2", model_version: "sure-engine/2026.11" })]);
  assert.equal(two.one_sure_engine_version, false);
  assert.equal(versionCheck([row({ app_commit: null })]).rows_missing_app_commit, 1);
});

test("de-vig coverage counts rows written since capture started (task 6)", () => {
  const cov = devigCoverage([
    row({ created_at: "2026-10-01T00:00:00Z", devig_prob: null }),
    row({ created_at: "2026-10-17T10:00:00Z", devig_prob: 0.8 }),
    row({ created_at: "2026-10-17T11:00:00Z", devig_prob: 0.7 }),
  ]);
  assert.equal(cov.rows_since, 2);
  assert.equal(cov.coverage, 1);
});

test("market snapshot: proportional de-vig and overround", () => {
  const at = "2026-10-17T10:00:00Z";
  // 1X2 at 2.0 / 3.5 / 4.0
  const x = snapshotFromBook("1", { "1|": { "1": 2, "2": 3.5, "3": 4 } }, at, "fixture-feed")!;
  const sum = 1 / 2 + 1 / 3.5 + 1 / 4;
  assert.equal(x.overround, Math.round((sum - 1) * 1e6) / 1e6);
  assert.equal(x.devig_prob, Math.round((0.5 / sum) * 1e6) / 1e6);
  assert.deepEqual(Object.keys(x.market_odds.outcomes), ["1", "2", "3"]);
  // Double chance: each outcome covers two results → probabilities sum to 2
  const dc = snapshotFromBook("DC1X", { "10|": { "9": 1.2, "10": 1.3, "11": 1.9 } }, at, "event-api")!;
  const s = 1 / 1.2 + 1 / 1.3 + 1 / 1.9;
  assert.equal(dc.devig_prob, Math.round(((1 / 1.2 / s) * 2) * 1e6) / 1e6);
  assert.equal(dc.overround, Math.round((s / 2 - 1) * 1e6) / 1e6);
  // Over/Under uses the line in the specifier; an incomplete market gives nothing
  assert.ok(snapshotFromBook("O15", { "18|total=1.5": { "12": 1.3, "13": 3.4 } }, at, "fixture-feed"));
  assert.equal(snapshotFromBook("O15", { "18|total=1.5": { "12": 1.3 } }, at, "fixture-feed"), null);
  assert.equal(snapshotFromBook("O15", { "18|total=2.5": { "12": 1.9, "13": 1.9 } }, at, "fixture-feed"), null);
});

const cand = (o: Partial<LiftCandidate>): LiftCandidate => ({
  product_tier: "safe",
  sport: "football",
  league: "EPL",
  market: "1X2",
  pick_code: "1",
  event_id: "ev",
  odds: 1.3,
  kickoff: "2026-10-10T15:00:00Z",
  evaluated_at: "2026-10-10T10:00:00Z",
  day: "2026-10-10",
  status: "rejected",
  result: "win",
  ...o,
});

test("selection lift counts unique selections on both sides (task 8)", () => {
  const dup = [
    cand({ event_id: "s", status: "rejected", day: "2026-10-09", evaluated_at: "2026-10-09T10:00:00Z" }),
    cand({ event_id: "s", status: "selected" }),
  ];
  const u = uniqueCandidates(dup);
  assert.equal(u.length, 1);
  assert.equal(u[0].status, "selected");

  const rows = [
    cand({ event_id: "s", status: "selected" }),
    cand({ event_id: "s", status: "selected", day: "2026-10-10", evaluated_at: "2026-10-10T11:00:00Z" }),
    cand({ event_id: "c1" }),
    cand({ event_id: "c1", evaluated_at: "2026-10-10T11:00:00Z" }),
    cand({ event_id: "c2", result: "loss" }),
  ];
  const r = selectionLiftReport(rows, { minImplied: 0.7, impliedTolerance: 0.05, controlsPerSelected: 3, minGroupSize: 1 });
  assert.equal(r.overall_matched_within_tier.unique_selected_n, 1);
  assert.equal(r.overall_matched_within_tier.unique_control_n, 2);
  assert.equal(r.overall_matched_within_tier.rejected_n, 2);
});
