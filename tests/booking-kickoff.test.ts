import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOKING_KICKOFF_BUFFER_MS, splitBookablePicks, type AppPick } from "../src/lib/picks";

const NOW = Date.parse("2026-11-04T12:00:00Z");

function pick(kickoff: string, extra: Partial<AppPick> = {}): AppPick {
  return {
    home: "Home",
    away: "Away",
    kickoff,
    pick: "Home",
    key: "k",
    confidence: 0.8,
    odds: "1.20",
    reasons: [],
    eventId: "e1",
    pickCode: "1",
    market: "1X2",
    ...extra,
  };
}

test("a started game is left out of a customer booking", () => {
  const { open, skipped } = splitBookablePicks(
    [
      pick(new Date(NOW - 60_000).toISOString(), { home: "Late", eventId: "late" }),
      pick(new Date(NOW + 3 * 3600_000).toISOString(), { home: "Later", eventId: "later" }),
    ],
    NOW,
  );
  assert.deepEqual(open.map((p) => p.eventId), ["later"]);
  assert.deepEqual(skipped, [{ match: "Late v Away", reason: "already started" }]);
});

test("a game inside the kickoff buffer is left out", () => {
  const { open, skipped } = splitBookablePicks(
    [pick(new Date(NOW + BOOKING_KICKOFF_BUFFER_MS - 1).toISOString())],
    NOW,
  );
  assert.equal(open.length, 0);
  assert.equal(skipped[0]?.reason, "already started");
});

test("a pick with no kickoff cannot be booked", () => {
  const { open, skipped } = splitBookablePicks([pick("")], NOW);
  assert.equal(open.length, 0);
  assert.equal(skipped[0]?.reason, "no kickoff");
});
