import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeSelection } from "../src/lib/prediction-settle";

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
