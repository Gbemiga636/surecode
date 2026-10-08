import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { T } from "@/lib/db";
import { createBookingCode, sportyOpenUrl, type BookableLeg } from "@/lib/sporty";
import { slipToLog } from "@/lib/prediction-log";
import { logPredictionsAfterResponse } from "@/lib/prediction-log-after";

export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Matches starting within this window can no longer be booked reliably. */
const KICKOFF_BUFFER_MS = 2 * 60_000;

type Body = { day?: string; picks?: { eventId?: string; pickCode?: string }[] };

/**
 * Book one SportyBet code from games picked across the day's Sure codes.
 * Legs are rebuilt from the stored Sure codes, so odds and market ids can't
 * be altered by the client.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

    let body: Body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
    }

    const day = String(body.day ?? "");
    if (!DAY_RE.test(day)) return NextResponse.json({ ok: false, error: "Invalid day" }, { status: 400 });
    const wanted = (Array.isArray(body.picks) ? body.picks : [])
      .slice(0, 40)
      .map((p) => `${String(p?.eventId ?? "")}|${String(p?.pickCode ?? "")}`);
    if (!wanted.length) {
      return NextResponse.json({ ok: false, error: "Select at least one game" }, { status: 400 });
    }

    const { data: codes, error } = await supabase.from(T.sureCodes).select("legs").eq("day", day);
    if (error) return NextResponse.json({ ok: false, error: "Could not load Sure codes" }, { status: 500 });

    const board = new Map<string, BookableLeg>();
    for (const row of codes ?? []) {
      for (const leg of (Array.isArray(row.legs) ? row.legs : []) as BookableLeg[]) {
        if (leg?.eventId && leg.pickCode && leg.marketId && leg.outcomeId) {
          board.set(`${leg.eventId}|${leg.pickCode}`, leg);
        }
      }
    }

    const now = Date.now();
    const legs: BookableLeg[] = [];
    const seenEvents = new Set<string>();
    const skipped: { match: string; reason: string }[] = [];
    for (const key of new Set(wanted)) {
      const leg = board.get(key);
      if (!leg) {
        skipped.push({ match: key.split("|")[0], reason: "not on this Sure board" });
        continue;
      }
      const match = `${leg.home} v ${leg.away}`;
      if (seenEvents.has(leg.eventId)) {
        skipped.push({ match, reason: "same match already selected" });
        continue;
      }
      if (leg.kickoff && leg.kickoff - now < KICKOFF_BUFFER_MS) {
        skipped.push({ match, reason: "already started" });
        continue;
      }
      seenEvents.add(leg.eventId);
      legs.push(leg);
    }

    if (!legs.length) {
      return NextResponse.json(
        { ok: false, error: "None of the selected games can still be booked", skipped },
        { status: 422 },
      );
    }

    const booked = await createBookingCode(legs);
    if (!booked.code) {
      return NextResponse.json(
        { ok: false, error: "SportyBet couldn't book these games right now. Try again shortly.", skipped },
        { status: 502 },
      );
    }

    const totalOdds = legs.reduce((a, l) => a * (Number(l.odds) || 1), 1);
    const url = booked.url || sportyOpenUrl(booked.code);

    await supabase.from(T.generatedCodes).insert({
      user_id: user.id,
      code: booked.code,
      share_url: url,
      total_odds: Number(totalOdds.toFixed(4)),
      origin: "sure-combine",
      legs,
    });

    logPredictionsAfterResponse(() => {
      const entry = slipToLog("sure-combine", { code: booked.code, legs, totalOdds }, `sure-combine:${day}`);
      return entry ? [entry] : [];
    });

    return NextResponse.json(
      {
        ok: true,
        code: booked.code,
        url,
        totalOdds,
        games: legs.length,
        bookedGames: booked.games ?? legs.length,
        skipped,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[api/sure/combine]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Something went wrong" }, { status: 500 });
  }
}
