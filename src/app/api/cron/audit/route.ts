import { NextResponse } from "next/server";
import { recoverStoredSureCodes } from "@/lib/prediction-recover";
import { runAuditMaintenance } from "@/lib/prediction-settle";

export const maxDuration = 90;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Same secrets as /api/crawl: Vercel Cron's CRON_SECRET, or CRAWL_SECRET for manual runs. */
function isAuthorized(request: Request): boolean {
  const crawlSecret = process.env.CRAWL_SECRET || "";
  const cronSecret = process.env.CRON_SECRET || "";
  const hdr = request.headers.get("x-crawl-secret") || "";
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (crawlSecret && (hdr === crawlSecret || bearer === crawlSecret)) return true;
  if (cronSecret && bearer === cronSecret) return true;
  return false;
}

const BUDGET_MS = 75_000;

/**
 * Audit maintenance: recover Sure codes the crawl stored but did not log,
 * snapshot pre-kickoff (closing) odds, then settle pending prediction_log /
 * prediction_candidates rows. Touches only the audit tables; the prediction
 * engine and the app's own codes are not involved.
 *
 * `?recover_days=N` (0–60, default 2) widens the recovery window, e.g. once
 * after the v2 migration to bring in the history since launch.
 */
async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const raw = Number(new URL(request.url).searchParams.get("recover_days") ?? 2);
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
