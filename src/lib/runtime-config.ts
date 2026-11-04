/**
 * Settings kept in the database instead of Vercel env (sql/schema-eval-v3.sql,
 * table sc_runtime_config, service role only): the token pg_cron sends to the
 * v3 cron routes, and an optional sharp-odds API key. Fail-safe: returns null.
 */
import { auditDb, auditWarn, withTimeout } from "./audit-db";

export type RuntimeConfig = { cron_token: string | null; sharp_odds_api_key: string | null };

let cache: { at: number; value: RuntimeConfig | null } | null = null;

export async function runtimeConfig(): Promise<RuntimeConfig | null> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.value;
  try {
    const sb = auditDb();
    if (!sb) return null;
    const res = await withTimeout(sb.from("sc_runtime_config").select("cron_token, sharp_odds_api_key").eq("id", 1).maybeSingle(), 5_000);
    if (!res || res.error) return null;
    const row = res.data as RuntimeConfig | null;
    const value = row ? { cron_token: row.cron_token || null, sharp_odds_api_key: (row.sharp_odds_api_key || "").trim() || null } : null;
    cache = { at: Date.now(), value };
    return value;
  } catch (e) {
    auditWarn("runtime config", e);
    return null;
  }
}
