import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { T } from "@/lib/db";
import { gptAuthorized, gptUnauthorized } from "@/lib/gpt-auth";
import { calibration, inferSport, summarize, type Sample } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LegRow = {
  league: string | null;
  pick_code: string;
  odds: number | null;
  won: boolean;
  home_score: number | null;
  settled_at: string;
};

function groupBy(rows: LegRow[], key: (r: LegRow) => string, minN: number) {
  const map = new Map<string, Sample[]>();
  for (const r of rows) {
    const k = key(r);
    const odds = Number(r.odds);
    const arr = map.get(k) ?? [];
    arr.push({ p: 1 / odds, y: r.won ? 1 : 0, odds });
    map.set(k, arr);
  }
  return [...map.entries()]
    .filter(([, s]) => s.length >= minN)
    .map(([k, s]) => ({ key: k, ...summarize(s) }))
    .sort((a, b) => b.n - a.n);
}

/**
 * Probability-quality report for Custom GPT.
 * Leg forecast = market-implied 1/odds (bookmaker margin included).
 * Slip forecast = stored confidence (product of implied leg probabilities).
 */
export async function GET(request: Request) {
  if (!gptAuthorized(request)) return gptUnauthorized(request);

  const url = new URL(request.url);
  const days = Math.min(365, Math.max(7, Number(url.searchParams.get("days")) || 90));
  const minN = Math.min(200, Math.max(1, Number(url.searchParams.get("minSample")) || 10));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const sinceDay = since.slice(0, 10);

  try {
    const sb = createAdminClient();
    const [legsRes, slipsRes] = await Promise.all([
      sb
        .from(T.legHistory)
        .select("league, pick_code, odds, won, home_score, settled_at")
        .gte("settled_at", since)
        .order("settled_at", { ascending: false })
        .limit(5000),
      sb
        .from(T.pastCodes)
        .select("day, outcome, confidence, total_odds, legs")
        .in("outcome", ["WON", "LOST"])
        .gte("day", sinceDay)
        .limit(2000),
    ]);

    if (legsRes.error) throw new Error(legsRes.error.message);
    if (slipsRes.error) throw new Error(slipsRes.error.message);

    const allLegs = (legsRes.data ?? []) as LegRow[];
    // Rows without a recorded score came from a winning-slips-only backfill → biased.
    const legs = allLegs.filter((r) => r.home_score != null && Number(r.odds) > 1);
    const excludedUnscored = allLegs.filter((r) => r.home_score == null).length;

    const legSamples: Sample[] = legs.map((r) => ({
      p: 1 / Number(r.odds),
      y: r.won ? 1 : 0,
      odds: Number(r.odds),
    }));

    const slipSamples: Sample[] = (slipsRes.data ?? [])
      .filter((r) => r.confidence != null)
      .map((r) => ({
        p: Number(r.confidence),
        y: r.outcome === "WON" ? 1 : 0,
        odds: r.total_odds != null ? Number(r.total_odds) : undefined,
      }));

    const lastSettled = legs[0]?.settled_at ?? null;
    const staleHours = lastSettled
      ? Math.round((Date.now() - new Date(lastSettled).getTime()) / 36e5)
      : null;

    return NextResponse.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        window: { days, since },
        definitions: {
          legForecast: "Market-implied probability 1/odds (includes bookmaker margin; not de-vigged).",
          slipForecast:
            "Stored slip confidence = product of implied leg probabilities. Not a calibrated model probability.",
          brierSkill: "1 - Brier / Brier(base-rate forecast). >0 beats always predicting the base rate.",
          flatStakeRoi: "Mean profit per 1-unit stake. Secondary, high-variance metric.",
          ece: "Expected calibration error across 10 equal-width probability bins.",
        },
        dataQuality: {
          legRowsInWindow: allLegs.length,
          legRowsUsed: legs.length,
          excludedUnscoredRows: excludedUnscored,
          excludedReason:
            "Rows without scores came from a winning-slips-only backfill (selection bias).",
          lastSettledAt: lastSettled,
          hoursSinceLastSettle: staleHours,
          stale: staleHours == null || staleHours > 48,
          sportColumn: "absent — sport inferred from pick code",
        },
        legs: {
          overall: summarize(legSamples),
          calibration: calibration(legSamples),
          byMarket: groupBy(legs, (r) => r.pick_code, minN),
          bySport: groupBy(legs, (r) => inferSport(r.pick_code), minN),
          byLeague: groupBy(legs, (r) => r.league || "unknown", minN).slice(0, 25),
        },
        slips: {
          overall: summarize(slipSamples),
          calibration: calibration(slipSamples),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
