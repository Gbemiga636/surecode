import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gptAuthorized, gptUnauthorized } from "@/lib/gpt-auth";
import { calibration, summarize, type Sample } from "@/lib/metrics";
import { loadEvalSelections, loadLogRows, type LogRow } from "@/lib/eval-data";
import { buildSlips } from "@/lib/evaluation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const sample = (r: LogRow): Sample => ({ p: 1 / Number(r.odds), y: r.result === "win" ? 1 : 0, odds: Number(r.odds) });

function groupBy(rows: LogRow[], key: (r: LogRow) => string, minN: number) {
  const map = new Map<string, Sample[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = map.get(k) ?? [];
    arr.push(sample(r));
    map.set(k, arr);
  }
  return [...map.entries()]
    .filter(([, s]) => s.length >= minN)
    .map(([k, s]) => ({ key: k, ...summarize(s) }))
    .sort((a, b) => b.n - a.n);
}

/**
 * Probability-quality report for Custom GPT.
 * Legs: unique selections from v_eval_selections (prospective, published,
 * predicted before kickoff, graded), windowed on created_at. Leg forecast =
 * market-implied 1/odds. Slips: official published slips by slip_code.
 */
export async function GET(request: Request) {
  if (!gptAuthorized(request)) return gptUnauthorized(request);

  const url = new URL(request.url);
  const days = Math.min(365, Math.max(7, Number(url.searchParams.get("days")) || 90));
  const minN = Math.min(200, Math.max(1, Number(url.searchParams.get("minSample")) || 10));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const win = { fromIso: since, toIso: null };

  try {
    const sb = createAdminClient();
    const log = await loadLogRows(sb, win);
    const sel = await loadEvalSelections(sb, win, log.rows);
    const legs = sel.rows.filter((r) => Number(r.odds) > 1);
    const legSamples = legs.map(sample);

    const slips = buildSlips(log.rows.filter((r) => r.published && r.data_origin === "prospective" && r.created_at >= since)).filter(
      (s) => s.created_before_first_kickoff && (s.outcome === "win" || s.outcome === "loss") && s.slip_confidence,
    );
    const slipSamples: Sample[] = slips.map((s) => ({
      p: Number(s.slip_confidence),
      y: s.outcome === "win" ? 1 : 0,
      odds: s.payout_odds ?? s.slip_odds ?? undefined,
    }));

    const lastSettled = log.rows.reduce<string | null>((a, r) => (r.settled_at && (!a || r.settled_at > a) ? r.settled_at : a), null);
    const staleHours = lastSettled ? Math.round((Date.now() - new Date(lastSettled).getTime()) / 36e5) : null;

    return NextResponse.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        window: { days, since, on: "created_at" },
        definitions: {
          legs: "Unique selections (one per product, event, pick; first publication) from v_eval_selections.",
          legForecast: "Market-implied probability 1/odds (includes bookmaker margin; not de-vigged).",
          slipForecast:
            "Stored slip confidence = product of implied leg probabilities. Not a calibrated model probability.",
          brierSkill: "1 - Brier / Brier(base-rate forecast). >0 beats always predicting the base rate.",
          flatStakeRoi: "Mean profit per 1-unit stake. Void / cancelled legs are excluded. Secondary, high-variance metric.",
          ece: "Expected calibration error across 10 equal-width probability bins.",
        },
        dataQuality: {
          legSource: sel.source,
          legCount: sel.rows.length,
          viewCount: sel.viewCount,
          legCountMatchesView: sel.viewCount == null ? null : sel.viewCount === sel.rows.length,
          legsUsed: legs.length,
          officialSlipsGraded: slips.length,
          lastSettledAt: lastSettled,
          hoursSinceLastSettle: staleHours,
          stale: staleHours == null || staleHours > 48,
          excluded: "Recovered rows, rows logged after kickoff, unpublished rows and repeat bookings of the same selection.",
        },
        legs: {
          overall: summarize(legSamples),
          calibration: calibration(legSamples),
          byMarket: groupBy(legs, (r) => r.pick_code ?? "unknown", minN),
          bySport: groupBy(legs, (r) => r.sport ?? "unknown", minN),
          byTier: groupBy(legs, (r) => `${r.product} · ${r.tier}`, minN),
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
