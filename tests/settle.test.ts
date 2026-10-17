import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeSelection, parseEventResult, rescheduledBy, settlementScore } from "../src/lib/prediction-settle";

const ft = (home: number, away: number) => ({ home, away });

test("full-time markets grade from the final score", () => {
  assert.equal(gradeSelection("1", ft(2, 1), null).result, "win");
  assert.equal(gradeSelection("2", ft(2, 1), null).result, "loss");
  assert.equal(gradeSelection("DC1X", ft(1, 1), null).result, "win");
  assert.equal(gradeSelection("DCX2", ft(2, 0), null).result, "loss");
  assert.equal(gradeSelection("O15", ft(1, 1), null).result, "win");
  assert.equal(gradeSelection("O25", ft(1, 1), null).result, "loss");
  assert.equal(gradeSelection("BTTSY", ft(1, 0), null).result, "loss");
  assert.equal(gradeSelection("HO05", ft(1, 0), null).result, "win");
  assert.equal(gradeSelection("AO05", ft(1, 0), null).result, "loss");
  assert.equal(gradeSelection("BBH", ft(101, 99), null).result, "win");
  assert.equal(gradeSelection("TNA", ft(2, 1), null).result, "loss");
});

test("Draw No Bet ending level is void, otherwise graded", () => {
  assert.equal(gradeSelection("DNBH", ft(1, 1), null).result, "void");
  assert.equal(gradeSelection("DNBA", ft(0, 0), null).result, "void");
  assert.equal(gradeSelection("DNBH", ft(2, 1), null).result, "win");
  assert.equal(gradeSelection("DNBA", ft(2, 1), null).result, "loss");
});

test("first-half markets use the half-time score", () => {
  assert.equal(gradeSelection("1HO05", ft(2, 1), ft(0, 0)).result, "loss");
  assert.equal(gradeSelection("1HO05", ft(2, 1), ft(1, 0)).result, "win");
  assert.equal(gradeSelection("1HDC1X", ft(1, 2), ft(1, 1)).result, "win");
  assert.equal(gradeSelection("1HDCX2", ft(3, 1), ft(1, 0)).result, "loss");
});

test("first-half markets infer 0-0 at half time from a 0-0 final", () => {
  assert.equal(gradeSelection("1HO05", ft(0, 0), null).result, "loss");
  assert.equal(gradeSelection("1HDC1X", ft(0, 0), null).result, "win");
});

test("first-half markets without a half-time score stay ungraded", () => {
  const g = gradeSelection("1HO05", ft(2, 1), null);
  assert.equal(g.result, null);
  assert.match(g.note ?? "", /half-time/);
});

test("unknown market codes are never guessed", () => {
  assert.equal(gradeSelection("NOPE", ft(1, 0), null).result, null);
  assert.equal(gradeSelection(null, ft(1, 0), null).result, null);
});

// Real SportyBet payloads (trimmed) from the grading investigation.
const sport = (id: number, category = "USA", tournament = "MLB") => ({ id: `sr:sport:${id}`, category: { name: category, tournament: { name: tournament } } });

test("baseball: hand-checked MLB results grade from the inning totals", () => {
  const games: [string, string[], string, "win" | "loss"][] = [
    // Dodgers v Brewers 2-6, pick 1 (Dodgers)
    ["2:6", ["0:1", "0:0", "0:0", "0:0", "0:0", "2:0", "0:3", "0:1", "0:1"], "1", "loss"],
    // White Sox v Rockies 6-9, pick 1
    ["6:9", ["0:3", "1:0", "1:1", "0:1", "0:0", "0:0", "1:0", "0:0", "3:4"], "1", "loss"],
    // Rays v Guardians 3-7, pick 1
    ["3:7", ["2:0", "0:0", "0:0", "0:0", "0:0", "0:1", "0:1", "1:2", "0:3"], "1", "loss"],
    // Rays v Yankees 5-2, pick 2 (Yankees)
    ["5:2", ["1:0", "0:0", "0:0", "0:1", "4:0", "0:0", "0:0", "0:1", "0:0"], "2", "loss"],
    // Yankees v Rays 3-4, pick 1
    ["3:4", ["0:0", "0:0", "1:1", "1:1", "0:0", "1:2", "0:0", "0:0", "0:0"], "1", "loss"],
  ];
  for (const [setScore, gameScore, pick, expected] of games) {
    const ev = parseEventResult({ status: 4, matchStatus: "Ended", setScore, gameScore, sport: sport(3) });
    assert.equal(ev.state, "ended");
    assert.deepEqual(ev.regular, ev.ft);
    assert.equal(gradeSelection(pick, settlementScore(pick, ev), ev.ht).result, expected);
  }
});

test("baseball 1X2 settles on nine innings, not extra innings", () => {
  const ev = parseEventResult({
    status: 4,
    matchStatus: "Ended",
    setScore: "4:3",
    gameScore: ["1:0", "0:1", "0:0", "1:0", "0:1", "0:0", "1:0", "0:1", "0:0", "1:0"],
    sport: sport(3),
  });
  assert.deepEqual(ev.regular, { home: 3, away: 3 });
  assert.equal(gradeSelection("1", settlementScore("1", ev), null).result, "loss");
  assert.equal(gradeSelection("X", settlementScore("X", ev), null).result, "win");
});

test("hockey: PostMatch counts as ended; overtime is taken off the regulation score", () => {
  const ot = parseEventResult({
    status: 3,
    matchStatus: "PostMatch",
    period: "PostMatch",
    setScore: "4:3",
    playedSeconds: "62:42",
    sport: sport(4, "Sweden", "Allsvenskan"),
  });
  assert.equal(ot.state, "ended");
  assert.deepEqual(ot.regular, { home: 3, away: 3 });
  assert.equal(gradeSelection("2", settlementScore("2", ot), null).result, "loss");
  assert.equal(gradeSelection("DC1X", settlementScore("DC1X", ot), null).result, "win");

  const reg = parseEventResult({ status: 3, matchStatus: "PostMatch", setScore: "0:5", playedSeconds: "57:40", sport: sport(4) });
  assert.equal(reg.state, "ended");
  assert.deepEqual(reg.regular, { home: 0, away: 5 });
});

test("tennis: a stalled ITF feed on a decided set score is final", () => {
  const ev = parseEventResult({
    status: 3,
    matchStatus: "set 2",
    period: "Set 2",
    setScore: "0:2",
    gameScore: ["4:6", "4:6"],
    sport: sport(5, "ITF", "ITF W50 Quebec City"),
  });
  assert.equal(ev.state, "ended");
  assert.match(ev.note ?? "", /inferred/);
  assert.equal(gradeSelection("TNA", settlementScore("TNA", ev), null).result, "win");
  assert.equal(gradeSelection("TNH", settlementScore("TNH", ev), null).result, "loss");

  const live = parseEventResult({ status: 3, matchStatus: "set 3", setScore: "1:1", gameScore: ["6:4", "4:6", "2:2"], sport: sport(5, "ITF") });
  assert.equal(live.state, "live");
  const slam = parseEventResult({ status: 3, matchStatus: "set 3", setScore: "2:0", sport: sport(5, "ATP", "Wimbledon, Men Singles") });
  assert.equal(slam.state, "live");
});

test("basketball: a rescheduled match is not overdue and is void only when moved > 48h", () => {
  const logged = Date.parse("2026-10-14T17:00:00Z");
  const ev = parseEventResult({ status: 0, matchStatus: "Not start", estimateStartTime: Date.parse("2026-10-16T17:00:00Z"), sport: sport(2) });
  assert.equal(ev.state, "not_started");
  assert.equal(rescheduledBy(ev, logged), 48 * 3_600_000);
  assert.equal(rescheduledBy(ev, Date.parse("2026-10-16T17:00:00Z")), null);
});

test("winner markets use the final score including overtime", () => {
  const ev = { ft: ft(101, 99), regular: ft(95, 95) };
  assert.deepEqual(settlementScore("BBH", ev), ft(101, 99));
  assert.deepEqual(settlementScore("1", ev), ft(95, 95));
  assert.equal(gradeSelection("1", null, null).result, null);
});

test("cancelled / abandoned and football extra time", () => {
  assert.equal(parseEventResult({ status: 4, matchStatus: "Cancelled", sport: sport(1) }).state, "cancelled");
  const aet = parseEventResult({ status: 4, matchStatus: "AET", setScore: "2:1", gameScore: ["0:0", "1:1", "1:0", "0:0"], sport: sport(1) });
  assert.deepEqual(aet.regular, { home: 1, away: 1 });
  assert.deepEqual(aet.ht, { home: 0, away: 0 });
  const noPeriods = parseEventResult({ status: 4, matchStatus: "AET", setScore: "2:1", sport: sport(1) });
  assert.equal(noPeriods.regular, null);
});
