import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPredictionLogAuth } from "@/lib/prediction-log-auth";
import { auditSchema } from "@/lib/audit-db";
import { loadEvalSelections, loadLogRows, parseWindow } from "@/lib/eval-data";
import { customerSlipLevel, devigCoverage, inWindow, versionCheck } from "@/lib/evaluation";
import {
  coverageSection,
  devigSection,
  hypothesesSection,
  integritySection,
  mappingSample,
  patternsSection,
  phase0Section,
  sharpCoverageSection,
} from "@/lib/eval-v3-data";
import { GET as selectionLift } from "@/app/api/prediction-log/selection-lift/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };
const SECTIONS = ["weekly", "coverage", "devig", "patterns", "phase0", "sharp", "mapping-sample", "hypotheses"] as const;
const BRIEF_START = "2026-10-17";

/**
 * GET /api/prediction-log/v3 — Brief v3 evaluation and sharp-line test (read-only).
 *
 * section = weekly (default) | coverage (0.1) | devig (B1) | patterns (D5)
 *         | phase0 (0.3/0.4) | sharp (C1) | mapping-sample (C2) | hypotheses (D)
 * from / to: YYYY-MM-DD (default from 2026-10-17). patterns: min_n (default 400).
 * phase0: threshold (default 0.03). mapping-sample: n (default 200).
 */
export async function GET(request: Request) {
  const auth = checkPredictionLogAuth(request);
  if (!auth.ok) return auth.response;
  const q = new URL(request.url).searchParams;
  const section = (q.get("section") ?? "weekly") as (typeof SECTIONS)[number];
  if (!SECTIONS.includes(section)) {
    return NextResponse.json({ ok: false, error: `section must be one of ${SECTIONS.join(", ")}` }, { status: 400, headers: NO_STORE });
  }
  const win = parseWindow(q.get("from") ?? BRIEF_START, q.get("to"));
  if ("error" in win) return NextResponse.json({ ok: false, error: win.error }, { status: 400, headers: NO_STORE });
  const fromIso = win.fromIso!;
  const sb = createAdminClient();
  const ok = (body: Record<string, unknown>) =>
    NextResponse.json({ ok: true, generated_at: new Date().toISOString(), section, ...body }, { headers: NO_STORE });

  try {
    const schema = await auditSchema();
    const needV3 = () => NextResponse.json({ ok: false, error: "Run sql/schema-eval-v3.sql first" }, { status: 400, headers: NO_STORE });

    if (section === "coverage") return ok(await coverageSection(sb, fromIso));
    if (section === "devig") return ok(await devigSection(sb, fromIso));
    if (section === "patterns") {
      const minN = Math.min(5_000, Math.max(50, Number(q.get("min_n")) || 400));
      return ok(await patternsSection(sb, fromIso, minN));
    }
    if (section === "hypotheses") return ok(await hypothesesSection(sb));
    if (section === "phase0") {
      if (!schema.evalV3) return needV3();
      const threshold = Math.min(0.5, Math.max(0, Number(q.get("threshold") ?? 0.03)));
      return ok(await phase0Section(sb, q.get("from") ? fromIso : null, threshold));
    }
    if (section === "sharp") return schema.evalV3 ? ok(await sharpCoverageSection(sb)) : needV3();
    if (section === "mapping-sample") {
      return schema.evalV3 ? ok(await mappingSample(sb, Math.min(500, Math.max(10, Number(q.get("n")) || 200)))) : needV3();
    }

    // ── weekly ──
    const log = await loadLogRows(sb, win);
    const sel = await loadEvalSelections(sb, win, log.rows);
    const windowRows = log.rows.filter((r) => inWindow(r.created_at, win.fromIso, win.toIso));
    const integrity = await integritySection(sb, fromIso);
    const customer = customerSlipLevel(windowRows, win.fromIso, win.toIso);
    const versions = versionCheck(sel.rows.filter((r) => r.product === "sure-engine"));
    const hyps = await hypothesesSection(sb);
    const phase0 = schema.evalV3 ? await phase0Section(sb, null, 0.03) : null;
    const sharp = schema.evalV3 ? await sharpCoverageSection(sb) : null;

    const liftUrl = new URL("/api/prediction-log/selection-lift", request.url);
    liftUrl.searchParams.set("from", q.get("from") ?? BRIEF_START);
    if (q.get("to")) liftUrl.searchParams.set("to", q.get("to")!);
    const liftRes = await selectionLift(new Request(liftUrl, { headers: request.headers }));
    const lift = liftRes.ok ? ((await liftRes.json()) as Record<string, any>) : null;
    const overallLift = lift?.overall_matched_within_tier ?? null;

    const p = integrity as Record<string, any>;
    const manual = Number(p.needs_manual_grading_log ?? NaN);
    const pass = (v: boolean | null | undefined) => (v == null ? "n/a" : v ? "pass" : "open");
    const phases = {
      phase0: {
        provider: "pinnodds.com (Pinnacle prematch), trial key 100 requests/day",
        decision: phase0?.decision ?? "no_data",
        gaps_per_day: phase0?.gaps_per_day ?? null,
        median_duration_minutes: phase0?.median_duration_minutes ?? null,
        sharp_coverage_at_creation: sharp && "creation_coverage" in sharp ? sharp.creation_coverage : null,
      },
      A1: { status: "pass", note: "No scoring change across 42340a2, 28a490a, 1c0a0bf, e028131 (docs/EVALUATION_V3.md)." },
      A2: { status: pass(Number.isFinite(manual) ? manual === 0 : null), needs_manual_grading: p.needs_manual_grading_log, note: "Acceptance: 0 for 7 consecutive weekly checks." },
      A3: {
        status: pass(customer.all_created_before_first_kickoff),
        all_created_before_first_kickoff: customer.all_created_before_first_kickoff,
        excluded_created_after_first_kickoff: customer.excluded_created_after_first_kickoff,
      },
      A4: { status: "pass", note: "docs/EVALUATION_LAYER_V1.md: 51 rows / 4 unique selections, rebooking duplication." },
      A5: { status: pass(overallLift ? overallLift.unique_selected_n != null : null), unique_selected_n: lift?.unique_selected_n ?? null, unique_control_n: lift?.unique_control_n ?? null },
      B1: {
        status: pass(p.p_fair ? p.p_fair.methods_seen.length <= 1 && (p.p_fair.log_coverage ?? 0) >= 0.95 : null),
        ...(p.p_fair ?? {}),
      },
      B2: { status: pass(p.closing_sporty ? (p.closing_sporty.coverage ?? 0) >= 0.95 : null), ...(p.closing_sporty ?? {}) },
      C1: { status: pass(sharp && "creation_coverage" in sharp && sharp.creation_coverage != null ? sharp.creation_coverage >= 0.9 : null), coverage: sharp && "creation_coverage" in sharp ? sharp.creation_coverage : null },
      C2: { status: "manual", mappings: sharp?.mapped_events ?? 0, note: "Spot-check 200 rows from section=mapping-sample (≤ 2 mismatches)." },
      C3: { status: pass(p.clv_sharp ? p.clv_sharp.coverage != null && p.clv_sharp.coverage >= 0.95 : null), ...(p.clv_sharp ?? {}) },
    };

    return ok({
      window: { from: q.get("from") ?? BRIEF_START, to: q.get("to") },
      phases,
      integrity: {
        view_count: sel.viewCount,
        unique_selections: sel.rows.length,
        manual_grading_backlog: { log: p.needs_manual_grading_log, candidates: p.needs_manual_grading_candidates },
        late_customer_slips: customer.excluded_created_after_first_kickoff,
        engine_versions: versions.sure_engine_versions,
        one_engine_version: versions.one_sure_engine_version,
        devig_coverage: devigCoverage(windowRows),
        p_fair: p.p_fair ?? null,
        closing_sporty: p.closing_sporty ?? null,
        sharp_coverage: sharp,
        clv_sharp: p.clv_sharp ?? null,
      },
      hypotheses: hyps,
      phase0,
      selection_lift: lift
        ? {
            unique_selected_n: lift.unique_selected_n,
            unique_control_n: lift.unique_control_n,
            overall: overallLift,
            by_tier: lift.by_tier ?? null,
          }
        : { error: "selection lift unavailable" },
    });
  } catch (e) {
    console.error("[api/prediction-log/v3]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Query failed" }, { status: 500, headers: NO_STORE });
  }
}
