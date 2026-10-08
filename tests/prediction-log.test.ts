import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  ENGINE_VERSION,
  crawlLogSlips,
  modelVersion,
  predictionId,
  slipToLog,
  sureEngineVersionAt,
} from "../src/lib/prediction-log";
import { storedCodeToLog } from "../src/lib/prediction-recover";
import { auditBudgetAfterCrawl } from "../src/lib/audit-crawl";

test("prediction ids are stable and match the SQL backfill formula", () => {
  const key = "sure|ABC123|sr:match:1|DC1X";
  const sqlEquivalent = `pl_${createHash("sha256").update(Buffer.from(key, "utf8")).digest("hex").slice(0, 24)}`;
  assert.equal(predictionId(key), sqlEquivalent);
  assert.equal(predictionId(key), predictionId(key));
  assert.notEqual(predictionId(key), predictionId(`${key}x`));
  assert.match(predictionId(key), /^pl_[0-9a-f]{24}$/);
});

const leg = (eventId: string, pickCode: string, odds: number) => ({
  eventId,
  marketId: "10",
  specifier: "",
  outcomeId: "9",
  home: "Home FC",
  away: "Away FC",
  kickoff: Date.UTC(2026, 9, 10, 15),
  pickCode,
  pickLabel: "Home or Draw (1X)",
  odds,
  implied: 1 / odds,
});

test("Sure slips carry tier and slot; tips get a day scope", () => {
  const slips = crawlLogSlips({
    day: "2026-10-10",
    sure: [{ slot: 4, mode: "boost", code: "AAA111", legs: [leg("e1", "DC1X", 1.6)], totalOdds: 1.6, confidence: 0.62 }],
    plenty: [],
    predictions: [
      {
        eventId: "e2",
        home: "A",
        away: "B",
        kickoff: "2026-10-10T18:00:00Z",
        pickCode: "O15",
        odds: "1.3",
        confidence: 0.74,
      },
    ],
  });
  assert.equal(slips.length, 2);
  assert.equal(slips[0].tier, "boost");
  assert.equal(slips[0].slot, 4);
  assert.equal(slips[0].slipCode, "AAA111");
  assert.equal(slips[1].source, "predictions");
  assert.equal(slips[1].dedupeScope, "2026-10-10");
});

test("slipToLog defaults slip confidence to the product of leg probabilities", () => {
  const entry = slipToLog("sure-combine", { code: "C1", legs: [leg("e1", "DC1X", 2), leg("e2", "DC1X", 4)], totalOdds: 8 }, "x");
  assert.ok(entry);
  assert.equal(entry!.slipConfidence, 0.125);
  assert.equal(entry!.legs[0].confidence, 0.5);
});

test("slips without a booking code are not logged", () => {
  assert.equal(slipToLog("builder", { code: undefined, legs: [], totalOdds: 1 }, "x"), null);
});

test("model_version is the logic version, not the deployed commit", () => {
  const before = process.env.VERCEL_GIT_COMMIT_SHA;
  process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567";
  try {
    assert.equal(modelVersion("sure"), `sure-engine/${ENGINE_VERSION}`);
  } finally {
    if (before == null) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = before;
  }
});

test("recovered predictions are stamped with the engine that was live then", () => {
  assert.equal(sureEngineVersionAt("2026-09-12T00:00:00Z"), null);
  assert.equal(sureEngineVersionAt("2026-09-20T12:00:00Z"), "sure-engine/2026.09-ea01821");
  assert.equal(sureEngineVersionAt("2026-09-26T03:00:00Z"), "sure-engine/2026.09-3fadd51");
  assert.equal(sureEngineVersionAt("2026-10-08T12:00:00Z"), `sure-engine/${ENGINE_VERSION}`);
  assert.equal(sureEngineVersionAt("not a date"), null);
});

test("stored Sure codes map to recovered log entries with their original time", () => {
  const entry = storedCodeToLog(
    {
      day: "2026-09-27",
      code: "BBB222",
      total_odds: "1.92",
      confidence: "0.61",
      legs: [leg("e1", "DC1X", 1.6), leg("e2", "O15", 1.2)],
      created_at: "2026-09-27T08:20:41Z",
    },
    3,
  );
  assert.ok(entry);
  assert.equal(entry!.source, "sure");
  assert.equal(entry!.dataOrigin, "recovered");
  assert.equal(entry!.createdAt, "2026-09-27T08:20:41Z");
  assert.equal(entry!.modelVersion, "sure-engine/2026.09-9f9f21c");
  assert.equal(entry!.slot, 3);
  assert.equal(entry!.origin, "slot-3:recovered");
  assert.equal(entry!.slipOdds, 1.92);
  assert.equal(entry!.legs[1].confidence, 1 / 1.2);
  assert.equal(
    storedCodeToLog({ day: "d", code: "X", total_odds: null, confidence: null, legs: [], created_at: "" }, null),
    null,
  );
});

test("crawl audit time comes from the function's headroom, not the spent crawl budget", () => {
  const before = { vercel: process.env.VERCEL, budget: process.env.CRAWL_BUDGET_MS };
  process.env.VERCEL = "1";
  delete process.env.CRAWL_BUDGET_MS;
  try {
    const spent = { end: Date.now(), left: () => 0, ok: () => false };
    const budget = auditBudgetAfterCrawl(spent);
    assert.ok(budget >= 13_000 && budget <= 14_000, `budget ${budget}`);
    const lateEnd = { end: Date.now() - 10_000, left: () => 0, ok: () => false };
    assert.ok(auditBudgetAfterCrawl(lateEnd) <= 4_000);
    const veryLate = { end: Date.now() - 30_000, left: () => 0, ok: () => false };
    assert.equal(auditBudgetAfterCrawl(veryLate), 0);
  } finally {
    if (before.vercel == null) delete process.env.VERCEL;
    else process.env.VERCEL = before.vercel;
    if (before.budget != null) process.env.CRAWL_BUDGET_MS = before.budget;
  }
});
