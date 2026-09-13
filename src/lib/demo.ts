import type { SupabaseClient } from "@supabase/supabase-js";
import { T } from "./db";

const START = 100_000;

function lagosDay(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
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
        balance: START,
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
        balance: START,
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
