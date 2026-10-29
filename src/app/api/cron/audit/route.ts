import { NextResponse } from "next/server";
import { recoverStoredSureCodes } from "@/lib/prediction-recover";
import { resetStaleCancellations, runAuditMaintenance } from "@/lib/prediction-settle";
import { isCronAuthorized as isAuthorized } from "@/lib/cron-auth";

export const maxDuration = 90;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUDGET_MS = 75_000;

/**
 * Audit maintenance: recover Sure codes the crawl stored but did not log,
 * snapshot pre-kickoff (closing) odds, then settle pending prediction_log /
 * prediction_candidates rows. Touches only the audit tables; the prediction
 * engine and the app's own codes are not involved.
 *
 * `?recover_days=N` (0–60, default 2) widens the recovery window, e.g. once
 * after the v2 migration to bring in the history since launch.
 * `?candidates_only=1` skips recovery and published predictions and spends the
 * whole budget grading the prediction_candidates backlog.
 * `?regrade_stale_cancels=1` first puts rows the old 72h rule marked
 * `cancelled` ("No final result 72h after kickoff") back to pending.
 */
async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const q = new URL(request.url).searchParams;
  if (q.get("regrade_stale_cancels") === "1") {
    const reset = await resetStaleCancellations();
    const result = await runAuditMaintenance({ budgetMs: BUDGET_MS - (Date.now() - started), closing: false });
    return NextResponse.json({ ok: true, reset, ...result }, { headers: { "Cache-Control": "no-store" } });
  }
  if (q.get("candidates_only") === "1") {
    const result = await runAuditMaintenance({ budgetMs: BUDGET_MS, candidatesOnly: true });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  }
  const raw = Number(q.get("recover_days") ?? 2);
  const days = Number.isFinite(raw) ? Math.min(60, Math.max(0, Math.floor(raw))) : 2;
  const recovered = await recoverStoredSureCodes({ days, budgetMs: days > 2 ? 40_000 : 15_000 });
  const result = await runAuditMaintenance({ budgetMs: BUDGET_MS - (Date.now() - started) });
  return NextResponse.json({ ok: true, recovered, ...result }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
