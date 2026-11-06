import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SAFE_COMBO,
  bestPerEvent,
  boardWindow,
  chooseCombo,
  chooseSafeCombo,
  chooseSinglePicks,
  comboChance,
  safeComboSignature,
  safeLegProblem,
  surest,
  type SafeLeg,
} from "../src/lib/safe-combo";

const NOW = Date.parse("2026-10-30T10:00:00Z");
const H = 3600_000;

function leg(id: string, odds: number, over = 0.06, extra: Partial<SafeLeg> = {}): SafeLeg {
  return {
    eventId: id,
    marketId: "18",
    specifier: "total=1.5",
    outcomeId: "12",
    home: `H${id}`,
    away: `A${id}`,
    league: `L${id}`,
    kickoff: NOW + 4 * H,
    pickCode: "O15",
    pickLabel: "Over 1.5 Goals",
    odds,
    implied: 1 / odds,
    sport: "football",
    pFair: 1 / odds / (1 + over),
    overround: over,
    ...extra,
  };
}

test("safeLegProblem applies the data-backed exclusions", () => {
  assert.equal(safeLegProblem(leg("a", 1.2), NOW), null);
  assert.equal(safeLegProblem(leg("a", 1.2, 0.1), NOW), "bookmaker margin too high");
  assert.equal(safeLegProblem(leg("a", 1.6), NOW), "price outside Safe range");
  assert.equal(safeLegProblem(leg("a", 1.2, 0.06, { sport: "hockey" }), NOW), "sport excluded");
  assert.equal(safeLegProblem(leg("a", 1.2, 0.06, { pickCode: "DNBH" }), NOW), "market excluded");
  assert.equal(safeLegProblem(leg("a", 1.2, 0.06, { kickoff: NOW + 20 * 60_000 }), NOW), "starts too soon");
});

test("bestPerEvent keeps the lowest-margin pick for each match", () => {
  const out = bestPerEvent([leg("a", 1.2, 0.08), leg("a", 1.25, 0.03, { pickCode: "HO05" }), leg("b", 1.3)]);
  assert.equal(out.length, 2);
  assert.equal(out.find((l) => l.eventId === "a")?.pickCode, "HO05");
});

test("chooseCombo picks the highest-chance combination inside the band", () => {
  // Same total odds band: the low-margin legs must win.
  const legs = [leg("a", 1.3, 0.02), leg("b", 1.3, 0.02), leg("c", 1.3, 0.02), leg("d", 1.3, 0.09), leg("e", 1.3, 0.09)];
  const c = chooseCombo(legs, { minOdds: 2.0, maxOdds: 2.6, sizes: [3] });
  assert.ok(c);
  assert.deepEqual(c!.legs.map((l) => l.eventId).sort(), ["a", "b", "c"]);
  assert.ok(Math.abs(c!.chance - comboChance(c!.legs)) < 1e-12);
  assert.ok(c!.totalOdds >= 2.0 && c!.totalOdds <= 2.6);
});

test("chooseCombo never repeats a match or a league", () => {
  const legs = [leg("a", 1.3), leg("b", 1.3, 0.06, { league: "Same" }), leg("c", 1.3, 0.06, { league: "Same" }), leg("d", 1.3)];
  const c = chooseCombo(legs, { minOdds: 2.0, maxOdds: 2.6, sizes: [3] });
  assert.ok(c);
  assert.equal(new Set(c!.legs.map((l) => l.league)).size, 3);
});

test("chooseSafeCombo prefers 3 strong legs over 4 weaker ones at similar odds", () => {
  const strong = [leg("a", 1.27, 0.03), leg("b", 1.27, 0.03), leg("c", 1.27, 0.03)];
  const short = [leg("d", 1.19, 0.07), leg("e", 1.19, 0.07), leg("f", 1.19, 0.07), leg("g", 1.19, 0.07)];
  const c = chooseSafeCombo([...strong, ...short]);
  assert.ok(c);
  assert.equal(c!.legs.length, 3);
  assert.ok(c!.legs.every((l) => ["a", "b", "c"].includes(l.eventId)));
});

test("chooseSafeCombo falls back to a wider band, then gives up", () => {
  const legs = [leg("a", 1.45), leg("b", 1.45), leg("c", 1.42)];
  const c = chooseSafeCombo(legs);
  assert.ok(c && c.totalOdds <= SAFE_COMBO.comboFallbackMaxOdds && c.totalOdds >= SAFE_COMBO.comboMinOdds);
  assert.equal(chooseSafeCombo([leg("a", 1.08), leg("b", 1.08)]), null);
});

test("chooseSinglePicks returns up to 8, surest first, always including the combo legs", () => {
  const legs = Array.from({ length: 12 }, (_, i) => leg(String(i), 1.08 + i * 0.03));
  const combo = [legs[10], legs[11]];
  const picks = chooseSinglePicks(legs, combo);
  assert.equal(picks.length, SAFE_COMBO.picksMax);
  assert.ok(picks.some((p) => p.eventId === "10") && picks.some((p) => p.eventId === "11"));
  for (let i = 1; i < picks.length; i++) assert.ok(picks[i - 1].pFair >= picks[i].pFair);
});

test("boardWindow is 13:00 Lagos on the day to 06:00 Lagos the next morning", () => {
  const w = boardWindow("2026-11-06");
  assert.equal(new Date(w.from).toISOString(), "2026-11-06T12:00:00.000Z");
  assert.equal(new Date(w.to).toISOString(), "2026-11-07T05:00:00.000Z");
});

test("safeLegProblem keeps the frozen board to games inside the day window", () => {
  const day = "2026-10-30"; // NOW is 11:00 Lagos that day
  assert.equal(safeLegProblem(leg("a", 1.2, 0.06, { kickoff: Date.parse("2026-10-30T11:30:00Z") }), NOW, day), "starts before 13:00");
  assert.equal(safeLegProblem(leg("a", 1.2, 0.06, { kickoff: Date.parse("2026-10-30T12:00:00Z") }), NOW, day), null);
  assert.equal(safeLegProblem(leg("a", 1.2, 0.06, { kickoff: Date.parse("2026-10-31T04:59:00Z") }), NOW, day), null);
  assert.equal(safeLegProblem(leg("a", 1.2, 0.06, { kickoff: Date.parse("2026-10-31T05:00:00Z") }), NOW, day), "not today");
});

test("a sharp price well below SportyBet's fair chance drops the leg; a close one is used cautiously", () => {
  const base = leg("a", 1.2);
  assert.equal(safeLegProblem({ ...base, pSharp: base.pFair - 0.05 }, NOW), "sharp market disagrees");
  const close = { ...base, pSharp: base.pFair - 0.02 };
  assert.equal(safeLegProblem(close, NOW), null);
  assert.equal(surest(close), close.pSharp);
  assert.equal(surest({ ...base, pSharp: base.pFair + 0.05 }), base.pFair);
  assert.equal(surest(base), base.pFair);
});

test("chooseSafeCombo can use two strong legs when they beat three at the same odds", () => {
  const two = [leg("a", 1.42, 0.01), leg("b", 1.42, 0.01)];
  const three = [leg("c", 1.27, 0.07), leg("d", 1.27, 0.07), leg("e", 1.27, 0.07)];
  const c = chooseSafeCombo([...two, ...three]);
  assert.ok(c);
  assert.deepEqual(c!.legs.map((l) => l.eventId).sort(), ["a", "b"]);
});

test("safeComboSignature ignores order and blanks", () => {
  assert.equal(safeComboSignature(["B2", null, "A1"]), safeComboSignature(["A1", "B2"]));
});
