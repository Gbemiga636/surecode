import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runSharpCapture } from "@/lib/sharp-odds";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Brief v3 Phase 0 / C1 / C2: sharp prices for in-scope candidates, event
 * mapping and SportyBet-vs-sharp price pairs. Internal only. Needs
 * SHARP_ODDS_API_KEY; scheduled from pg_cron (sql/schedule-v3.sql).
 */
async function handle(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const result = await runSharpCapture(55_000);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
