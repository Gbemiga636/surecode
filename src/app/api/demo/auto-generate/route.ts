import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureDemoWallet } from "@/lib/demo";
import { T } from "@/lib/db";
import { getExpertPicks, getValuePicks } from "@/lib/picks";
import { PICKS } from "@/lib/sporty";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const wallet = await ensureDemoWallet(supabase, user.id);
  const [safe, value] = await Promise.all([
    getExpertPicks({ count: 20, days: 3, gameType: "safe", minConfidence: 0.55 }),
    getValuePicks({ count: 15, days: 4, minOdds: 1.6 }),
  ]);

  const tiers = [
    { label: "2x", picks: safe.picks.slice(0, 2), stake: 500 },
    { label: "5x", picks: safe.picks.slice(2, 5), stake: 800 },
    { label: "10x", picks: value.picks.slice(0, 3), stake: 1000 },
    { label: "20x+", picks: value.picks.slice(3, 7), stake: 1200 },
  ];

  let balance = Number(wallet.balance);
  let staked = Number(wallet.staked);
  const placed: string[] = [];

  for (const tier of tiers) {
    if (tier.picks.length < 2) continue;
    if (balance < tier.stake) continue;
    const totalOdds = tier.picks.reduce((a, p) => a * Number(p.odds), 1);
    const legs = tier.picks.map((p) => {
      const meta = PICKS[p.pickCode];
      return {
        eventId: p.eventId,
        marketId: meta?.marketId ?? "",
        specifier: meta?.specifier ?? "",
        outcomeId: meta?.outcomeId ?? "",
        home: p.home,
        away: p.away,
        pickCode: p.pickCode,
        pickLabel: p.pick,
        odds: Number(p.odds),
        kickoff: Date.parse(p.kickoff) || 0,
      };
    });
    const { error } = await supabase.from(T.demoBets).insert({
      user_id: user.id,
      code: `AUTO-${tier.label}`,
      stake: tier.stake,
      total_odds: Number(totalOdds.toFixed(4)),
      potential: Math.round(tier.stake * totalOdds * 100) / 100,
      legs,
      outcome: "PENDING",
    });
    if (error) continue;
    balance -= tier.stake;
    staked += tier.stake;
    placed.push(tier.label);
  }

  await supabase
    .from(T.demoWallets)
    .update({ balance, staked })
    .eq("user_id", user.id);

  return NextResponse.json({ ok: true, placed });
}
