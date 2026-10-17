import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CANDIDATES_TABLE } from "@/lib/audit-db";
import { checkPredictionLogAuth } from "@/lib/prediction-log-auth";
import { loadEvalSelections, loadLogRows, parseWindow } from "@/lib/eval-data";
import {
  customerSlipLevel,
  devigCoverage,
  enumCheck,
  inWindow,
  legLevel,
  modelVsMarket,
  officialSlipLevel,
  recoveredBreakdown,
  versionCheck,
} from "@/lib/evaluation";
import { RESCHEDULED_NOTE_PREFIX } from "@/lib/prediction-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/prediction-log/evaluation — evaluation layer v1 (read-only).
 *
 * Three separate levels: leg (unique selections from v_eval_selections),
 * official slip (published, by slip_code) and customer slip (booked by the
 * server at creation). Plus Champion vs de-vigged market on the same unique
 * selections, and the integrity checks from the brief.
 *
 * Query: from / to (YYYY-MM-DD, UTC, on created_at), product, tier,
 * bootstrap (100–5000, default 1000).
 */
export async function GET(request: Request) {
  const auth = checkPredictionLogAuth(request);
  if (!auth.ok) return auth.response;

  const q = new URL(request.url).searchParams;
  const win = parseWindow(q.get("from"), q.get("to"));
  if ("error" in win) return NextResponse.json({ ok: false, error: win.error }, { status: 400, headers: NO_STORE });
  const product = q.get("product");
  const tier = q.get("tier");
  const iterations = Number(q.get("bootstrap")) || 1_000;

  try {
    const sb = createAdminClient();
    const log = await loadLogRows(sb, win);
    const sel = await loadEvalSelections(sb, win, log.rows);
    const legs = sel.rows.filter((r) => (!product || r.product === product) && (!tier || r.tier === tier));
    const windowRows = log.rows.filter((r) => inWindow(r.created_at, win.fromIso, win.toIso));
    const scoped = windowRows.filter((r) => (!product || r.product === product) && (!tier || r.tier === tier));

    const now = Date.now();
    const overdue = windowRows.filter((r) => {
      if (r.result !== "pending" || r.settled_at || !r.kickoff) return false;
      const moved = r.settle_note?.startsWith(RESCHEDULED_NOTE_PREFIX) ? Date.parse(r.settle_note.slice(RESCHEDULED_NOTE_PREFIX.length)) : NaN;
      const due = Number.isFinite(moved) ? moved : Date.parse(r.kickoff);
      return now - due > 6 * 3_600_000;
    });
    const manual = windowRows.filter((r) => r.result === "pending" && r.settle_note?.startsWith("needs manual grading"));

    const coverage = devigCoverage(windowRows);
    let candidateCoverage: { rows_since: number; with_devig: number; coverage: number | null } | null = null;
    if (log.schema.evalV1 && coverage.capture_started_at) {
      const [all, withDevig] = await Promise.all([
        sb.from(CANDIDATES_TABLE).select("id", { count: "exact", head: true }).gte("created_at", coverage.capture_started_at),
        sb
          .from(CANDIDATES_TABLE)
          .select("id", { count: "exact", head: true })
          .gte("created_at", coverage.capture_started_at)
          .not("devig_prob", "is", null),
      ]);
      if (!all.error && !withDevig.error) {
        const n = all.count ?? 0;
        const k = withDevig.count ?? 0;
        candidateCoverage = { rows_since: n, with_devig: k, coverage: n ? Math.round((k / n) * 10_000) / 10_000 : null };
      }
    }

    return NextResponse.json(
      {
        ok: true,
        generated_at: new Date().toISOString(),
        window: { from: q.get("from"), to: q.get("to"), on: "created_at", product, tier },
        leg_source: sel.source,
        truncated: log.truncated || sel.truncated,
        checks: {
          leg_count: legs.length,
          view_count: product || tier ? null : sel.viewCount,
          leg_count_matches_view: product || tier || sel.viewCount == null ? null : sel.viewCount === sel.rows.length,
          recovered_rows_in_eval: sel.rows.filter((r) => r.data_origin === "recovered").length,
          ...enumCheck(windowRows.filter((r) => r.published)),
          pending_overdue_6h: overdue.length,
          needs_manual_grading: manual.length,
          ...versionCheck(sel.rows.filter((r) => r.product === "sure-engine")),
          devig_coverage_log: coverage,
          devig_coverage_candidates: candidateCoverage,
        },
        legs: legLevel(legs),
        official_slips: officialSlipLevel(scoped, win.fromIso, win.toIso),
        customer_slips: customerSlipLevel(scoped, win.fromIso, win.toIso),
        model_vs_market: modelVsMarket(legs, { iterations }),
        recovered_breakdown: recoveredBreakdown(windowRows),
      },
      { headers: NO_STORE },
    );
  } catch (e) {
    console.error("[api/prediction-log/evaluation]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Query failed" }, { status: 500, headers: NO_STORE });
  }
}
