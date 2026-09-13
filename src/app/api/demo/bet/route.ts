import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureDemoWallet } from "@/lib/demo";
import { T } from "@/lib/db";
import { bookPicks, type AppPick } from "@/lib/picks";
import { PICKS, type BookableLeg } from "@/lib/sporty";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let body: {
    sureCodeId?: string;
    codeId?: string;
    picks?: AppPick[];
    stake?: number;
    origin?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
  }

  const stake = Math.round(Number(body.stake) || 0);
  if (stake < 100) {
    return NextResponse.json({ ok: false, error: "Minimum demo stake is ₦100" }, { status: 400 });
  }

  let code: string | null = null;
  let sureCodeId: string | null = null;
  let totalOdds = 1;
  let legs: BookableLeg[] | unknown[] = [];

  if (body.sureCodeId) {
    const { data: sure, error: sureErr } = await supabase
      .from(T.sureCodes)
      .select("*")
      .eq("id", body.sureCodeId)
      .maybeSingle();
    if (sureErr || !sure) {
      return NextResponse.json({ ok: false, error: "Sure code not found" }, { status: 404 });
    }
    code = sure.code;
    sureCodeId = sure.id;
    totalOdds = Number(sure.total_odds) || 1;
    legs = sure.legs as unknown[];
  } else if (body.codeId) {
    const { data: row, error } = await supabase
      .from(T.codes)
      .select("*")
      .eq("id", body.codeId)
      .maybeSingle();
    if (error || !row) {
      return NextResponse.json({ ok: false, error: "Code not found" }, { status: 404 });
    }
    code = row.code;
    totalOdds = Number(row.total_odds) || 1;
    legs = row.legs as unknown[];
  } else if (Array.isArray(body.picks) && body.picks.length) {
    const mapped = body.picks.map((p) => {
      const meta = PICKS[p.pickCode];
      return {
        ...p,
        market: meta?.market,
      };
    });
    totalOdds = mapped.reduce((a, p) => a * Number(p.odds || 1), 1);
    legs = mapped.map((p) => {
      const meta = PICKS[p.pickCode];
      return {
        eventId: p.eventId,
        marketId: meta?.marketId ?? "",
        specifier: meta?.specifier ?? "",
        outcomeId: meta?.outcomeId ?? "",
        home: p.home,
        away: p.away,
        league: p.league,
        kickoff: Date.parse(p.kickoff) || 0,
        pickCode: p.pickCode,
        pickLabel: p.pick,
        odds: Number(p.odds),
        implied: p.confidence,
      } satisfies BookableLeg;
    });
    // Optional: also mint a real code for the demo slip
    const booked = await bookPicks(mapped).catch(() => null);
    if (booked?.code) code = booked.code;
  } else {
    return NextResponse.json({ ok: false, error: "Nothing to stake" }, { status: 400 });
  }

  const wallet = await ensureDemoWallet(supabase, user.id);
  if (Number(wallet.balance) < stake) {
    return NextResponse.json({ ok: false, error: "Insufficient demo balance" }, { status: 400 });
  }

  const potential = Math.round(stake * totalOdds * 100) / 100;

  const { error: betErr } = await supabase.from(T.demoBets).insert({
    user_id: user.id,
    sure_code_id: sureCodeId,
    code,
    stake,
    total_odds: Number(totalOdds.toFixed(4)),
    potential,
    legs,
    outcome: "PENDING",
  });
  if (betErr) {
    return NextResponse.json({ ok: false, error: betErr.message }, { status: 500 });
  }

  const { error: wErr } = await supabase
    .from(T.demoWallets)
    .update({
      balance: Number(wallet.balance) - stake,
      staked: Number(wallet.staked) + stake,
    })
    .eq("user_id", user.id);

  if (wErr) {
    return NextResponse.json({ ok: false, error: wErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, potential, code });
}
