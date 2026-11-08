import assert from "node:assert/strict";
import { test } from "node:test";
import { decrypt, encrypt, hint } from "../src/lib/exbot/crypto";

const SECRET = "test-secret-at-least-16-chars";

test("exbot key encryption: round trip, random IV, tamper and wrong-secret detection", () => {
  const a = encrypt("my-api-secret", SECRET);
  assert.notEqual(a, encrypt("my-api-secret", SECRET));
  assert.ok(!a.includes("my-api-secret"));
  assert.equal(decrypt(a, SECRET), "my-api-secret");
  const parts = a.split(":");
  const ct = Buffer.from(parts[3], "base64");
  ct[0] ^= 1;
  parts[3] = ct.toString("base64");
  assert.throws(() => decrypt(parts.join(":"), SECRET));
  assert.throws(() => decrypt(a, "another-secret-of-16+chars"));
  assert.throws(() => encrypt("x", "short"));
  assert.equal(hint("ABCDEFGH1234"), "…1234");
});
