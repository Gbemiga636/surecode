import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExchangeId, Mode } from "./config";

export type Account = {
  user_id: string;
  email: string;
  exchange: ExchangeId;
  mode: Mode;
  enabled: boolean;
  key_enc: string | null;
  secret_enc: string | null;
  key_check: string | null;
  live_confirmed_at: string | null;
  paper_start: number;
};

const ACCOUNT_COLS = "user_id,email,exchange,mode,enabled,key_enc,secret_enc,key_check,live_confirmed_at,paper_start";

/** Locks the member for 55 s (null if another tick holds the lock) and returns the account row. */
export async function lockAccount(sb: SupabaseClient, userId: string, now: Date): Promise<Account | null> {
  const until = new Date(now.getTime() + 55_000).toISOString();
  const { data, error } = await sb
    .from("exbot_accounts")
    .update({ lock_until: until })
    .eq("user_id", userId)
    .or(`lock_until.is.null,lock_until.lt."${now.toISOString()}"`)
    .select(ACCOUNT_COLS);
  if (error) throw new Error(`lock: ${error.message}`);
  return data?.length ? (data[0] as unknown as Account) : null;
}

export async function releaseAccount(sb: SupabaseClient, userId: string, status?: string): Promise<void> {
  const patch: Record<string, unknown> = { lock_until: null };
  if (status) Object.assign(patch, { status, status_at: new Date().toISOString() });
  await sb.from("exbot_accounts").update(patch).eq("user_id", userId);
}

export const fmtMoney = (x: number, d = 2) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
