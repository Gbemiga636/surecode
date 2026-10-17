import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAMPION_FINGERPRINT, ENGINE_VERSION } from "../src/lib/prediction-log";
import { PICKS, SPORTY_SPORTS } from "../src/lib/sporty";

const src = (file: string) => readFileSync(join(__dirname, "..", "src", "lib", file), "utf8").replace(/\r\n/g, "\n");

/** Everything that decides which Sure picks are produced (docs/CHAMPION_SNAPSHOT.md). */
export function championFingerprint(): string {
  const sporty = src("sporty.ts");
  const settle = sporty.slice(sporty.indexOf("export function settlePick"));
  const parts = [
    src("sure-engine.ts"),
    src("learning.ts"),
    src("crawl.ts"),
    JSON.stringify(PICKS),
    JSON.stringify(SPORTY_SPORTS),
    settle,
  ];
  return createHash("sha256").update(parts.join("\n--\n"), "utf8").digest("hex");
}

test("the Champion is frozen: engine code changes need a new ENGINE_VERSION", () => {
  const actual = championFingerprint();
  assert.equal(
    actual,
    CHAMPION_FINGERPRINT.sha256,
    `Sure engine code changed (fingerprint ${actual}). Bump ENGINE_VERSION, append the old one to SURE_ENGINE_ERAS, then update CHAMPION_FINGERPRINT.`,
  );
  assert.equal(CHAMPION_FINGERPRINT.version, ENGINE_VERSION);
});
