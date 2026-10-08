/**
 * Recover published Sure predictions from the codes the crawl stored.
 *
 * Every Sure slip the crawl books is saved to sc_past_codes (legs, odds,
 * confidence, created_at) at the moment it is generated. Rebuilding log rows
 * from there makes the audit complete even when a crawl ran out of time
 * before its own logging step, and lets the history before logging existed
 * be audited. Rows keep the original generation time and are marked
 * data_origin = 'recovered'; duplicates of rows the crawl already logged are
 * ignored (same dedupe key). Needs the v2 schema. Never throws.
 */
import type { BookableLeg } from "./sporty";
import { auditDb, auditDisabled, auditSchema, auditWarn, withTimeout } from "./audit-db";
import { logPredictions, sureEngineVersionAt, type LogSlip } from "./prediction-log";

type StoredCode = {
  day: string;
  code: string;
  total_odds: number | string | null;
  confidence: number | string | null;
  legs: BookableLeg[] | null;
  created_at: string;
};

/** `rowsSubmitted` includes legs that were already logged (ignored as duplicates). */
export type RecoverStats = { scanned: number; slips: number; rowsSubmitted: number; skipped?: string };

const PAGE = 500;

export function storedCodeToLog(row: StoredCode, slot: number | null): LogSlip | null {
  const legs = Array.isArray(row.legs) ? row.legs : [];
  if (!row.code || !legs.length) return null;
  const odds = Number(row.total_odds);
  const conf = Number(row.confidence);
  return {
    source: "sure",
    slipCode: row.code,
    slipOdds: Number.isFinite(odds) ? odds : null,
    slipConfidence: row.confidence != null && Number.isFinite(conf) ? conf : null,
    origin: slot ? `slot-${slot}:recovered` : "recovered",
    slot,
    legs: legs.map((l) => ({ ...l, confidence: l.implied })),
    dataOrigin: "recovered",
    createdAt: row.created_at,
    modelVersion: sureEngineVersionAt(row.created_at),
  };
}

export async function recoverStoredSureCodes(opts: { days: number; budgetMs: number }): Promise<RecoverStats> {
  const stats: RecoverStats = { scanned: 0, slips: 0, rowsSubmitted: 0 };
  try {
    const sb = auditDb();
    if (!sb || auditDisabled() || opts.days <= 0 || opts.budgetMs < 3_000) return stats;
    const schema = await auditSchema();
    if (!schema.v2) return { ...stats, skipped: "v2 migration not applied" };

    const end = Date.now() + opts.budgetMs;
    const left = () => end - Date.now();
    const since = new Date(Date.now() - opts.days * 86_400_000);
    const sinceIso = since.toISOString();

    // Board slots are known only for codes still sitting on a day's board.
    const slots = new Map<string, number>();
    const board = await withTimeout(
      sb.from("sc_sure_codes").select("day, code, slot").gte("day", sinceIso.slice(0, 10)).limit(5_000),
      Math.min(6_000, left()),
    );
    for (const r of (board?.data ?? []) as { day: string; code: string; slot: number }[]) {
      slots.set(`${r.day}|${r.code}`, Number(r.slot) || 0);
    }

    for (let from = 0; left() > 2_500; from += PAGE) {
      const page = await withTimeout(
        sb
          .from("sc_past_codes")
          .select("day, code, total_odds, confidence, legs, created_at")
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: true })
          .range(from, from + PAGE - 1),
        Math.min(8_000, left()),
      );
      if (!page || page.error) {
        if (page?.error) auditWarn("recover select", page.error.message);
        break;
      }
      const rows = (page.data ?? []) as StoredCode[];
      stats.scanned += rows.length;
      const slips = rows
        .map((r) => storedCodeToLog(r, slots.get(`${r.day}|${r.code}`) || null))
        .filter((s): s is LogSlip => Boolean(s));
      stats.slips += slips.length;
      if (slips.length) stats.rowsSubmitted += await logPredictions(slips, { timeoutMs: Math.min(15_000, left() - 1_000) });
      if (rows.length < PAGE) break;
    }
  } catch (e) {
    auditWarn("recover", e);
  }
  return stats;
}
