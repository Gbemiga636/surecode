import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOcc, type OptionSnap } from "../src/lib/exbot/alpaca";
import { condorValueAtExpiry, nyParts, pickCondor, sizeCondor, sma } from "../src/lib/exbot/options-engine";

test("exbot options: New York clock across daylight saving", () => {
  assert.deepEqual(nyParts(new Date("2026-07-15T19:40:00Z")), { day: "2026-07-15", minutes: 15 * 60 + 40 });
  assert.deepEqual(nyParts(new Date("2026-01-15T20:40:00Z")), { day: "2026-01-15", minutes: 15 * 60 + 40 });
  assert.deepEqual(nyParts(new Date("2026-01-16T03:00:00Z")), { day: "2026-01-15", minutes: 22 * 60 });
});

test("exbot options: condor size follows the balance", () => {
  // SPY 750: 2% wing = $15 ($1,500 max loss per contract), 1% fallback = $8
  assert.deepEqual(sizeCondor(100_000, 750, 0), { width: 15, qty: 1 });
  assert.deepEqual(sizeCondor(1_000_000, 750, 0), { width: 15, qty: 10 });
  assert.deepEqual(sizeCondor(60_000, 750, 0), { width: 8, qty: 1 });
  assert.deepEqual(sizeCondor(25_000, 750, 0), { width: 15, qty: 1 }); // whole 8% budget for one condor
  assert.deepEqual(sizeCondor(10_000, 750, 0), { width: 8, qty: 1 });
  const small = sizeCondor(5_000, 750, 0);
  assert.ok("skip" in small && /balance too small/.test(small.skip));
  const full = sizeCondor(25_000, 750, 1_500);
  assert.ok("skip" in full && /budget/.test(full.skip));
});

const snap = (type: "put" | "call", strike: number, delta: number, bid: number, ask: number): OptionSnap => ({
  symbol: `SPY261120${type === "put" ? "P" : "C"}${String(strike * 1000).padStart(8, "0")}`, type, strike, expiry: "2026-11-20", bid, ask, delta, iv: 0.15,
});

test("exbot options: picks ~20-delta shorts and wings one width out", () => {
  const chain: OptionSnap[] = [];
  for (let k = 80; k < 100; k++) chain.push(snap("put", k, -Math.max(0.01, (k - 80) * 0.025), Math.max(0.01, (k - 80) * 0.1), Math.max(0.02, (k - 80) * 0.1 + 0.02)));
  for (let k = 101; k <= 120; k++) chain.push(snap("call", k, Math.max(0.01, (120 - k) * 0.025), Math.max(0.01, (120 - k) * 0.1), Math.max(0.02, (120 - k) * 0.1 + 0.02)));
  const p = pickCondor(chain, 100, 5, 0.2);
  assert.ok(typeof p !== "string");
  const s = (t: string, side: string) => p.legs.find((l) => l.type === t && l.side === side)!.strike;
  assert.equal(s("put", "sell"), 88);  // delta -0.20
  assert.equal(s("put", "buy"), 83);
  assert.equal(s("call", "sell"), 112); // delta 0.20
  assert.equal(s("call", "buy"), 117);
  assert.equal(p.width, 5);
  assert.ok(p.credit > 0 && p.natural <= p.credit);
});

test("exbot options: expiry value and helpers", () => {
  const legs = [
    { symbol: "a", type: "put" as const, strike: 88, side: "sell" as const },
    { symbol: "b", type: "put" as const, strike: 83, side: "buy" as const },
    { symbol: "c", type: "call" as const, strike: 112, side: "sell" as const },
    { symbol: "d", type: "call" as const, strike: 117, side: "buy" as const },
  ];
  assert.equal(condorValueAtExpiry(legs, 100), 0);
  assert.equal(condorValueAtExpiry(legs, 86), 2);
  assert.equal(condorValueAtExpiry(legs, 70), 5);
  assert.equal(condorValueAtExpiry(legs, 130), 5);
  assert.deepEqual(parseOcc("SPY261120P00740000"), { root: "SPY", expiry: "2026-11-20", type: "put", strike: 740 });
  assert.equal(parseOcc("BTC/USDT"), null);
  assert.equal(sma([1, 2, 3, 4], 2), 3.5);
  assert.ok(Number.isNaN(sma([1], 2)));
});
