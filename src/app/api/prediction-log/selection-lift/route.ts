import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CANDIDATES_TABLE, auditSchema } from "@/lib/audit-db";
import { checkPredictionLogAuth } from "@/lib/prediction-log-auth";
import { DEFAULT_LIFT_OPTIONS, selectionLiftReport, type LiftCandidate } from "@/lib/selection-lift";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_ROWS = 100_000;
const PAGE = 1_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const COLUMNS = "id, product_tier, sport, league, market, pick_code, event_id, odds, kickoff, evaluated_at, day, status, result";

function bounded(raw: string | null, fallback: number, min: number, max: number): number | null {
  if (raw == null || raw === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= min && v <= max ? v : null;
}

/**
 * GET /api/prediction-log/selection-lift — matched-control comparison of the
 * engine's selected high-confidence picks against similar rejected candidates
 * (read-only, same auth as /api/prediction-log).
 *
 * Query: from, to (YYYY-MM-DD, by candidate day), min_implied (0.05–0.99,
 * default 0.70), tolerance (0.01–0.15, default 0.05), controls (1–10, default 3).
 */
export async function GET(request: Request) {
  const auth = checkPredictionLogAuth(request);
  if (!auth.ok) return auth.response;

  const q = new URL(request.url).searchParams;
  const from = q.get("from");
  const to = q.get("to");
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) {
    return NextResponse.json({ ok: false, error: "from/to must be YYYY-MM-DD" }, { status: 400, headers: NO_STORE });
  }
  const minImplied = bounded(q.get("min_implied"), DEFAULT_LIFT_OPTIONS.minImplied, 0.05, 0.99);
  const tolerance = bounded(q.get("tolerance"), DEFAULT_LIFT_OPTIONS.impliedTolerance, 0.01, 0.15);
  const controls = bounded(q.get("controls"), DEFAULT_LIFT_OPTIONS.controlsPerSelected, 1, 10);
  if (minImplied == null || tolerance == null || controls == null || !Number.isInteger(controls)) {
    return NextResponse.json({ ok: false, error: "Invalid min_implied, tolerance or controls" }, { status: 400, headers: NO_STORE });
  }

  try {
    const schema = await auditSchema();
    if (!schema.candidates) {
      return NextResponse.json(
        { ok: false, error: "Candidate logging needs the v2 migration (sql/schema-prediction-log-v2.sql)" },
        { status: 400, headers: NO_STORE },
      );
    }
    const sb = createAdminClient();
    const rows: LiftCandidate[] = [];
    let truncated = false;
    let pending = 0;
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
      let query = sb.from(CANDIDATES_TABLE).select(COLUMNS);
      if (from) query = query.gte("day", from);
      if (to) query = query.lte("day", to);
      const { data, error } = await query.order("id", { ascending: true }).range(offset, offset + PAGE - 1);
      if (error) {
        console.error("[api/prediction-log/selection-lift]", error.message);
        return NextResponse.json({ ok: false, error: "Query failed" }, { status: 500, headers: NO_STORE });
      }
      for (const r of (data ?? []) as unknown as LiftCandidate[]) {
        if (r.result === "pending") pending++;
        rows.push(r);
      }
      if (!data || data.length < PAGE) break;
      if (offset + PAGE >= MAX_ROWS) truncated = true;
    }

    const report = selectionLiftReport(rows, {
      ...DEFAULT_LIFT_OPTIONS,
      minImplied,
      impliedTolerance: tolerance,
      controlsPerSelected: controls,
    });
    return NextResponse.json(
      {
        ok: true,
        generated_at: new Date().toISOString(),
        filters: { from, to },
        truncated,
        pending_candidates: pending,
        unique_selected_n: report.overall_matched_within_tier.unique_selected_n,
        unique_control_n: report.overall_matched_within_tier.unique_control_n,
        ...report,
      },
      { headers: NO_STORE },
    );
  } catch (e) {
    console.error("[api/prediction-log/selection-lift]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Query failed" }, { status: 500, headers: NO_STORE });
  }
}
