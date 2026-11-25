import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { breakout55, emaTrend, type Bar } from "../src/lib/exbot/strategy";

type Case = { params: { fast: number; slow: number; k_atr: number }; side: number[]; stop: (number | null)[]; exit_long: boolean[]; exit_short: boolean[] };
const golden = JSON.parse(readFileSync(path.join(process.cwd(), "tests", "exbot-golden.json"), "utf8")) as { bars: Bar[]; cases: Case[] };

test("exbot emaTrend matches the Python ema_trend bar for bar", () => {
  for (const k of golden.cases) {
    const s = emaTrend(golden.bars, k.params.fast, k.params.slow, k.params.k_atr);
    assert.ok(k.side.filter((x) => x !== 0).length >= 4, "fixture should contain signals");
    assert.deepEqual(Array.from(s.side), k.side);
    assert.deepEqual(s.exitLong, k.exit_long);
    assert.deepEqual(s.exitShort, k.exit_short);
    k.stop.forEach((v, i) => {
      if (v === null) assert.ok(Number.isNaN(s.stop[i]), `stop ${i} should be empty`);
      else assert.ok(Math.abs(s.stop[i] - v) <= 1e-9 * Math.abs(v), `stop ${i}: ${s.stop[i]} vs ${v}`);
    });
  }
});

test("exbot emaTrend uses no future bars", () => {
  const full = emaTrend(golden.bars, 50, 200, 2.5);
  const part = emaTrend(golden.bars.slice(0, 700), 50, 200, 2.5);
  assert.deepEqual(Array.from(part.side), Array.from(full.side.slice(0, 700)));
  assert.deepEqual(part.exitLong, full.exitLong.slice(0, 700));
});

test("exbot breakout55 fires above prior high and trend EMA", () => {
  const bars: Bar[] = [];
  let px = 100;
  for (let i = 0; i < 260; i++) {
    px += i < 200 ? 0.05 : 0.2;
    bars.push({ t: i * 14_400_000, o: px, h: px + 0.5, l: px - 0.5, c: px });
  }
  const hi = Math.max(...bars.slice(-56, -1).map((b) => b.h));
  bars[bars.length - 1] = { ...bars[bars.length - 1], c: hi + 1, h: hi + 1.2 };
  const s = breakout55(bars, 55, 200, 2);
  const last = bars.length - 1;
  assert.equal(s.side[last], 1);
  assert.ok(Number.isFinite(s.stop[last]));
});
