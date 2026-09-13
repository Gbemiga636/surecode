import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bookPicks, type AppPick } from "@/lib/picks";
import { T } from "@/lib/db";

export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
    }

    let body: { picks?: AppPick[]; origin?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
    }

    const picks = Array.isArray(body.picks) ? body.picks : [];
    if (!picks.length) {
      return NextResponse.json({ ok: false, error: "Select at least 1 pick" }, { status: 400 });
    }

    const booked = await bookPicks(picks.slice(0, 12));
    if (!booked.code) {
      return NextResponse.json(
        { ok: false, error: booked.error || "Booking failed" },
        { status: 400 },
      );
    }

    await supabase.from(T.generatedCodes).insert({
      user_id: user.id,
      code: booked.code,
      share_url: booked.url ?? null,
      total_odds: Number(booked.totalOdds.toFixed(4)),
      origin: String(body.origin ?? "manual").slice(0, 40),
      legs: booked.legs,
    });

    return NextResponse.json({
      ok: true,
      code: booked.code,
      url: booked.url,
      totalOdds: booked.totalOdds,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api/book]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
