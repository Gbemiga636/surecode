import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { T } from "@/lib/db";
import { lagosDay } from "@/lib/sure-engine";
import { modeForSlot, modeLabel, type SureMode } from "@/lib/sure-mode";
import { gptAuthorized } from "@/lib/gpt-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Leg = {
  home?: string;
  away?: string;
  pickLabel?: string;
  pickCode?: string;
  odds?: number;
  kickoff?: number;
  sport?: string;
  sportLabel?: string;
};

/**
 * Custom GPT Actions endpoint — today's Sure codes (Safe / Larger / Longshot).
 * Auth: Authorization: Bearer <GPT_API_SECRET>
 */
export async function GET(request: Request) {
  if (!gptAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized. Use Bearer GPT_API_SECRET." },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const modeParam = (url.searchParams.get("mode") || "all").toLowerCase();
  const day = url.searchParams.get("day") || lagosDay();

  let modes: SureMode[] | null = null;
  if (modeParam === "safe" || modeParam === "boost" || modeParam === "longshot") {
    modes = [modeParam];
  } else if (modeParam !== "all") {
    return NextResponse.json(
      { ok: false, error: "mode must be all | safe | boost | longshot" },
      { status: 400 },
    );
  }

  try {
    const sb = createAdminClient();
    const { data, error } = await sb
      .from(T.sureCodes)
      .select("slot, code, share_url, total_odds, confidence, legs, rationale, status, outcome")
      .eq("day", day)
      .order("slot", { ascending: true });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
    }

    const rows = (data ?? []).filter((r) => {
      const m = modeForSlot(Number(r.slot));
      return !modes || modes.includes(m);
    });

    const codes = rows.map((r) => {
      const mode = modeForSlot(Number(r.slot));
      const legs = (Array.isArray(r.legs) ? r.legs : []) as Leg[];
      return {
        slot: Number(r.slot),
        mode,
        modeLabel: modeLabel(mode),
        code: String(r.code),
        openUrl:
          r.share_url ||
          `https://www.sportybet.com/ng/?shareCode=${encodeURIComponent(String(r.code))}`,
        totalOdds: r.total_odds != null ? Number(r.total_odds) : null,
        confidence:
          r.confidence != null ? Math.round(Number(r.confidence) * 100) : null,
        status: r.status ?? null,
        outcome: r.outcome ?? null,
        rationale: r.rationale ?? null,
        legs: legs.map((l) => ({
          sport: l.sportLabel || l.sport || null,
          match: `${l.home ?? "?"} vs ${l.away ?? "?"}`,
          pick: l.pickLabel || l.pickCode || null,
          odds: l.odds != null ? Number(l.odds) : null,
          kickoff: l.kickoff
            ? new Date(l.kickoff).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })
            : null,
        })),
      };
    });

    return NextResponse.json(
      {
        ok: true,
        day,
        disclaimer:
          "These are model-filtered SportyBet codes, not guarantees. Gamble responsibly.",
        count: codes.length,
        codes,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
