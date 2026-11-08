import assert from "node:assert/strict";
import { test } from "node:test";
import { COSTS } from "../src/lib/exbot/config";
import { fill, isClosed, rMultiple, simulateStop, type Position } from "../src/lib/exbot/position";

const pos = (side: 1 | -1, entry: number, stop: number, qty = 10): Position => ({
  symbol: "BTC/USDT:USDT", side, entry, stop, stop0: stop, qty, qtyOpen: qty, entryTime: "2026-01-01T00:00:00Z",
  barsHeld: 0, realized: 0, fees: 0, exits: [], orderIds: {},
});

test("exbot stop fills at the stop, or at the open on a gap", () => {
  const a = pos(1, 100, 95);
  assert.equal(simulateStop(a, 99, 101, 96, "t"), false);
  assert.equal(simulateStop(a, 98, 99, 94, "t"), true);
  assert.ok(isClosed(a));
  assert.ok(Math.abs(a.exits[0][1] - 95 * (1 - COSTS.slippage)) < 1e-12);

  const b = pos(1, 100, 95);
  simulateStop(b, 90, 92, 88, "t");
  assert.ok(Math.abs(b.exits[0][1] - 90 * (1 - COSTS.slippage)) < 1e-12);

  const c = pos(-1, 100, 105);
  assert.equal(simulateStop(c, 101, 106, 100, "t"), true);
  assert.ok(Math.abs(c.exits[0][1] - 105 * (1 + COSTS.slippage)) < 1e-12);
});

test("exbot P&L and R include fees", () => {
  const p = pos(1, 100, 95);
  fill(p, 110, 10, COSTS.takerFee, "t", "strategy exit");
  const fee = 110 * 10 * COSTS.takerFee;
  assert.ok(Math.abs(p.realized - (100 - fee)) < 1e-9);
  assert.ok(Math.abs(rMultiple(p) - (100 - fee) / 50) < 1e-9);
});
