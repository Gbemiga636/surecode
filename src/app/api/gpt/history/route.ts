import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { T } from "@/lib/db";
import { gptAuthorized } from "@/lib/gpt-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Leg = { home?: string; away?: string; pickLabel?: string; pickCode?: string; odds?: number };

export async function GET(request: Request) {
  if (!gptAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  try {
    const sb = createAdminClient();
    const [legsRes, slipsRes] = await Promise.all([
      sb
        .from(T.legHistory)
        .select("home, away, league, pick_code, pick_label, odds, home_score, away_score, won, settled_at")
        .gte("settled_at", since)
        .not("home_score", "is", null)
        .order("settled_at", { ascending: false })
        .limit(limit),
      sb
        .from(T.pastCodes)
        .select("day, code, total_odds, confidence, outcome, legs")
        .gte("day", since.slice(0, 10))
        .order("day", { ascending: false })
        .limit(limit),
    ]);
    if (legsRes.error) throw new Error(legsRes.error.message);
    if (slipsRes.error) throw new Error(slipsRes.error.message);

    return NextResponse.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        window: { days, since },
        legs: (legsRes.data ?? []).map((r) => ({
          match: `${r.home} vs ${r.away}`,
          league: r.league,
          pick: r.pick_label || r.pick_code,
          pickCode: r.pick_code,
          odds: r.odds != null ? Number(r.odds) : null,
          impliedProbability: r.odds ? Number((1 / Number(r.odds)).toFixed(4)) : null,
          score: `${r.home_score}-${r.away_score}`,
          won: r.won,
          settledAt: r.settled_at,
        })),
        slips: (slipsRes.data ?? []).map((r) => ({
          day: r.day,
          code: r.code,
          totalOdds: r.total_odds != null ? Number(r.total_odds) : null,
          confidence: r.confidence != null ? Number(r.confidence) : null,
          outcome: r.outcome,
          legs: ((Array.isArray(r.legs) ? r.legs : []) as Leg[]).map((l) => ({
            match: `${l.home ?? "?"} vs ${l.away ?? "?"}`,
            pick: l.pickLabel || l.pickCode || null,
            odds: l.odds != null ? Number(l.odds) : null,
          })),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
