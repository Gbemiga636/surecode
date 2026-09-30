import type { SupabaseClient } from "@supabase/supabase-js";
import { T } from "./db";
import { makeDeadline } from "./budget";
import { settleLegs, summarize, type LikedLeg } from "./liked";

export const DEMO_START = 100_000;

function lagosDay(at: Date | string = new Date()): string {
  return new Date(at).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

export async function ensureDemoWallet(supabase: SupabaseClient, userId: string) {
  const day = lagosDay();
  const { data: existing } = await supabase
    .from(T.demoWallets)
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!existing) {
    const { data, error } = await supabase
      .from(T.demoWallets)
      .insert({
        user_id: userId,
        balance: DEMO_START,
        staked: 0,
        returned: 0,
        reset_day: day,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  if (existing.reset_day !== day) {
    const { data, error } = await supabase
      .from(T.demoWallets)
      .update({
        balance: DEMO_START,
        staked: 0,
        returned: 0,
        reset_day: day,
      })
      .eq("user_id", userId)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  return existing;
}

type DemoBet = {
  id: string;
  potential: number | null;
  legs: unknown;
  created_at: string;
};

function toLegs(raw: unknown): LikedLeg[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l) => l as Record<string, unknown>)
    .filter((l) => l && typeof l.home === "string")
    .map((l) => ({
      eventId: l.eventId != null ? String(l.eventId) : undefined,
      home: String(l.home),
      away: String(l.away ?? ""),
      pickCode: l.pickCode != null ? String(l.pickCode) : undefined,
      pickLabel: String(l.pickLabel ?? l.pickCode ?? "Pick"),
      odds: Number(l.odds) || 0,
      kickoff: Number(l.kickoff) || undefined,
      sport: l.sport != null ? String(l.sport) : undefined,
    }));
}

/**
 * Settle finished demo bets from final scores. Winnings are only credited to today's wallet
 * for bets placed today, because the wallet resets every Lagos day.
 */
export async function settleDemoBets(sb: SupabaseClient, userId: string, budgetMs = 7_000) {
  const deadline = makeDeadline(budgetMs);
  const { data: pending } = await sb
    .from(T.demoBets)
    .select("id, potential, legs, created_at")
    .eq("user_id", userId)
    .eq("outcome", "PENDING")
    .order("created_at", { ascending: true })
    .limit(8);

  let credit = 0;
  const today = lagosDay();
  for (const bet of (pending ?? []) as DemoBet[]) {
    if (!deadline.ok(3_000)) break;
    const legs = toLegs(bet.legs);
    if (!legs.length) continue;
    const results = await settleLegs(sb, legs, [], deadline);
    const { outcome } = summarize(legs, results);
    if (outcome === "PENDING") continue;

    const { data: updated } = await sb
      .from(T.demoBets)
      .update({ outcome })
      .eq("id", bet.id)
      .eq("outcome", "PENDING")
      .select("id");
    if (outcome === "WON" && updated?.length && lagosDay(bet.created_at) === today) {
      credit += Number(bet.potential ?? 0);
    }
  }

  if (credit > 0) {
    const { data: w } = await sb
      .from(T.demoWallets)
      .select("balance, returned, reset_day")
      .eq("user_id", userId)
      .maybeSingle();
    if (w && w.reset_day === today) {
      await sb
        .from(T.demoWallets)
        .update({
          balance: Math.round((Number(w.balance) + credit) * 100) / 100,
          returned: Math.round((Number(w.returned) + credit) * 100) / 100,
        })
        .eq("user_id", userId);
    }
  }
}
