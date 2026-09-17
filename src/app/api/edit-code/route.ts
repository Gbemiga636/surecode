import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { editLongCode } from "@/lib/edit-code";
import { T } from "@/lib/db";

export const maxDuration = 60;
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

    let body: { code?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
    }

    const code = String(body.code || "").trim();
    if (!code) {
      return NextResponse.json({ ok: false, error: "Paste a SportyBet share code" }, { status: 400 });
    }

    const result = await editLongCode(code);

    // Save any successfully booked alts to the user's generated codes
    for (const alt of result.alts) {
      if (!alt.code) continue;
      await supabase.from(T.generatedCodes).insert({
        user_id: user.id,
        code: alt.code,
        share_url: alt.shareUrl ?? null,
        total_odds: Number(alt.totalOdds.toFixed(4)),
        origin: "edit-code",
        legs: alt.legs,
      });
    }

    return NextResponse.json(result, {
      status: result.ok ? 200 : 422,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api/edit-code]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
