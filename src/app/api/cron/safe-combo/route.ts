import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { buildSafeCombo } from "@/lib/safe-combo-build";
import { lagosDay } from "@/lib/sure-engine";

export const maxDuration = 120;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Builds the day's Safe combo after a crawl. `?force=1` rebuilds even when the Safe codes haven't changed. */
async function handle(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const force = new URL(request.url).searchParams.get("force") === "1";
  const result = await buildSafeCombo({ day: lagosDay(), force, budgetMs: 105_000 });
  const p = result.payload;
  return NextResponse.json(
    {
      ok: result.ok,
      skipped: result.skipped ?? null,
      day: p?.day ?? lagosDay(),
      combo: p?.combo ? { code: p.combo.code, totalOdds: p.combo.totalOdds, chance: p.combo.chance, legs: p.combo.legs.length } : null,
      picks: p?.picks.length ?? 0,
      ai: p?.ai ?? false,
      note: p?.note ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
