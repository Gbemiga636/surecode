/**
 * Shared plumbing for the prediction audit (logging, candidates, settlement).
 *
 * Everything here is fail-safe: no function throws, every database call is
 * bounded by a timeout, and a missing table or column degrades to "not
 * recorded" rather than an error that could reach the prediction engine.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const PREDICTION_LOG_TABLE = "prediction_log";
export const CANDIDATES_TABLE = "prediction_candidates";

export const auditDisabled = () => process.env.PREDICTION_LOG_DISABLED === "1";

let cached: SupabaseClient | null | undefined;
export function auditDb(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached =
    url && key
      ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;
  return cached;
}

export function auditWarn(where: string, e: unknown) {
  let msg: string;
  if (e instanceof Error) msg = e.message;
  else if (typeof e === "string") msg = e;
  else {
    try {
      msg = JSON.stringify(e);
    } catch {
      msg = String(e);
    }
  }
  console.warn(`[prediction-audit] ${where}: ${msg}`);
}

/** Resolves to undefined when `ms` elapses first. Never rejects on timeout. */
export async function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), Math.max(250, ms));
  });
  try {
    return await Promise.race([Promise.resolve(work), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** `appCommit`: the column added in a later revision of the v2 migration. */
export type AuditSchema = { v2: boolean; candidates: boolean; appCommit: boolean };

let schemaCache: { at: number; value: AuditSchema } | null = null;

/**
 * Which parts of the audit schema exist. Lets the app run before the v2
 * migration has been applied (it then writes the v1 columns only).
 */
export async function auditSchema(): Promise<AuditSchema> {
  if (schemaCache && Date.now() - schemaCache.at < 10 * 60_000) return schemaCache.value;
  const value: AuditSchema = { v2: false, candidates: false, appCommit: false };
  try {
    const sb = auditDb();
    if (!sb) return value;
    const [v2, cand, commit] = await Promise.all([
      withTimeout(sb.from(PREDICTION_LOG_TABLE).select("prediction_id, settle_attempts").limit(1), 5_000),
      withTimeout(sb.from(CANDIDATES_TABLE).select("id").limit(1), 5_000),
      withTimeout(sb.from(PREDICTION_LOG_TABLE).select("app_commit").limit(1), 5_000),
    ]);
    value.v2 = Boolean(v2 && !v2.error);
    value.candidates = Boolean(cand && !cand.error);
    value.appCommit = value.v2 && Boolean(commit && !commit.error);
    // Only cache a definite answer; a timeout is retried next call.
    if (v2 && cand && commit) schemaCache = { at: Date.now(), value };
  } catch (e) {
    auditWarn("schema check", e);
  }
  return value;
}

export function num(v: unknown, digits: number): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

export function isoTime(v: number | string | null | undefined): string | null {
  if (v == null || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null;
}

export function sportOf(pickCode: string | null | undefined, sport?: string | null, label?: string | null): string {
  const code = pickCode ?? "";
  if (code.startsWith("BB")) return "basketball";
  if (code.startsWith("TN")) return "tennis";
  const s = (sport || label || "").toString().trim().toLowerCase();
  if (s === "ice hockey") return "hockey";
  return s || "football";
}

/** Insert rows in chunks inside a time budget. Returns rows accepted. */
export async function upsertChunks(
  table: string,
  rows: Record<string, unknown>[],
  opts: { onConflict: string; ignoreDuplicates: boolean; timeoutMs: number; chunk?: number },
): Promise<{ written: number; error?: string }> {
  const sb = auditDb();
  if (!sb || !rows.length) return { written: 0 };
  const size = opts.chunk ?? 200;
  const started = Date.now();
  let written = 0;
  for (let i = 0; i < rows.length; i += size) {
    const left = opts.timeoutMs - (Date.now() - started);
    if (left < 300) return { written, error: "time budget used" };
    const chunk = rows.slice(i, i + size);
    const res = await withTimeout(
      sb.from(table).upsert(chunk, { onConflict: opts.onConflict, ignoreDuplicates: opts.ignoreDuplicates }),
      left,
    );
    if (!res) return { written, error: "timed out" };
    if (res.error) return { written, error: res.error.message };
    written += chunk.length;
  }
  return { written };
}
