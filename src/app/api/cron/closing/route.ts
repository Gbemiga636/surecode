import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { captureClosingPrices } from "@/lib/closing-capture";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Brief v3 B2: SportyBet price of every published and shadow selection
 * kicking off in the next 10 minutes. Meant to run every 5 minutes from
 * Supabase pg_cron (sql/schedule-v3.sql) or any external scheduler.
 */
async function handle(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const result = await captureClosingPrices(50_000);
  return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
