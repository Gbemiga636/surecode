/**
 * Data access for the evaluation layer. Leg metrics come only from the
 * `v_eval_selections` view; until sql/schema-eval-v1.sql has been run the
 * same rows are derived in JS (`evalSelections`, identical filters).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { EVAL_VIEW, PREDICTION_LOG_TABLE, auditSchema, type AuditSchema } from "./audit-db";
import { evalSelections, inWindow, withProductTier, type EvalRow } from "./evaluation";

const PAGE = 1_000;
const MAX_ROWS = 60_000;

const BASE_COLUMNS =
  "event_id, pick_code, source, slot, product_tier, data_origin, published, predicted_before_kickoff, result, odds, confidence, created_at, kickoff, model_version, slip_code, slip_odds, slip_confidence, sport, market, league, settle_note, settled_at";

export type LogRow = EvalRow & { settle_note?: string | null; settled_at?: string | null };

function columns(schema: AuditSchema): string {
  let cols = BASE_COLUMNS;
  if (schema.appCommit) cols += ", app_commit";
  if (schema.evalV1) cols += ", product, tier, devig_prob, overround";
  return cols;
}

export type EvalWindow = { fromIso: string | null; toIso: string | null };

/** `from`/`to` as YYYY-MM-DD (UTC, `to` inclusive) → ISO bounds; null = open. */
export function parseWindow(from: string | null, to: string | null): EvalWindow | { error: string } {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (from && !day.test(from)) return { error: "from must be YYYY-MM-DD" };
  if (to && !day.test(to)) return { error: "to must be YYYY-MM-DD" };
  return {
    fromIso: from ? `${from}T00:00:00.000Z` : null,
    toIso: to ? new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000).toISOString() : null,
  };
}

async function pageAll<T>(fetchPage: (offset: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  let truncated = false;
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await fetchPage(offset);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return { rows, truncated };
    if (offset + PAGE >= MAX_ROWS) truncated = true;
  }
  return { rows, truncated };
}

/** Every logged row created before the window end (needed to mirror the view's distinct-on). */
export async function loadLogRows(sb: SupabaseClient, win: EvalWindow) {
  const schema = await auditSchema();
  if (!schema.v2) throw new Error("The evaluation layer needs the v2 migration (sql/schema-prediction-log-v2.sql)");
  const cols = columns(schema);
  const res = await pageAll<LogRow>((offset) => {
    let q = sb.from(PREDICTION_LOG_TABLE).select(cols);
    if (win.toIso) q = q.lt("created_at", win.toIso);
    return q.order("id", { ascending: true }).range(offset, offset + PAGE - 1);
  });
  return { ...res, rows: withProductTier(res.rows), schema };
}

/**
 * Unique evaluation selections in the window: from the view when it exists,
 * otherwise the JS mirror over `logRows`. `viewCount` is an independent
 * `count(*)` of the view for the same window (acceptance check for task 1).
 */
export async function loadEvalSelections(sb: SupabaseClient, win: EvalWindow, logRows?: LogRow[]) {
  const schema = await auditSchema();
  if (schema.evalV1) {
    const cols = columns(schema);
    const res = await pageAll<LogRow>((offset) => {
      let q = sb.from(EVAL_VIEW).select(cols);
      if (win.fromIso) q = q.gte("created_at", win.fromIso);
      if (win.toIso) q = q.lt("created_at", win.toIso);
      return q
        .order("created_at", { ascending: true })
        .order("product", { ascending: true })
        .order("event_id", { ascending: true })
        .order("pick_code", { ascending: true })
        .range(offset, offset + PAGE - 1);
    });
    let hq = sb.from(EVAL_VIEW).select("event_id", { count: "exact", head: true });
    if (win.fromIso) hq = hq.gte("created_at", win.fromIso);
    if (win.toIso) hq = hq.lt("created_at", win.toIso);
    const head = await hq;
    return {
      source: "view" as const,
      rows: res.rows,
      truncated: res.truncated,
      viewCount: head.error ? null : (head.count ?? null),
    };
  }
  const base = logRows ?? (await loadLogRows(sb, win)).rows;
  return {
    source: "js-fallback (run sql/schema-eval-v1.sql to create v_eval_selections)" as const,
    rows: evalSelections(base).filter((r) => inWindow(r.created_at, win.fromIso, win.toIso)),
    truncated: false,
    viewCount: null,
  };
}
