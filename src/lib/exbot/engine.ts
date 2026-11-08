/**
 * The trading tick, ported from exbot/live.py. pg_cron calls /api/tick every
 * 5 minutes; for each member with a bot switched on (or positions still open):
 *   1. live/testnet: notice stop-outs that happened on the exchange
 *   2. for each coin with a newly closed 4h candle: exit on the EMA cross back
 *      (paper also simulates its stop on every new candle), then look for a new
 *      cross that passes the risk manager and the news guard
 *   3. save positions, trades, risk memory and a status line
 * Each member is locked while processed, so overlapping ticks can't double-trade.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Exchange } from "ccxt";
import { BARS, COSTS, MIN_BARS, RISK, STRATEGY, SYMBOLS, TIMEFRAME_MS, type ExchangeId, type Mode } from "./config";
import { decrypt } from "./crypto";
import { logEvent, type Level } from "./events";
import { closedCandles, LiveBroker, loadMarkets, makeExchange, short } from "./exchange";
import { NewsGuard } from "./news";
import { fill, isClosed, rMultiple, riskUsd, simulateStop, type Position } from "./position";
import { RiskManager, type RiskState } from "./risk";
import { emaTrend, type Bar } from "./strategy";

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
const SIDE = { 1: "LONG", [-1]: "SHORT" } as const;
const STALE_MS = 30 * 60_000;
const fmt = (x: number, d = 2) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const px = (x: number) => Number(x.toPrecision(6)).toString();

/** Shared within one tick: public candles per exchange/environment/coin, and the news feeds. */
export class TickContext {
  private candles = new Map<string, Promise<Bar[]>>();
  private publics = new Map<string, Exchange>();
  news = new NewsGuard();

  candlesFor(id: ExchangeId, mode: Mode, symbol: string): Promise<Bar[]> {
    const env: Mode = mode === "testnet" ? "testnet" : "paper";
    const key = `${id}:${env}:${symbol}`;
    let p = this.candles.get(key);
    if (!p) {
      p = (async () => {
        let ex = this.publics.get(`${id}:${env}`);
        if (!ex) {
          ex = makeExchange(id, env);
          this.publics.set(`${id}:${env}`, ex);
        }
        await loadMarkets(ex, id, env);
        return closedCandles(ex, symbol, BARS);
      })();
      this.candles.set(key, p);
    }
    return p;
  }

  async lastPrice(id: ExchangeId, mode: Mode, symbol: string): Promise<number> {
    const bars = await this.candlesFor(id, mode, symbol);
    const ex = this.publics.get(`${id}:${mode === "testnet" ? "testnet" : "paper"}`)!;
    try {
      const t = await ex.fetchTicker(symbol);
      if (t.last && t.last > 0) return t.last;
    } catch {
      /* fall back to the last close */
    }
    return bars[bars.length - 1].c;
  }
}

/** One member's account for the duration of a tick or a dashboard action. */
export class Session {
  positions = new Map<string, Position>();
  risk!: RiskManager;
  broker: LiveBroker | null = null;
  equity = 0;
  lastBar: Record<string, number> = {};
  paperCash = 0;
  private stateLoaded = false;

  private constructor(readonly sb: SupabaseClient, readonly a: Account, readonly now: Date) {}

  /** Locks the member (null if another tick holds the lock) and loads positions and state. */
  static async open(sb: SupabaseClient, userId: string, now = new Date()): Promise<Session | null> {
    const until = new Date(now.getTime() + 55_000).toISOString();
    const { data, error } = await sb
      .from("exbot_accounts")
      .update({ lock_until: until })
      .eq("user_id", userId)
      .or(`lock_until.is.null,lock_until.lt."${now.toISOString()}"`)
      .select(ACCOUNT_COLS);
    if (error) throw new Error(`lock: ${error.message}`);
    if (!data?.length) return null;
    const s = new Session(sb, data[0] as unknown as Account, now);
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
      sb.from("exbot_state").select("risk,last_bar,paper_cash").eq("user_id", a.user_id).eq("mode", a.mode).maybeSingle(),
      sb.from("exbot_positions").select("symbol,data,trade_id").eq("user_id", a.user_id).eq("mode", a.mode),
    ]);
    if (e1 || e2) throw new Error(`load: ${(e1 || e2)!.message}`);
    for (const r of rows || []) this.positions.set(r.symbol, { ...(r.data as Position), tradeId: r.trade_id ?? undefined });
    this.lastBar = (st?.last_bar as Record<string, number>) || {};
    this.paperCash = st?.paper_cash != null ? Number(st.paper_cash) : Number(a.paper_start);
    if (a.mode !== "paper" && a.key_enc && a.secret_enc) {
      const ex = makeExchange(a.exchange, a.mode, { apiKey: decrypt(a.key_enc), secret: decrypt(a.secret_enc) });
      await loadMarkets(ex, a.exchange, a.mode);
      this.broker = new LiveBroker(ex, a.exchange, a.mode);
    }
    this.equity = this.broker ? await this.broker.equity() : this.paperCash;
    this.risk = new RiskManager(RISK, this.equity, st?.risk as Partial<RiskState> | null);
    this.risk.update(this.now, this.equity);
    this.stateLoaded = true;
  }

  log(level: Level, message: string) {
    return logEvent(this.sb, this.a.user_id, level, message, this.a.email.split("@")[0]);
  }

  /** Why new entries are not allowed right now, or null. Open positions are always managed. */
  entryBlock(): string | null {
    const a = this.a;
    if (!a.enabled) return "bot is paused";
    if (a.mode !== "paper" && !this.broker) return "no exchange key connected";
    if (a.mode !== "paper" && a.key_check !== "ok") return "exchange connection not verified (press Test connection)";
    if (a.mode === "live" && !a.live_confirmed_at) return "real-money trading not confirmed";
    return null;
  }

  private async savePosition(p: Position): Promise<void> {
    const { error } = await this.sb.from("exbot_positions").upsert({
      user_id: this.a.user_id, mode: this.a.mode, symbol: p.symbol, data: p, trade_id: p.tradeId ?? null, updated_at: new Date().toISOString(),
    });
    if (error) await this.log("error", `${p.symbol}: could not save the open position (${error.message}) — check the exchange`);
  }

  async finish(p: Position): Promise<void> {
    const reason = p.exits.length ? p.exits[p.exits.length - 1][3] : "closed";
    const r = rMultiple(p);
    if (p.tradeId) {
      await this.sb.from("exbot_trades").update({
        exit_time: this.now.toISOString(), pnl: p.realized, fees: p.fees, r_mult: r, reason_out: reason, exits: p.exits, status: "closed",
      }).eq("id", p.tradeId);
    }
    await this.sb.from("exbot_positions").delete().eq("user_id", this.a.user_id).eq("mode", this.a.mode).eq("symbol", p.symbol);
    this.risk.onClose(this.now, p.symbol, p.realized, r);
    if (!this.broker) this.paperCash += p.realized;
    this.positions.delete(p.symbol);
    await this.log("trade", `${p.symbol} ${SIDE[p.side]} closed (${reason}): ${p.realized >= 0 ? "+" : ""}${fmt(p.realized)} USDT, ${r >= 0 ? "+" : ""}${r.toFixed(2)}R`);
  }

  /** The full tick for this member. */
  async step(ctx: TickContext): Promise<string> {
    const { a, now } = this;
    if (this.broker) {
      for (const p of [...this.positions.values()]) {
        try {
          if (await this.broker.sync(p, now)) await this.finish(p);
        } catch (e) {
          await this.log("error", `${p.symbol}: position check failed: ${short(e)}`);
        }
      }
    }
    const block = this.entryBlock();
    for (const symbol of SYMBOLS) {
      try {
        await this.stepSymbol(ctx, symbol, block);
      } catch (e) {
        await this.log("error", `${symbol}: ${short(e)}`);
      }
    }
    const open = this.positions.size;
    return block
      ? `${block} · ${fmt(this.equity)} USDT · ${open} open`
      : `running · ${fmt(this.equity)} USDT · ${open} open${ctx.news.errors.length ? " · news feed unavailable" : ""}`;
  }

  private async stepSymbol(ctx: TickContext, symbol: string, block: string | null): Promise<void> {
    const { a, now } = this;
    let p = this.positions.get(symbol);
    if (!p && block) return;
    const bars = await ctx.candlesFor(a.exchange, a.mode, symbol);
    if (bars.length < MIN_BARS) return;
    const last = bars.length - 1;
    const prevT = this.lastBar[symbol];
    if (prevT === bars[last].t) return;
    this.lastBar[symbol] = bars[last].t;
    const sig = emaTrend(bars, STRATEGY.fast, STRATEGY.slow, STRATEGY.kAtr);

    if (p) {
      const exitAt = (i: number) => (p!.side === 1 ? sig.exitLong[i] : sig.exitShort[i]);
      if (this.broker) {
        p.barsHeld += 1;
        if (exitAt(last)) await this.broker.close(p, bars[last].c, "strategy exit", now);
      } else {
        const entryT = Date.parse(p.entryTime);
        let from = bars.findIndex((b) => (prevT === undefined ? b.t + TIMEFRAME_MS > entryT : b.t > prevT));
        if (from < 0) from = last;
        for (let i = from; i <= last && !isClosed(p); i++) {
          const b = bars[i];
          const ts = new Date(b.t + TIMEFRAME_MS).toISOString();
          if (simulateStop(p, b.o, b.h, b.l, ts)) break;
          p.barsHeld += 1;
          if (exitAt(i)) fill(p, b.c * (1 - p.side * COSTS.slippage), p.qtyOpen, COSTS.takerFee, ts, "strategy exit");
        }
      }
      if (isClosed(p)) {
        await this.finish(p);
        p = undefined;
      } else {
        await this.savePosition(p);
      }
    }

    const side = sig.side[last] as -1 | 0 | 1;
    if (p || side === 0 || block) return;
    const stop = sig.stop[last], ref = bars[last].c;
    let [ok, why] = this.risk.canOpen(now, symbol, this.positions.size);
    if (ok && now.getTime() - (bars[last].t + TIMEFRAME_MS) > STALE_MS) [ok, why] = [false, "signal is more than 30 minutes old (ticks were missed)"];
    if (ok) {
      const n = ctx.news.blocked(symbol, now);
      if (n) [ok, why] = [false, n];
    }
    if (!ok) {
      await this.log("warn", `${symbol}: ${SIDE[side]} setup skipped — ${why}`);
      return;
    }
    const qty = this.risk.size(this.equity, ref, stop);
    const pos: Position = {
      symbol, side, entry: ref, stop, stop0: stop, qty, qtyOpen: qty, entryTime: now.toISOString(),
      barsHeld: 0, realized: 0, fees: 0, exits: [], orderIds: {},
    };
    if (this.broker) {
      const notPlaced = await this.broker.open(pos, ref);
      if (notPlaced) {
        await this.log("warn", `${symbol}: ${SIDE[side]} setup skipped — ${notPlaced}`);
        return;
      }
    } else {
      pos.entry = ref * (1 + side * COSTS.slippage);
      const fee = pos.entry * qty * COSTS.takerFee;
      pos.realized -= fee;
      pos.fees += fee;
    }
    const reason = `EMA ${STRATEGY.fast}/${STRATEGY.slow} ${side === 1 ? "up" : "down"}-trend cross on the 4h close; stop ${px(stop)} (${STRATEGY.kAtr} ATR)`;
    const { data: t, error } = await this.sb.from("exbot_trades").insert({
      user_id: a.user_id, mode: a.mode, exchange: a.exchange, symbol, side, qty: pos.qty, entry: pos.entry, stop0: stop,
      entry_time: pos.entryTime, reason_in: reason,
    }).select("id").single();
    if (error) await this.log("error", `${symbol}: trade journal insert failed (${error.message})`);
    pos.tradeId = t?.id;
    this.positions.set(symbol, pos);
    await this.savePosition(pos);
    await this.log("trade", `${symbol} ${SIDE[side]} ${px(pos.qty)} @ ${px(pos.entry)} — ${reason}; risk ${fmt(riskUsd(pos))} USDT`);
  }

  /** Market-close every open position (dashboard "close all"). */
  async closeAll(ctx: TickContext, why: string): Promise<number> {
    let n = 0;
    for (const p of [...this.positions.values()]) {
      try {
        const price = await ctx.lastPrice(this.a.exchange, this.a.mode, p.symbol);
        if (this.broker) await this.broker.close(p, price, why, this.now);
        else fill(p, price * (1 - p.side * COSTS.slippage), p.qtyOpen, COSTS.takerFee, this.now.toISOString(), why);
        await this.finish(p);
        n += 1;
      } catch (e) {
        await this.log("error", `${p.symbol}: close failed: ${short(e)}`);
      }
    }
    return n;
  }

  /** Saves risk memory, paper balance and status, then releases the lock. */
  async save(status?: string): Promise<void> {
    if (this.stateLoaded) {
      await this.sb.from("exbot_state").upsert({
        user_id: this.a.user_id, mode: this.a.mode, risk: this.risk.s, last_bar: this.lastBar,
        paper_cash: this.paperCash, updated_at: new Date().toISOString(),
      });
    }
    await this.release(status);
  }

  async release(status?: string): Promise<void> {
    const patch: Record<string, unknown> = { lock_until: null };
    if (status) Object.assign(patch, { status, status_at: new Date().toISOString() });
    await this.sb.from("exbot_accounts").update(patch).eq("user_id", this.a.user_id);
  }
}

/** One tick for every member (or one member when `onlyUser` is set). */
export async function runTick(sb: SupabaseClient, onlyUser?: string): Promise<Record<string, string>> {
  let q = sb.from("exbot_accounts").select("user_id,email,mode,enabled");
  if (onlyUser) q = q.eq("user_id", onlyUser);
  const [{ data: accounts, error }, { data: held }] = await Promise.all([
    q,
    sb.from("exbot_positions").select("user_id,mode"),
  ]);
  if (error) throw new Error(error.message);
  const hasPositions = new Set((held || []).map((r) => `${r.user_id}:${r.mode}`));
  const todo = (accounts || []).filter((a) => a.enabled || hasPositions.has(`${a.user_id}:${a.mode}`));
  const ctx = new TickContext();
  if (todo.some((a) => a.enabled)) await ctx.news.refresh();
  const out: Record<string, string> = {};
  await Promise.all(
    todo.map(async (row) => {
      const who = String(row.email).split("@")[0];
      let s: Session | null = null;
      try {
        s = await Session.open(sb, row.user_id);
        if (!s) {
          out[who] = "busy (previous tick still running)";
          return;
        }
        const status = await s.step(ctx);
        await s.save(status);
        out[who] = status;
      } catch (e) {
        const msg = short(e);
        out[who] = `error: ${msg}`;
        await logEvent(sb, row.user_id, "error", `tick failed: ${msg}`, who);
        if (s) await s.release(`error: ${msg}`).catch(() => undefined);
        else await sb.from("exbot_accounts").update({ status: `error: ${msg}`, status_at: new Date().toISOString() }).eq("user_id", row.user_id);
      }
    }),
  );
  if (Math.random() < 0.02) {
    await sb.from("exbot_events").delete().lt("at", new Date(Date.now() - 60 * 86_400_000).toISOString());
  }
  return out;
}
