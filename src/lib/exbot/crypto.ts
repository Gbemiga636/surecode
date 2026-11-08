/**
 * AES-256-GCM for exchange keys at rest. The key is derived from
 * EXBOT_KEY_SECRET, or from the service-role key when that is not set, and
 * never leaves the server. Changing either one makes stored keys unreadable
 * (members reconnect).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(secret = process.env.EXBOT_KEY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY): Buffer {
  if (!secret || secret.length < 16) throw new Error("EXBOT_KEY_SECRET (or SUPABASE_SERVICE_ROLE_KEY) is missing");
  return createHash("sha256").update(`exbot-keys:${secret}`).digest();
}

export function encrypt(plain: string, secret?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(secret), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decrypt(blob: string, secret?: string): string {
  const [v, iv, tag, ct] = blob.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("unrecognised key format");
  const d = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

export const hint = (apiKey: string) => (apiKey.length > 4 ? `…${apiKey.slice(-4)}` : "…");
