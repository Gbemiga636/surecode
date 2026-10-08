import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSureSlipsOfDay } from "../src/lib/sure-engine";
import { newCandidateStore, readCandidates, withCandidateTrace } from "../src/lib/candidate-trace";

delete process.env.OPENAI_API_KEY;

/** Deterministic pseudo-random so every run sees the same synthetic market. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

const KICKOFF = Date.now() + 4 * 3_600_000;
const o = (id: string, odds: number) => ({ id, odds: odds.toFixed(2) });

function footballEvent(i: number, r: () => number) {
  const home = 1.25 + r() * 2.4;
  const away = 1.6 + r() * 4;
  const draw = 3 + r() * 1.5;
  return {
    eventId: `sr:match:${1000 + i}`,
    homeTeamName: `Home ${i}`,
    awayTeamName: `Away ${i}`,
    estimateStartTime: KICKOFF + i * 600_000,
    markets: [
      { id: "1", outcomes: [o("1", home), o("2", draw), o("3", away)] },
      { id: "10", outcomes: [o("9", 1.05 + r() * 0.4), o("10", 1.2 + r() * 0.2), o("11", 1.3 + r() * 0.9)] },
      { id: "11", outcomes: [o("4", 1.1 + r() * 0.8), o("5", 1.5 + r() * 2)] },
      { id: "18", specifier: "total=0.5", outcomes: [o("12", 1.05 + r() * 0.15), o("13", 6 + r() * 4)] },
      { id: "18", specifier: "total=1.5", outcomes: [o("12", 1.2 + r() * 0.4), o("13", 2.5 + r())] },
      { id: "18", specifier: "total=2.5", outcomes: [o("12", 1.6 + r() * 0.8), o("13", 1.6 + r() * 0.8)] },
      { id: "29", outcomes: [o("74", 1.6 + r() * 0.6), o("76", 1.7 + r() * 0.6)] },
      { id: "19", specifier: "total=0.5", outcomes: [o("12", 1.1 + r() * 0.3)] },
      { id: "20", specifier: "total=0.5", outcomes: [o("12", 1.2 + r() * 0.5)] },
      { id: "68", specifier: "total=0.5", outcomes: [o("12", 1.25 + r() * 0.25)] },
      { id: "63", outcomes: [o("9", 1.15 + r() * 0.3), o("11", 1.4 + r() * 0.8)] },
    ],
  };
}

function twoWayEvent(i: number, r: () => number, marketId: string, prefix: string) {
  const fav = 1.12 + r() * 0.9;
  return {
    eventId: `sr:match:${prefix}${i}`,
    homeTeamName: `${prefix} Home ${i}`,
    awayTeamName: `${prefix} Away ${i}`,
    estimateStartTime: KICKOFF + i * 900_000,
    markets: [{ id: marketId, outcomes: [o("4", fav), o("5", 1.4 + r() * 3)] }],
  };
}

function installFetchStub() {
  const r = rng(42);
  const football = Array.from({ length: 30 }, (_, i) => footballEvent(i, r));
  const basketball = Array.from({ length: 6 }, (_, i) => twoWayEvent(i, r, "219", "bb"));
  const tennis = Array.from({ length: 6 }, (_, i) => twoWayEvent(i, r, "186", "tn"));
  let booking = 0;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.includes("pcUpcomingEvents")) {
      if (!url.includes("pageNum=1")) return json({ data: { tournaments: [] } });
      const events = url.includes("sr%3Asport%3A1")
        ? football
        : url.includes("sr%3Asport%3A2")
          ? basketball
          : url.includes("sr%3Asport%3A5")
            ? tennis
            : [];
      return json({ data: { tournaments: [{ name: "Test League", events }] } });
    }
    if (url.includes("/orders/share")) {
      booking++;
      return json({ bizCode: 10000, data: { shareCode: `T${booking}`, outcomes: [] } });
    }
    return json({});
  }) as typeof fetch;
}

const shape = (slips: Awaited<ReturnType<typeof buildSureSlipsOfDay>>) =>
  slips.map((s) => ({
    slot: s.slot,
    mode: s.mode,
    totalOdds: s.totalOdds,
    confidence: s.confidence,
    legs: s.legs.map((l) => `${l.eventId}|${l.pickCode}|${l.odds}`),
  }));

test("candidate tracing does not change a single engine decision", async () => {
  installFetchStub();
  const plain = await buildSureSlipsOfDay(3, [], { modes: ["safe", "boost", "longshot"] });

  installFetchStub();
  const store = newCandidateStore();
  const traced = await withCandidateTrace(store, () =>
    buildSureSlipsOfDay(3, [], { modes: ["safe", "boost", "longshot"] }),
  );

  assert.ok(plain.length > 0, "synthetic market should produce at least one slip");
  assert.deepEqual(shape(traced), shape(plain));

  const candidates = readCandidates(store);
  const selected = candidates.filter((c) => c.status === "selected");
  const booked = traced.flatMap((s) => s.legs.map((l) => `${s.mode}|${l.eventId}|${l.pickCode}`));
  assert.deepEqual(
    selected.map((c) => `${c.mode}|${c.eventId}|${c.pickCode}`).sort(),
    [...new Set(booked)].sort(),
    "every booked leg, and only booked legs, is marked selected",
  );
  assert.ok(candidates.length > selected.length, "rejected candidates are recorded too");
  for (const c of candidates.filter((x) => x.status === "rejected")) {
    assert.ok(c.reason && c.reason.length > 3, `rejected candidate has a reason (${c.pickCode})`);
  }
});

test("without an active trace nothing is recorded", async () => {
  installFetchStub();
  const store = newCandidateStore();
  await buildSureSlipsOfDay(3, [], { modes: ["safe"] });
  assert.equal(readCandidates(store).length, 0);
});
