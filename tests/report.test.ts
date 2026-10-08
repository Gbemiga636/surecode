import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, oddsBand, selectionLift, wilson, type ReportRow } from "../src/lib/prediction-report";

function row(p: Partial<ReportRow>): ReportRow {
  return {
    event_id: "e",
    pick_code: "DC1X",
    source: "sure",
    product_tier: "safe",
    sport: "football",
    market: "Double Chance",
    model_version: "sure-engine/2026.10",
    slip_code: null,
    odds: 1.5,
    confidence: 0.66,
    closing_odds: null,
    result: "win",
    kickoff: "2026-10-01T15:00:00Z",
    created_at: "2026-10-01T10:00:00Z",
    settled_at: "2026-10-01T17:00:00Z",
    settle_note: null,
    slip_odds: null,
    ...p,
  };
}

test("wilson interval brackets the observed rate", () => {
  const [lo, hi] = wilson(84, 90)!;
  assert.ok(lo < 84 / 90 && hi > 84 / 90);
  assert.equal(wilson(0, 0), null);
});

test("odds bands", () => {
  assert.equal(oddsBand(1.2), "1.01-1.24");
  assert.equal(oddsBand(1.6), "1.50-1.99");
  assert.equal(oddsBand(null), "unknown");
});

test("legs and slips are scored separately", () => {
  const rows = [
    row({ slip_code: "S1", event_id: "a", result: "win", odds: 1.5 }),
    row({ slip_code: "S1", event_id: "b", result: "loss", odds: 1.4 }),
    row({ slip_code: "S2", event_id: "c", result: "win", odds: 1.2 }),
    row({ slip_code: "S2", event_id: "d", result: "void", odds: 1.3 }),
    row({ slip_code: "S3", event_id: "e", result: "pending" }),
  ];
  const r = buildReport(rows, null);
  assert.equal(r.legs.win, 2);
  assert.equal(r.legs.loss, 1);
  assert.equal(r.legs.hit_rate, Math.round((2 / 3) * 10_000) / 10_000);
  assert.equal(r.slips.total, 3);
  assert.equal(r.slips.loss, 1);
  assert.equal(r.slips.win, 1);
  assert.equal(r.slips.pending, 1);
  // S2 wins at 1.2 (void leg drops out); S1 loses 1 unit → (0.2 - 1) / 2
  assert.equal(r.slips.roi_flat_stake, -0.4);
});

test("closing-line value is measured where closing odds exist", () => {
  const r = buildReport([row({ odds: 1.6, closing_odds: 1.5 }), row({ odds: 1.4, closing_odds: 1.5 })], null);
  assert.equal(r.legs.clv?.n, 2);
  assert.equal(r.legs.clv?.beat_close_rate, 0.5);
});

test("selection lift compares like-for-like cells only", () => {
  const lift = selectionLift([
    { product_tier: "safe", market: "Double Chance", sport: "football", odds: 1.3, status: "selected", result: "win" },
    { product_tier: "safe", market: "Double Chance", sport: "football", odds: 1.3, status: "selected", result: "win" },
    { product_tier: "safe", market: "Double Chance", sport: "football", odds: 1.3, status: "rejected", result: "win" },
    { product_tier: "safe", market: "Double Chance", sport: "football", odds: 1.3, status: "rejected", result: "loss" },
    // No rejected control in this cell → excluded from lift
    { product_tier: "safe", market: "1X2", sport: "football", odds: 1.3, status: "selected", result: "loss" },
  ]);
  assert.equal(lift.by_tier[0].selection_lift, 0.5);
  assert.equal(lift.by_tier[0].matched_cells, 1);
});

test("a leg re-used in several slips counts once as a unique selection", () => {
  const rows = [
    row({ slip_code: "S1", event_id: "a", result: "win", created_at: "2026-10-01T09:00:00Z" }),
    row({ slip_code: "S2", event_id: "a", result: "win", created_at: "2026-10-01T08:00:00Z" }),
    row({ slip_code: "S3", event_id: "a", result: "win", created_at: "2026-10-01T10:00:00Z" }),
    row({ slip_code: "S3", event_id: "b", result: "loss" }),
  ];
  const r = buildReport(rows, null);
  assert.equal(r.legs.total, 4);
  assert.equal(r.legs.hit_rate, 0.75);
  assert.equal(r.unique_selections.total, 2);
  assert.equal(r.unique_selections.hit_rate, 0.5);
});

test("data quality flags predictions logged after kickoff", () => {
  const r = buildReport([row({ created_at: "2026-10-01T16:00:00Z" })], null);
  assert.equal(r.data_quality.logged_after_kickoff, 1);
});
