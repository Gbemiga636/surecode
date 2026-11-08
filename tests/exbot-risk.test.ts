import assert from "node:assert/strict";
import { test } from "node:test";
import { RISK } from "../src/lib/exbot/config";
import { RiskManager } from "../src/lib/exbot/risk";

const t0 = new Date("2026-01-05T08:00:00Z");

test("exbot sizes to 0.35% risk and caps leverage", () => {
  const rm = new RiskManager(RISK, 10_000);
  assert.ok(Math.abs(rm.size(10_000, 100, 96) - 8.75) < 1e-9); // 35 USDT / 4 per unit
  assert.equal(rm.size(10_000, 100, 99.99), 300); // 3x cap: 30,000 notional / 100
  assert.equal(rm.size(10_000, 100, 100), 0);
});

test("exbot daily loss limit, kill switch and position cap", () => {
  const rm = new RiskManager(RISK, 10_000);
  rm.update(t0, 10_000);
  assert.deepEqual(rm.canOpen(t0, "BTC", 0), [true, ""]);
  assert.equal(rm.canOpen(t0, "BTC", 8)[0], false);
  rm.update(t0, 9_690);
  assert.match(rm.canOpen(t0, "BTC", 0)[1], /daily loss/);
  const tomorrow = new Date(t0.getTime() + 86_400_000);
  rm.update(tomorrow, 9_690);
  assert.equal(rm.canOpen(tomorrow, "BTC", 0)[0], true);
  rm.update(tomorrow, 7_990);
  assert.match(rm.canOpen(tomorrow, "BTC", 0)[1], /kill switch/);
  rm.resetKillSwitch(7_990);
  const next = new Date(tomorrow.getTime() + 86_400_000);
  rm.update(next, 7_990);
  assert.equal(rm.canOpen(next, "BTC", 0)[0], true);
});

test("exbot streak rules stay off; a coin with a poor run is paused", () => {
  const rm = new RiskManager(RISK, 10_000);
  for (let i = 0; i < 12; i++) rm.onClose(t0, "ETH", -35, -1);
  assert.equal(rm.riskFraction(), RISK.riskPerTrade);
  assert.equal(rm.canOpen(t0, "ETH", 0)[0], true);
  for (let i = 0; i < 8; i++) rm.onClose(t0, "ETH", -35, -1);
  assert.match(rm.canOpen(t0, "ETH", 0)[1], /paused/);
  assert.equal(rm.canOpen(t0, "BTC", 0)[0], true);
  assert.equal(rm.canOpen(new Date(t0.getTime() + 4 * 86_400_000), "ETH", 0)[0], true);
});

test("exbot risk state survives a JSON round trip", () => {
  const rm = new RiskManager(RISK, 10_000);
  rm.update(t0, 10_000);
  rm.onClose(t0, "SOL", 50, 1.4);
  const back = new RiskManager(RISK, 1, JSON.parse(JSON.stringify(rm.s)));
  assert.deepEqual(back.s, rm.s);
});
