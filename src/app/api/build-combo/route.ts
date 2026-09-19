import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildConditionCombos,
  type BuilderCondition,
  type BuilderRequest,
} from "@/lib/build-combo";
import { T } from "@/lib/db";

export const maxDuration = 90;
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

    let body: BuilderRequest;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
    }

    const conditions = (body.conditions || []).filter(Boolean) as BuilderCondition[];
    const result = await buildConditionCombos({
      conditions,
      legs: body.legs,
      maxOdds: body.maxOdds,
      minOdds: body.minOdds,
      slips: body.slips,
    });

    for (const slip of result.slips) {
      if (!slip.code) continue;
      await supabase.from(T.generatedCodes).insert({
        user_id: user.id,
        code: slip.code,
        share_url: slip.shareUrl ?? null,
        total_odds: Number(slip.totalOdds.toFixed(4)),
        origin: `builder:${conditions.join("+")}`,
        legs: slip.legs,
      });
    }

    return NextResponse.json(result, {
      status: result.ok || result.slips.length ? 200 : 422,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api/build-combo]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
