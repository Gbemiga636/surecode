/**
 * Alpaca options bot: the SPY iron condor from exbot/scripts/options_lab.py.
 * Every 5-minute tick, for a member on Alpaca (paper = mode "testnet"):
 *   1. pending entry orders: filled → journal the trade; unfilled → reprice
 *      (up to 3 tries inside the entry window), then give up for the day
 *   2. open condors: on expiry day after 15:40 New York, close any condor with
 *      a short strike within 0.5% of SPY (avoids assignment); after expiry,
 *      settle at SPY's expiry close
 *   3. 15:35-15:56 New York on a trading day: if SPY is above its 200-day
 *      average and no macro event / alarming headline, open one condor that
 *      expires 5 trading days later, sized so all open condors together can
 *      lose at most 8% of equity
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { releaseAccount, fmtMoney as fmt, type Account } from "./account";
import { Alpaca, AlpacaError, type Clock, type Leg, type OptionSnap, type Order } from "./alpaca";
import { OPTIONS, OPTIONS_RISK } from "./config";
import { decrypt } from "./crypto";
import { logEvent, type Level } from "./events";
import type { NewsGuard } from "./news";
import { RiskManager, type RiskState } from "./risk";

type CondorLeg = { symbol: string; type: "put" | "call"; strike: number; side: "sell" | "buy" };

export type Condor = {
  kind: "condor";
  key: string;
  underlying: string;
  openDay: string;
  expiry: string;
  qty: number;
  width: number;
  legs: CondorLeg[];
  status: "pending" | "open" | "closing";
  limit: number;          // credit per share asked on the last entry attempt
  credit: number;         // credit per share received (0 until filled)
  attempts: number;
  orderId?: string;
  closeOrderId?: string;
  closeAttempts: number;
  tradeId?: number;
  spot: number;
};

const OPEN_STATES = new Set(["new", "accepted", "pending_new", "partially_filled", "accepted_for_bidding", "held", "pending_replace"]);
const r2 = (x: number) => Math.round(x * 100) / 100;

// ── pure helpers (unit-tested) ──
export function nyParts(d: Date): { day: string; minutes: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Wing width and contracts for the next condor, from the balance and the risk already open. */
export function sizeCondor(equity: number, spot: number, openRisk: number): { width: number; qty: number } | { skip: string } {
  const budget = equity * OPTIONS.maxTotalRisk - openRisk;
  const per = Math.min(equity * OPTIONS.riskPerCondor, budget);
  const widths = OPTIONS.widths.map((f) => Math.max(1, Math.round(f * spot)));
  for (const w of widths) {
    const qty = Math.floor(per / (w * 100));
    if (qty >= 1) return { width: w, qty };
  }
  // Smaller balances: one condor may use the whole remaining budget (fewer condors overlap).
  for (const w of widths) if (w * 100 <= budget) return { width: w, qty: 1 };
  const w = widths[widths.length - 1];
  if (openRisk > 0) return { skip: "the 8% risk budget is used by open condors" };
  return {
    skip: `balance too small: one SPY condor can lose up to $${fmt(w * 100, 0)}, so the bot needs about $${fmt((w * 100) / OPTIONS.maxTotalRisk, 0)} to keep total risk within ${OPTIONS.maxTotalRisk * 100}%`,
  };
}

const mid = (o: OptionSnap) => (o.bid + o.ask) / 2;

/** Short strikes nearest the target delta, long wings `width` further out. */
export function pickCondor(chain: OptionSnap[], spot: number, width: number, target: number):
  | { legs: CondorLeg[]; width: number; credit: number; natural: number }
  | string {
  const quoted = chain.filter((o) => o.bid > 0 && o.ask > 0 && o.ask >= o.bid);
  const puts = quoted.filter((o) => o.type === "put" && o.strike < spot && o.delta != null);
  const calls = quoted.filter((o) => o.type === "call" && o.strike > spot && o.delta != null);
  if (!puts.length || !calls.length) return "no quoted out-of-the-money options with greeks";
  const sp = puts.reduce((a, b) => (Math.abs(-b.delta! - target) < Math.abs(-a.delta! - target) ? b : a));
  const sc = calls.reduce((a, b) => (Math.abs(b.delta! - target) < Math.abs(a.delta! - target) ? b : a));
  const lpC = quoted.filter((o) => o.type === "put" && o.strike <= sp.strike - width).sort((a, b) => b.strike - a.strike);
  const lcC = quoted.filter((o) => o.type === "call" && o.strike >= sc.strike + width).sort((a, b) => a.strike - b.strike);
  if (!lpC.length || !lcC.length) return "no quoted wing strikes";
  const lp = lpC[0], lc = lcC[0];
  const w = Math.max(sp.strike - lp.strike, lc.strike - sc.strike);
  return {
    legs: [
      { symbol: sp.symbol, type: "put", strike: sp.strike, side: "sell" },
      { symbol: lp.symbol, type: "put", strike: lp.strike, side: "buy" },
      { symbol: sc.symbol, type: "call", strike: sc.strike, side: "sell" },
      { symbol: lc.symbol, type: "call", strike: lc.strike, side: "buy" },
    ],
    width: w,
    credit: mid(sp) - mid(lp) + mid(sc) - mid(lc),
    natural: sp.bid - lp.ask + sc.bid - lc.ask,
  };
}

/** What the condor is worth per share with SPY at `s` at expiry. */
export function condorValueAtExpiry(legs: CondorLeg[], s: number): number {
  return legs.reduce((v, l) => {
    const intrinsic = l.type === "put" ? Math.max(l.strike - s, 0) : Math.max(s - l.strike, 0);
    return v + (l.side === "sell" ? intrinsic : -intrinsic);
  }, 0);
}

/** Simple moving average of the last `n` values. */
export const sma = (xs: number[], n: number) => (xs.length < n ? NaN : xs.slice(-n).reduce((a, b) => a + b, 0) / n);

const label = (c: Condor) => {
  const k = (t: string, s: string) => c.legs.find((l) => l.type === t && l.side === s)!.strike;
  return `${c.underlying} ${c.expiry} ${k("put", "buy")}/${k("put", "sell")}p ${k("call", "sell")}/${k("call", "buy")}c ×${c.qty}`;
};

const legOrders = (c: Condor, open: boolean): Leg[] =>
  c.legs.map((l) => {
    const side = open ? l.side : l.side === "sell" ? "buy" : "sell";
    return { symbol: l.symbol, side, ratio_qty: "1", position_intent: `${side}_to_${open ? "open" : "close"}` as Leg["position_intent"] };
  });

// ── session ──
export class OptionsSession {
  condors = new Map<string, Condor>();
  risk!: RiskManager;
  broker: Alpaca | null = null;
  equity = 0;
  accountNote: string | null = null;
  private lastEntryDay: string | null = null;
  private stateLoaded = false;

  private constructor(readonly sb: SupabaseClient, readonly a: Account, readonly now: Date) {}

  static async fromLocked(sb: SupabaseClient, a: Account, now: Date): Promise<OptionsSession> {
    const s = new OptionsSession(sb, a, now);
    try {
      await s.load();
    } catch (e) {
      await s.release();
      throw e;
    }
    return s;
  }

  private async load(): Promise<void> {
    const { a, sb } = this;
    const [{ data: st, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
      sb.from("exbot_state").select("risk,last_bar").eq("user_id", a.user_id).eq("mode", a.mode).maybeSingle(),
      sb.from("exbot_positions").select("symbol,data,trade_id").eq("user_id", a.user_id).eq("mode", a.mode),
    ]);
    if (e1 || e2) throw new Error(`load: ${(e1 || e2)!.message}`);
    for (const r of rows || []) {
      const c = r.data as Condor;
      if (c?.kind === "condor") this.condors.set(r.symbol, { ...c, tradeId: r.trade_id ?? c.tradeId });
    }
    this.lastEntryDay = ((st?.last_bar as { lastEntryDay?: string }) || {}).lastEntryDay ?? null;
    if (a.key_enc && a.secret_enc && a.mode !== "paper") {
      this.broker = new Alpaca(decrypt(a.key_enc), decrypt(a.secret_enc), a.mode === "live");
      const acct = await this.broker.account();
      this.equity = Number(acct.equity);
      if (acct.trading_blocked || acct.account_blocked) this.accountNote = "Alpaca has blocked trading on this account";
    }
    this.risk = new RiskManager(OPTIONS_RISK, this.equity, st?.risk as Partial<RiskState> | null);
    if (this.equity > 0) this.risk.update(this.now, this.equity);
    this.stateLoaded = true;
  }

  log(level: Level, message: string) {
    return logEvent(this.sb, this.a.user_id, level, message, this.a.email.split("@")[0]);
  }

  entryBlock(): string | null {
    const a = this.a;
    if (!a.enabled) return "bot is paused";
    if (!this.broker) return "no Alpaca key connected";
    if (a.key_check !== "ok") return "Alpaca connection not verified (press Test connection)";
    if (a.mode === "live" && !a.live_confirmed_at) return "real-money trading not confirmed";
    return this.accountNote;
  }

  private async savePosition(c: Condor): Promise<void> {
    const { error } = await this.sb.from("exbot_positions").upsert({
      user_id: this.a.user_id, mode: this.a.mode, symbol: c.key, data: c, trade_id: c.tradeId ?? null, updated_at: new Date().toISOString(),
    });
    if (error) await this.log("error", `${label(c)}: could not save (${error.message}) — check Alpaca`);
  }

  private async drop(c: Condor): Promise<void> {
    await this.sb.from("exbot_positions").delete().eq("user_id", this.a.user_id).eq("mode", this.a.mode).eq("symbol", c.key);
    this.condors.delete(c.key);
  }

  private async finish(c: Condor, valuePerShare: number, reason: string): Promise<void> {
    const pnl = (c.credit - valuePerShare) * 100 * c.qty;
    const maxLoss = (c.width - c.credit) * 100 * c.qty;
    const r = maxLoss > 0 ? pnl / maxLoss : 0;
    if (c.tradeId) {
      await this.sb.from("exbot_trades").update({
        exit_time: this.now.toISOString(), pnl, fees: 0, r_mult: r, reason_out: reason, exits: [[this.now.toISOString(), valuePerShare, c.qty, reason]], status: "closed",
      }).eq("id", c.tradeId);
    }
    await this.drop(c);
    this.risk.onClose(this.now, c.underlying, pnl, r);
    await this.log("trade", `${label(c)} closed (${reason}): ${pnl >= 0 ? "+" : ""}${fmt(pnl)} USD, ${r >= 0 ? "+" : ""}${r.toFixed(2)}R`);
  }

  private async onFilled(c: Condor, o: Order): Promise<void> {
    c.credit = Math.abs(Number(o.filled_avg_price ?? -c.limit));
    c.status = "open";
    const reason = `SPY iron condor, ~${Math.round(OPTIONS.shortDelta * 100)}-delta shorts, $${c.width} wings, expires ${c.expiry}; SPY ${fmt(c.spot)} above its ${OPTIONS.trendSma}-day average`;
    const { data: t, error } = await this.sb.from("exbot_trades").insert({
      user_id: this.a.user_id, mode: this.a.mode, exchange: "alpaca", symbol: label(c), side: -1, qty: c.qty,
      entry: c.credit, stop0: c.width, entry_time: this.now.toISOString(), reason_in: reason,
    }).select("id").single();
    if (error) await this.log("error", `trade journal insert failed (${error.message})`);
    c.tradeId = t?.id;
    await this.savePosition(c);
    await this.log("trade", `${label(c)} opened: credit $${c.credit.toFixed(2)} per share ($${fmt(c.credit * 100 * c.qty)}), max loss $${fmt((c.width - c.credit) * 100 * c.qty)}`);
  }

  /** Current marketable debit to close the condor (pay the ask on shorts, take the bid on longs). */
  private async closeDebit(c: Condor, spot: number): Promise<number> {
    const strikes = c.legs.map((l) => l.strike);
    const chain = await this.broker!.chain(c.underlying, c.expiry, Math.min(...strikes) - 1, Math.max(...strikes) + 1);
    const q = new Map(chain.map((o) => [o.symbol, o]));
    let debit = 0;
    for (const l of c.legs) {
      const o = q.get(l.symbol);
      const intrinsic = condorValueAtExpiry([{ ...l, side: "sell" }], spot);
      debit += l.side === "sell" ? (o?.ask || intrinsic + 0.05) : -(o?.bid || 0);
    }
    return Math.max(0.01, r2(debit));
  }

  private async placeClose(c: Condor, spot: number, why: string): Promise<void> {
    const debit = r2((await this.closeDebit(c, spot)) + 0.05 * c.closeAttempts);
    const o = await this.broker!.mleg(legOrders(c, false), c.qty, Math.min(debit, c.width), `exbot-x-${c.key.replace(/\W/g, "")}-${c.closeAttempts}-${Date.now() % 1e6}`);
    c.status = "closing";
    c.closeOrderId = o.id;
    c.closeAttempts += 1;
    await this.savePosition(c);
    await this.log("info", `${label(c)}: closing (${why}) at up to $${debit.toFixed(2)} per share`);
  }

  private async manage(c: Condor, clock: Clock, ny: { day: string; minutes: number }): Promise<void> {
    const b = this.broker!;
    if (c.status === "pending" && c.orderId) {
      let o = await b.order(c.orderId);
      if (o.status === "filled") return this.onFilled(c, o);
      if (OPEN_STATES.has(o.status)) {
        const inWindow = clock.is_open && ny.day === c.openDay && ny.minutes <= OPTIONS.entryToEt;
        await b.cancel(c.orderId);
        o = await b.order(c.orderId);
        if (o.status === "filled") return this.onFilled(c, o);
        if (inWindow && c.attempts < OPTIONS.maxEntryAttempts) {
          c.limit = r2(c.limit - 0.02);
          const n = await b.mleg(legOrders(c, true), c.qty, -c.limit, `exbot-o-${c.key.replace(/\W/g, "")}-${c.attempts}`);
          c.orderId = n.id;
          c.attempts += 1;
          await this.savePosition(c);
          await this.log("info", `${label(c)}: not filled yet, re-offered at $${c.limit.toFixed(2)} credit`);
          return;
        }
      }
      await this.drop(c);
      await this.log("warn", `${label(c)}: entry not filled (${o.status}); no condor today`);
      return;
    }

    if (c.status === "closing" && c.closeOrderId) {
      let o = await b.order(c.closeOrderId);
      if (o.status === "filled") return this.finish(c, Math.abs(Number(o.filled_avg_price)), "closed before expiry");
      if (OPEN_STATES.has(o.status)) {
        await b.cancel(c.closeOrderId);
        o = await b.order(c.closeOrderId);
        if (o.status === "filled") return this.finish(c, Math.abs(Number(o.filled_avg_price)), "closed before expiry");
      }
      c.status = "open";
      c.closeOrderId = undefined;
      if (clock.is_open && c.closeAttempts < 6) return this.placeClose(c, await b.lastPrice(c.underlying), "retry");
      await this.savePosition(c);
      await this.log("warn", `${label(c)}: close order not filled (${o.status}); it will settle at expiry`);
      return;
    }

    if (ny.day > c.expiry) {
      const bars = await b.dailyBars(c.underlying, c.expiry);
      const bar = bars.find((x) => x.t.slice(0, 10) === c.expiry);
      if (!bar) return;
      const value = Math.min(Math.max(condorValueAtExpiry(c.legs, bar.c), 0), c.width);
      const held = new Set((await b.positions()).map((p) => p.symbol));
      if (c.legs.some((l) => held.has(l.symbol)) || held.has(c.underlying)) {
        await this.log("warn", `${label(c)}: Alpaca still shows option legs or ${c.underlying} shares after expiry (assignment?) — check the Alpaca account`);
      }
      return this.finish(c, value, value > 0 ? `expired at ${fmt(bar.c)} (partly in the money)` : "expired worthless (kept the full credit)");
    }

    if (ny.day === c.expiry && clock.is_open && ny.minutes >= OPTIONS.expiryCloseEt) {
      const spot = await b.lastPrice(c.underlying);
      const near = c.legs.some((l) => l.side === "sell" && (l.type === "put" ? spot <= l.strike * (1 + OPTIONS.nearMoney) : spot >= l.strike * (1 - OPTIONS.nearMoney)));
      if (near) await this.placeClose(c, spot, `expiry day, SPY ${fmt(spot)} near a short strike`);
    }
  }

  private async newsBlock(news: NewsGuard): Promise<string | null> {
    const macro = news.blocked("SPY", this.now);
    if (macro?.startsWith("macro")) return macro;
    try {
      const since = new Date(this.now.getTime() - 60 * 60_000).toISOString();
      for (const h of await this.broker!.headlines("SPY,QQQ,DIA", since)) {
        const low = h.headline.toLowerCase();
        if (OPTIONS.newsWords.some((w) => low.includes(w))) return `headline: ${h.headline}`;
      }
    } catch {
      /* a news outage never blocks */
    }
    return null;
  }

  private async tryEnter(ctx: { news: NewsGuard }, clock: Clock, ny: { day: string; minutes: number }): Promise<string> {
    const b = this.broker!;
    if (!clock.is_open) return "market closed";
    if (ny.minutes < OPTIONS.entryFromEt || ny.minutes > OPTIONS.entryToEt) return "waiting for the 15:35–15:56 New York entry window";
    if (this.lastEntryDay === ny.day) return "today's check is done";
    if ([...this.condors.values()].some((c) => c.status === "pending")) return "entry order working";
    this.lastEntryDay = ny.day;

    const [ok, why] = this.risk.canOpen(this.now, OPTIONS.underlying, this.condors.size);
    const skip = async (msg: string) => {
      await this.log("warn", `no condor today — ${msg}`);
      return `no condor today: ${msg}`;
    };
    if (!ok) return skip(why);
    const news = await this.newsBlock(ctx.news);
    if (news) return skip(news);

    const start = new Date(this.now.getTime() - 420 * 86_400_000).toISOString().slice(0, 10);
    const [bars, spot] = await Promise.all([b.dailyBars(OPTIONS.underlying, start), b.lastPrice(OPTIONS.underlying)]);
    const closes = bars.filter((x) => x.t.slice(0, 10) < ny.day).map((x) => x.c);
    const avg = sma([...closes, spot], OPTIONS.trendSma);
    if (!Number.isFinite(avg)) return skip("not enough SPY history for the 200-day average");
    if (spot <= avg) {
      await this.log("info", `no condor today — SPY ${fmt(spot)} is below its 200-day average ${fmt(avg)} (the tested rule sits out downtrends)`);
      return "SPY below its 200-day average: sitting out";
    }

    const end = new Date(this.now.getTime() + 20 * 86_400_000).toISOString().slice(0, 10);
    const days = await b.calendar(ny.day, end);
    const expiry = days[days.indexOf(ny.day) + OPTIONS.dte];
    if (!expiry) return skip("could not find the expiry date in Alpaca's calendar");

    const openRisk = [...this.condors.values()].reduce((s, c) => s + c.width * 100 * c.qty, 0);
    const size = sizeCondor(this.equity, spot, openRisk);
    if ("skip" in size) return skip(size.skip);
    const chain = await b.chain(OPTIONS.underlying, expiry, spot * 0.85, spot * 1.15);
    const pick = pickCondor(chain, spot, size.width, OPTIONS.shortDelta);
    if (typeof pick === "string") return skip(`option chain: ${pick}`);
    const qty = Math.min(size.qty, Math.floor((this.equity * OPTIONS.maxTotalRisk - openRisk) / (pick.width * 100)));
    if (qty < 1) return skip("the wing Alpaca offers is wider than the risk budget allows");
    const limit = r2(Math.max(pick.credit - 0.01, pick.natural));
    if (limit < 0.05 * pick.width) return skip(`credit $${limit.toFixed(2)} is too small for $${pick.width} wings`);

    const c: Condor = {
      kind: "condor", key: `${OPTIONS.underlying} IC ${ny.day}`, underlying: OPTIONS.underlying, openDay: ny.day, expiry, qty,
      width: pick.width, legs: pick.legs, status: "pending", limit, credit: 0, attempts: 1, closeAttempts: 0, spot,
    };
    try {
      const o = await b.mleg(legOrders(c, true), qty, -limit, `exbot-o-${c.key.replace(/\W/g, "")}-0`);
      c.orderId = o.id;
    } catch (e) {
      const m = e instanceof AlpacaError ? e.message : String(e);
      return skip(/not (authorized|eligible)/i.test(m) ? `Alpaca says this account can't trade option spreads yet (needs options level 3): ${m}` : m);
    }
    this.condors.set(c.key, c);
    await this.savePosition(c);
    await this.log("trade", `${label(c)}: offered at $${limit.toFixed(2)} credit (SPY ${fmt(spot)}, 200-day avg ${fmt(avg)})`);
    return "condor order placed";
  }

  async step(ctx: { news: NewsGuard }): Promise<string> {
    if (!this.broker) return `no Alpaca key connected · ${this.condors.size} open`;
    const clock = await this.broker.clock();
    const ny = nyParts(this.now);
    for (const c of [...this.condors.values()]) {
      try {
        await this.manage(c, clock, ny);
      } catch (e) {
        await this.log("error", `${label(c)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const block = this.entryBlock();
    let note = "";
    if (!block) {
      try {
        note = await this.tryEnter(ctx, clock, ny);
      } catch (e) {
        this.lastEntryDay = null; // retry on the next tick while the window is open
        note = `entry check failed: ${e instanceof Error ? e.message : String(e)}`;
        await this.log("error", note);
      }
    }
    return `${block || note || "running"} · ${fmt(this.equity)} USD · ${this.condors.size} open`;
  }

  /** Cancel working entries and close every open condor at a marketable price. */
  async closeAll(_ctx: unknown, why: string): Promise<number> {
    if (!this.broker) return 0;
    const clock = await this.broker.clock();
    let n = 0;
    for (const c of [...this.condors.values()]) {
      try {
        if (c.status === "pending" && c.orderId) {
          await this.broker.cancel(c.orderId);
          const o = await this.broker.order(c.orderId);
          if (o.status !== "filled") {
            await this.drop(c);
            continue;
          }
          await this.onFilled(c, o);
        }
        if (!clock.is_open) {
          await this.log("warn", `${label(c)}: market closed — close it in Alpaca or press again when the market opens`);
          continue;
        }
        if (c.status === "closing" && c.closeOrderId) await this.broker.cancel(c.closeOrderId);
        await this.placeClose(c, await this.broker.lastPrice(c.underlying), why);
        n += 1;
      } catch (e) {
        await this.log("error", `${label(c)}: close failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return n;
  }

  async save(status?: string): Promise<void> {
    if (this.stateLoaded) {
      await this.sb.from("exbot_state").upsert({
        user_id: this.a.user_id, mode: this.a.mode, risk: this.risk.s, last_bar: { lastEntryDay: this.lastEntryDay }, updated_at: new Date().toISOString(),
      });
    }
    await this.release(status);
  }

  release(status?: string): Promise<void> {
    return releaseAccount(this.sb, this.a.user_id, status);
  }
}
