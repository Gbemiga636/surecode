import assert from "node:assert/strict";
import { test } from "node:test";
import { isGeoBlocked, isRateLimited, visionSymbol } from "../src/lib/exbot/exchange";

test("exbot visionSymbol maps swap symbols to Vision pairs", () => {
  assert.equal(visionSymbol("BTC/USDT:USDT"), "BTCUSDT");
  assert.equal(visionSymbol("XRP/USDT:USDT"), "XRPUSDT");
});

test("exbot treats CloudFront/451 as geo, not rate limit", () => {
  const geo = new Error(
    "bybit GET ... 403 Forbidden { error:The Amazon CloudFront distribution is configured to block access from your country }",
  );
  const ban = new Error("binance GET ... 451 Unavailable For Legal Reasons restricted location");
  assert.equal(isGeoBlocked(geo), true);
  assert.equal(isGeoBlocked(ban), true);
  assert.equal(isRateLimited(geo), false);
  assert.equal(isRateLimited(ban), false);
  assert.equal(isRateLimited(new Error("10006 Too many visits")), true);
});
