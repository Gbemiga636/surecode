import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { T } from "@/lib/db";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }
  let body: { gameType?: string; minConfidence?: number; maxOdds?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
  }

  const { error } = await supabase.from(T.preferences).upsert({
    user_id: user.id,
    game_type: String(body.gameType ?? "result").slice(0, 20),
    min_confidence: Math.min(0.95, Math.max(0, Number(body.minConfidence) || 0.55)),
    max_odds: Math.max(1.01, Number(body.maxOdds) || 5),
  });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
