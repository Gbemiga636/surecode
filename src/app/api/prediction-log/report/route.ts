import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CANDIDATES_TABLE, PREDICTION_LOG_TABLE, auditSchema } from "@/lib/audit-db";
import { checkPredictionLogAuth } from "@/lib/prediction-log-auth";
import { V2_FILTERS, applyAuditFilters, parseAuditFilters } from "@/lib/prediction-log-query";
import { buildReport, type CandidateRow, type ReportRow } from "@/lib/prediction-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_ROWS = 50_000;
const PAGE = 1_000;

const V1_COLUMNS =
  "event_id, pick_code, source, sport, market, model_version, slip_code, odds, confidence, closing_odds, result, kickoff, created_at, settled_at, settle_note, slip_odds";

/**
 * GET /api/prediction-log/report — official performance summary (read-only).
 *
 * Same auth and filters as /api/prediction-log. Add `eval=1` to restrict to
 * the clean evaluation set (rows generated before kickoff, live or recovered).
 */
export async function GET(request: Request) {
  const auth = checkPredictionLogAuth(request);
  if (!auth.ok) return auth.response;

  const q = new URL(request.url).searchParams;
  const parsed = parseAuditFilters(q);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400, headers: NO_STORE });
  const filters = parsed.filters;
  const evalOnly = q.get("eval") === "1";

  try {
    const schema = await auditSchema();
    if (!schema.v2 && (evalOnly || V2_FILTERS.some((k) => filters[k] != null))) {
      return NextResponse.json(
        { ok: false, error: "This filter needs the v2 migration (sql/schema-prediction-log-v2.sql)" },
        { status: 400, headers: NO_STORE },
      );
    }
    const sb = createAdminClient();
    const columns = schema.v2 ? `${V1_COLUMNS}, product_tier, data_origin` : V1_COLUMNS;

    const rows: ReportRow[] = [];
    let truncated = false;
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
      let query = applyAuditFilters(sb.from(PREDICTION_LOG_TABLE).select(columns), filters);
      if (evalOnly) query = query.in("data_origin", ["prospective", "recovered"]).eq("predicted_before_kickoff", true);
      const { data, error } = await query.order("id", { ascending: true }).range(offset, offset + PAGE - 1);
      if (error) {
        console.error("[api/prediction-log/report]", error.message);
        return NextResponse.json({ ok: false, error: "Query failed" }, { status: 500, headers: NO_STORE });
      }
      rows.push(...((data ?? []) as unknown as ReportRow[]));
      if (!data || data.length < PAGE) break;
      if (offset + PAGE >= MAX_ROWS) truncated = true;
    }

    let candidates: CandidateRow[] | null = null;
    if (schema.candidates) {
      candidates = [];
      for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
        let cq = sb
          .from(CANDIDATES_TABLE)
          .select("product_tier, market, sport, odds, status, result")
          .in("result", ["win", "loss"]);
        if (filters.from) cq = cq.gte("kickoff", `${filters.from}T00:00:00.000Z`);
        if (filters.to) cq = cq.lt("kickoff", new Date(Date.parse(`${filters.to}T00:00:00.000Z`) + 86_400_000).toISOString());
        if (filters.sport) cq = cq.eq("sport", filters.sport);
        if (filters.market) cq = cq.eq("market", filters.market);
        if (filters.model_version) cq = cq.eq("model_version", filters.model_version);
        if (filters.product_tier) cq = cq.eq("product_tier", filters.product_tier);
        const { data, error } = await cq.order("id", { ascending: true }).range(offset, offset + PAGE - 1);
        if (error) {
          candidates = null;
          break;
        }
        candidates.push(...((data ?? []) as CandidateRow[]));
        if (!data || data.length < PAGE) break;
      }
    }

    return NextResponse.json(
      {
        ok: true,
        schema: schema.v2 ? "v2" : "v1",
        generated_at: new Date().toISOString(),
        filters: { ...filters, eval: evalOnly },
        rows_considered: rows.length,
        truncated,
        ...buildReport(rows, candidates),
      },
      { headers: NO_STORE },
    );
  } catch (e) {
    console.error("[api/prediction-log/report]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Query failed" }, { status: 500, headers: NO_STORE });
  }
}
