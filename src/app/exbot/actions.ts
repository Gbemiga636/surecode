"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Alpaca, AlpacaError } from "@/lib/exbot/alpaca";
import { EXCHANGES, MODES, RISK, type ExchangeId, type Mode } from "@/lib/exbot/config";
import { decrypt, encrypt, hint } from "@/lib/exbot/crypto";
import { openSession, runTick, TickContext } from "@/lib/exbot/engine";
import { logEvent } from "@/lib/exbot/events";
import { LiveBroker, loadMarkets, makeExchange, short } from "@/lib/exbot/exchange";
import { serverRegion } from "@/lib/exbot/reach";
import { RiskManager } from "@/lib/exbot/risk";
import { requireViewer } from "@/lib/exbot/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: boolean; message: string } | null;

const done = (ok: boolean, message: string): Result => {
  revalidatePath("/exbot");
  return { ok, message };
};

// ── sign in / out ──
export async function signIn(_: Result, form: FormData): Promise<Result> {
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");
  const sb = await createClient();
  const signup = form.get("intent") === "signup";
  const h = await headers();
  const origin = h.get("origin") || `https://${h.get("host")}`;
  const { error } = signup
    ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${origin}/auth/callback?next=/exbot` } })
    : await sb.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: error.message };
  if (signup) {
    const { data } = await sb.auth.getUser();
    if (!data.user) return { ok: true, message: "Account created. Open the confirmation email, then sign in here." };
  }
  redirect("/exbot");
}

export async function signOut(): Promise<void> {
  const sb = await createClient();
  await sb.auth.signOut();
  redirect("/exbot/login");
}

// ── account ──
async function openPositions(userId: string, mode: string): Promise<number> {
  const { count } = await createAdminClient().from("exbot_positions").select("symbol", { count: "exact", head: true }).eq("user_id", userId).eq("mode", mode);
  return count || 0;
}

async function verifyAlpaca(mode: Mode, apiKey: string, secret: string): Promise<{ check: string; detail: string }> {
  const which = mode === "live" ? "live (real money)" : "paper";
  try {
    const acct = await new Alpaca(apiKey, secret, mode === "live").account();
    const level = Number(acct.options_trading_level ?? acct.options_approved_level ?? 0);
    const problems: string[] = [];
    if (acct.status !== "ACTIVE") problems.push(`Alpaca account status is ${acct.status} (it must be ACTIVE)`);
    if (acct.trading_blocked || acct.account_blocked) problems.push("Alpaca has blocked trading on this account");
    if (level < 3) problems.push(`options level is ${level}; iron condors need level 3 (apply in the Alpaca dashboard under Options trading)`);
    if (problems.length) return { check: problems.join("; "), detail: problems.join("; ") };
    return { check: "ok", detail: `Connected to your Alpaca ${which} account. Equity: $${Number(acct.equity).toFixed(2)}, options level ${level}.` };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const msg = e instanceof AlpacaError && (e.status === 401 || e.status === 403)
      ? `Alpaca rejected the key: make sure it is a ${which} key (paper keys come from the Paper account in the Alpaca dashboard) and that you copied both the key and the secret. (${m})`
      : m;
    return { check: msg, detail: msg };
  }
}

async function verifyKey(exchange: ExchangeId, mode: Mode, apiKey: string, secret: string): Promise<{ check: string; detail: string }> {
  if (exchange === "alpaca") return verifyAlpaca(mode, apiKey, secret);
  try {
    const ex = makeExchange(exchange, mode, { apiKey, secret });
    await loadMarkets(ex, exchange, mode);
    const { problems, equity } = await new LiveBroker(ex, exchange, mode).check();
    if (problems.length) return { check: problems.join("; "), detail: problems.join("; ") };
    return { check: "ok", detail: `Connected. Futures balance: ${(equity ?? 0).toFixed(2)} USDT.` };
  } catch (e) {
    const m = short(e);
    const geo = /\b451\b|CloudFront|block access from your country|restricted location|not available in your region/i.test(m);
    const msg = geo
      ? `${exchange === "bybit" ? "Bybit" : "Binance"} blocked our server's location (region ${serverRegion()}), not you. Tell the admin; meanwhile Practice mode still works. (${m})`
      : /Invalid|API-key|api key|signature|10003|10004|-2014|-2015/i.test(m)
        ? `The exchange rejected the key: check you copied the full key and secret, that it is a ${mode === "testnet" ? "testnet" : "mainnet (real)"} key, and that it has Contract/Futures trading permission. (${m})`
        : m;
    return { check: msg, detail: msg };
  }
}

export async function saveSettings(_: Result, form: FormData): Promise<Result> {
  const v = await requireViewer();
  const sb = createAdminClient();
  const exchange = String(form.get("exchange")) as ExchangeId;
  const mode = String(form.get("mode")) as Mode;
  const apiKey = String(form.get("apiKey") || "").trim();
  const secret = String(form.get("secret") || "").trim();
  if (!EXCHANGES.includes(exchange) || !MODES.includes(mode)) return done(false, "Choose an exchange and a mode.");
  if (exchange === "alpaca" && mode === "paper") return done(false, "For Alpaca, choose Paper trading (your free Alpaca paper account) or Real money.");

  const { data: cur } = await sb.from("exbot_accounts").select("exchange,mode,key_enc,secret_enc").eq("user_id", v.userId).maybeSingle();
  if (cur && (cur.exchange !== exchange || cur.mode !== mode) && (await openPositions(v.userId, cur.mode)) > 0) {
    return done(false, "Close your open positions before changing the exchange or mode.");
  }
  if (mode === "live" && form.get("confirmLive") !== "yes") {
    return done(false, "Tick the box to confirm you want to trade with real money.");
  }

  const keyChanged = Boolean(apiKey && secret);
  const sameEnv = cur && cur.exchange === exchange && cur.mode !== "paper" && (cur.mode === "testnet") === (mode === "testnet");
  const patch: Record<string, unknown> = {
    user_id: v.userId, email: v.email, exchange, mode, updated_at: new Date().toISOString(),
    live_confirmed_at: mode === "live" ? new Date().toISOString() : null,
  };
  let message = "Saved. Paper mode trades live prices with simulated money. Press Start bot.";

  if (mode !== "paper") {
    let key = apiKey, sec = secret;
    if (!keyChanged) {
      if (!sameEnv || !cur?.key_enc || !cur?.secret_enc) {
        return done(false, mode === "testnet" ? "Paste your testnet API key and secret." : "Paste your API key and secret.");
      }
      key = decrypt(cur.key_enc);
      sec = decrypt(cur.secret_enc);
    }
    const r = await verifyKey(exchange, mode, key, sec);
    Object.assign(patch, { key_check: r.check, key_checked_at: new Date().toISOString() });
    if (keyChanged) Object.assign(patch, { key_enc: encrypt(key), secret_enc: encrypt(sec), key_hint: hint(key) });
    if (r.check !== "ok") {
      patch.enabled = false;
      await sb.from("exbot_accounts").upsert(patch);
      return done(false, `Key not accepted: ${r.detail}`);
    }
    message = `${r.detail} Press Start bot when ready.`;
  }
  const { error } = await sb.from("exbot_accounts").upsert(patch);
  if (error) return done(false, error.message);
  await logEvent(sb, v.userId, "info", `settings: ${exchange} ${mode}${keyChanged ? `, new key ${hint(apiKey)}` : ""}`);
  return done(true, message);
}

export async function testConnection(): Promise<Result> {
  const v = await requireViewer();
  const sb = createAdminClient();
  const { data: a } = await sb.from("exbot_accounts").select("exchange,mode,key_enc,secret_enc").eq("user_id", v.userId).maybeSingle();
  if (!a) return done(false, "Save your settings first.");
  if (a.mode === "paper") return done(true, "Paper mode needs no key.");
  if (!a.key_enc || !a.secret_enc) return done(false, "No key saved.");
  const r = await verifyKey(a.exchange, a.mode, decrypt(a.key_enc), decrypt(a.secret_enc));
  await sb.from("exbot_accounts").update({ key_check: r.check, key_checked_at: new Date().toISOString(), ...(r.check === "ok" ? {} : { enabled: false }) }).eq("user_id", v.userId);
  return done(r.check === "ok", r.detail);
}

export async function setEnabled(on: boolean): Promise<Result> {
  const v = await requireViewer();
  const sb = createAdminClient();
  const { data: a } = await sb.from("exbot_accounts").select("exchange,mode,key_check,live_confirmed_at").eq("user_id", v.userId).maybeSingle();
  if (!a) return done(false, "Save your settings first.");
  if (on && a.mode !== "paper" && a.key_check !== "ok") return done(false, "Test the exchange connection first.");
  if (on && a.mode === "live" && !a.live_confirmed_at) return done(false, "Confirm real-money trading in the settings first.");
  await sb.from("exbot_accounts").update({ enabled: on, updated_at: new Date().toISOString() }).eq("user_id", v.userId);
  await logEvent(sb, v.userId, "info", on ? `bot started (${a.mode})` : "bot paused: no new trades; open positions keep their stops and exits");
  if (on) await runTick(sb, v.userId).catch(() => undefined);
  const startMsg = a.exchange === "alpaca"
    ? "Started. The bot checks every 5 minutes and places at most one SPY iron condor per trading day, between 15:35 and 15:56 New York time (20:35–20:56 in Lagos while the US is on daylight time, 21:35–21:56 in winter)."
    : "Started. The bot checks every 5 minutes and trades on 4-hour candle closes.";
  return done(true, on ? startMsg : "Paused. Open positions are still managed.");
}

export async function runNow(): Promise<Result> {
  const v = await requireViewer();
  const r = await runTick(createAdminClient(), v.userId);
  const status = Object.values(r)[0];
  return done(!String(status || "").startsWith("error"), status ? `Checked now: ${status}` : "Nothing to do (bot is paused and no positions are open).");
}

export async function closeAll(): Promise<Result> {
  const v = await requireViewer();
  const sb = createAdminClient();
  await sb.from("exbot_accounts").update({ enabled: false }).eq("user_id", v.userId);
  const s = await openSession(sb, v.userId);
  if (!s) return done(false, "A check is running; try again in a minute.");
  try {
    const n = await s.closeAll(new TickContext(), "closed by you");
    await s.save(`paused · ${n} position(s) closed by you`);
    return done(true, s.a.exchange === "alpaca"
      ? `Sent close orders for ${n} condor(s) and paused the bot; fills show up within a few minutes.`
      : `Closed ${n} position(s) and paused the bot.`);
  } catch (e) {
    await s.release();
    return done(false, short(e));
  }
}

export async function resetPaper(): Promise<Result> {
  const v = await requireViewer();
  const sb = createAdminClient();
  if ((await openPositions(v.userId, "paper")) > 0) return done(false, "Close paper positions first.");
  const { data: a } = await sb.from("exbot_accounts").select("paper_start").eq("user_id", v.userId).maybeSingle();
  const start = Number(a?.paper_start || 10_000);
  await sb.from("exbot_state").upsert({ user_id: v.userId, mode: "paper", risk: new RiskManager(RISK, start).s, last_bar: {}, paper_cash: start });
  return done(true, `Paper balance reset to ${start.toFixed(2)} USDT.`);
}

/** Clears your own drawdown kill switch; the limit then counts from the current balance. */
export async function resetKillSwitch(): Promise<Result> {
  const v = await requireViewer();
  const sb = createAdminClient();
  const s = await openSession(sb, v.userId);
  if (!s) return done(false, "A check is running; try again in a minute.");
  s.risk.resetKillSwitch(s.equity);
  await s.save();
  await logEvent(sb, v.userId, "warn", "kill switch reset by you");
  return done(true, "Kill switch reset; the drawdown limit now counts from the current balance.");
}
