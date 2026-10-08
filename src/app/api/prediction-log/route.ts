import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PREDICTION_LOG_TABLE, auditSchema } from "@/lib/audit-db";
import { checkPredictionLogAuth } from "@/lib/prediction-log-auth";
import { V2_FILTERS, applyAuditFilters, dateColumn, parseAuditFilters } from "@/lib/prediction-log-query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

function bad(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400, headers: NO_STORE });
}

function int(q: URLSearchParams, key: string, def: number, min: number, max: number): number | null {
  const raw = q.get(key);
  if (raw == null || raw === "") return def;
  if (!/^\d+$/.test(raw)) return null;
  return Math.min(max, Math.max(min, Number(raw)));
}

/**
 * GET /api/prediction-log — read-only audit export.
 *
 * Auth: `Authorization: Bearer <PREDICTION_LOG_API_KEY>` or `x-api-key: <key>`.
 *
 * Query params (all optional):
 *   from, to        YYYY-MM-DD (UTC, both inclusive)
 *   date_field      created (default) | kickoff — which timestamp from/to apply to
 *   sport, market, result, slip_code, source, model_version,
 *   product_tier, published, event_id, prediction_id,
 *   data_origin (prospective | recovered)                     exact match
 *   league          case-insensitive "contains"
 *   limit           1–1000 (default 100)
 *   offset          for paging (default 0)
 *   order           desc (default) | asc
 */
export async function GET(request: Request) {
  const auth = checkPredictionLogAuth(request);
  if (!auth.ok) return auth.response;

  const q = new URL(request.url).searchParams;
  const parsed = parseAuditFilters(q);
  if (!parsed.ok) return bad(parsed.error);
  const filters = parsed.filters;

  const order = (q.get("order") ?? "desc").toLowerCase();
  if (order !== "asc" && order !== "desc") return bad("order must be asc or desc");
  const limit = int(q, "limit", 100, 1, 1000);
  const offset = int(q, "offset", 0, 0, 1_000_000);
  if (limit == null || offset == null) return bad("limit / offset must be whole numbers");

  try {
    const schema = await auditSchema();
    if (!schema.v2 && V2_FILTERS.some((k) => filters[k] != null)) {
      return bad("product_tier / published / prediction_id / data_origin filters need the v2 migration (sql/schema-prediction-log-v2.sql)");
    }

    const sb = createAdminClient();
    const column = dateColumn(filters);
    const query = applyAuditFilters(sb.from(PREDICTION_LOG_TABLE).select("*", { count: "exact" }), filters);
    const { data, count, error } = await query
      .order(column, { ascending: order === "asc", nullsFirst: false })
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("[api/prediction-log]", error.message);
      return NextResponse.json({ ok: false, error: "Query failed" }, { status: 500, headers: NO_STORE });
    }

    const rows = (data ?? []).map((r: Record<string, unknown>) => {
      const { dedupe_key: _internal, ...rest } = r;
      void _internal;
      return rest;
    });
    const total = count ?? rows.length;
    return NextResponse.json(
      {
        ok: true,
        schema: schema.v2 ? "v2" : "v1",
        total,
        count: rows.length,
        limit,
        offset,
        next_offset: offset + rows.length < total ? offset + rows.length : null,
        filters: { ...filters, order },
        rows,
      },
      { headers: NO_STORE },
    );
  } catch (e) {
    console.error("[api/prediction-log]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Query failed" }, { status: 500, headers: NO_STORE });
  }
}
