/**
 * Brief v3 B2: SportyBet price shortly before kickoff for every published and
 * shadow selection. Called every 5 minutes (sql/schedule-v3.sql); each run
 * prices selections kicking off within the next 10 minutes and overwrites the
 * previous capture, so the stored price is the last one seen 0–5 min before
 * kickoff. Audit only, never throws.
 */
import { PICKS } from "./sporty";
import { PREDICTION_LOG_TABLE, SHADOW_TABLE, auditDb, auditDisabled, auditSchema, auditWarn, withTimeout } from "./audit-db";
import { fetchEventBook } from "./market-snapshot";

/** Selections kicking off within this window are priced on each run. */
export const CLOSE_WINDOW_MS = 10 * 60_000;

export type CloseStats = { rows: number; events: number; priced: number; updated: number; ms: number };

type Row = { id: string; event_id: string; pick_code: string | null };

export async function captureClosingPrices(budgetMs: number): Promise<Record<string, CloseStats>> {
  const out: Record<string, CloseStats> = {};
  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);
  try {
    const sb = auditDb();
    if (!sb || auditDisabled()) return out;
    const schema = await auditSchema();
    if (!schema.evalV3) return out;
    const now = Date.now();
    const from = new Date(now).toISOString();
    const to = new Date(now + CLOSE_WINDOW_MS).toISOString();

    const tables: [string, (q: any) => any][] = [
      [PREDICTION_LOG_TABLE, (q) => q.eq("published", true)],
      [SHADOW_TABLE, (q) => q],
    ];
    const due: { table: string; rows: Row[] }[] = [];
    for (const [table, scope] of tables) {
      const res: { data: unknown[] | null; error: { message: string } | null } | undefined = await withTimeout(
        scope(sb.from(table).select("id, event_id, pick_code").eq("result", "pending").gt("kickoff", from).lte("kickoff", to)).limit(3_000),
        Math.min(6_000, left()),
      );
      if (res?.error) auditWarn(`${table} close select`, res.error.message);
      due.push({ table, rows: ((res && !res.error ? res.data : []) ?? []) as Row[] });
      out[table] = { rows: due[due.length - 1].rows.length, events: 0, priced: 0, updated: 0, ms: 0 };
    }

    const events = [...new Set(due.flatMap((d) => d.rows.map((r) => r.event_id)))];
    const books = new Map<string, Awaited<ReturnType<typeof fetchEventBook>>>();
    for (let i = 0; i < events.length; i += 8) {
      if (left() < 3_000) break;
      await Promise.all(
        events.slice(i, i + 8).map(async (id) => {
          books.set(id, (await withTimeout(fetchEventBook(id, Math.min(4_000, left())), Math.min(4_500, left()))) ?? null);
        }),
      );
    }

    const at = new Date().toISOString();
    for (const { table, rows } of due) {
      const stats = out[table];
      stats.events = new Set(rows.map((r) => r.event_id)).size;
      const byPrice = new Map<number, string[]>();
      for (const r of rows) {
        const meta = r.pick_code ? PICKS[r.pick_code] : undefined;
        const price = meta ? books.get(r.event_id)?.[`${meta.marketId}|${meta.specifier}`]?.[meta.outcomeId] : undefined;
        if (!(price && price > 1)) continue;
        stats.priced++;
        byPrice.set(price, [...(byPrice.get(price) ?? []), r.id]);
      }
      for (const [price, ids] of byPrice) {
        for (let i = 0; i < ids.length; i += 200) {
          if (left() < 500) break;
          const u = await withTimeout(
            sb.from(table).update({ sporty_close: Number(price.toFixed(4)), sporty_close_at: at }).in("id", ids.slice(i, i + 200)).eq("result", "pending"),
            Math.min(4_000, left()),
          );
          if (u && !u.error) stats.updated += Math.min(200, ids.length - i);
          else if (u?.error) auditWarn(`${table} close update`, u.error.message);
        }
      }
      stats.ms = Date.now() - started;
    }
  } catch (e) {
    auditWarn("closing capture", e);
  }
  return out;
}
