/**
 * Alpaca stock trail bot (inspired by the trailing-stop + breakout videos).
 * Paper = mode "testnet". Buys a 55-day high breakout above the 200-day average,
 * risks ~1% with a 5% initial stop, then trails 5% once price is +10%.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { releaseAccount, fmtMoney as fmt, type Account } from "./account";
import { Alpaca, AlpacaError } from "./alpaca";
import { STOCK_TRAIL, type RiskParams } from "./config";
import { decrypt } from "./crypto";
import { logEvent, type Level } from "./events";
import { RiskManager, type RiskState } from "./risk";
import { ema } from "./strategy";

type StockPos = {
  kind: "stock";
  symbol: string;
  qty: number;
  entry: number;
  stop: number;
  peak: number;
  entryTime: string;
  tradeId?: number;
};

const STOCK_RISK: RiskParams = {
  riskPerTrade: STOCK_TRAIL.riskPerTrade,
  maxOpenPositions: STOCK_TRAIL.maxOpen,
  maxLeverage: 1,
  dailyLossLimit: 0.03,
  maxDrawdown: 0.2,
  lossStreakHalve: 1e6,
  lossStreakPause: 1e6,
  pauseHours: 24,
  symbolReviewTrades: 1e6,
  symbolMinExpectancyR: -1,
  symbolPauseDays: 0,
};

export class StockSession {
  positions = new Map<string, StockPos>();
  risk!: RiskManager;
  broker: Alpaca | null = null;
  equity = 0;
  private lastScanDay: string | null = null;
  private stateLoaded = false;

  private constructor(readonly sb: SupabaseClient, readonly a: Account, readonly now: Date) {}

  static async fromLocked(sb: SupabaseClient, a: Account, now: Date): Promise<StockSession> {
    const s = new StockSession(sb, a, now);
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
      const p = r.data as StockPos;
      if (p?.kind === "stock") this.positions.set(r.symbol, { ...p, tradeId: r.trade_id ?? p.tradeId });
    }
    this.lastScanDay = ((st?.last_bar as { lastScanDay?: string }) || {}).lastScanDay ?? null;
    if (a.key_enc && a.secret_enc && a.mode !== "paper") {
      this.broker = new Alpaca(decrypt(a.key_enc), decrypt(a.secret_enc), a.mode === "live");
      this.equity = Number((await this.broker.account()).equity);
    }
    this.risk = new RiskManager(STOCK_RISK, this.equity, st?.risk as Partial<RiskState> | null);
    if (this.equity > 0) this.risk.update(this.now, this.equity);
    this.stateLoaded = true;
  }

  log(level: Level, message: string) {
    return logEvent(this.sb, this.a.user_id, level, message, this.a.email.split("@")[0]);
  }

  entryBlock(): string | null {
    if (!this.a.enabled) return "bot is paused";
    if (!this.broker) return "no Alpaca key connected";
    if (this.a.key_check !== "ok") return "Alpaca connection not verified";
    if (this.a.mode === "live" && !this.a.live_confirmed_at) return "real-money trading not confirmed";
    return null;
  }

  private async savePos(p: StockPos): Promise<void> {
    await this.sb.from("exbot_positions").upsert({
      user_id: this.a.user_id, mode: this.a.mode, symbol: p.symbol, data: p, trade_id: p.tradeId ?? null, updated_at: new Date().toISOString(),
    });
  }

  private async finish(p: StockPos, exit: number, reason: string): Promise<void> {
    const pnl = (exit - p.entry) * p.qty;
    const riskUsd = p.entry * STOCK_TRAIL.stopPct * p.qty;
    const r = riskUsd > 0 ? pnl / riskUsd : 0;
    if (p.tradeId) {
      await this.sb.from("exbot_trades").update({
        exit_time: this.now.toISOString(), pnl, fees: 0, r_mult: r, reason_out: reason, status: "closed",
      }).eq("id", p.tradeId);
    }
    await this.sb.from("exbot_positions").delete().eq("user_id", this.a.user_id).eq("mode", this.a.mode).eq("symbol", p.symbol);
    this.positions.delete(p.symbol);
    this.risk.onClose(this.now, p.symbol, pnl, r);
    await this.log("trade", `${p.symbol} closed (${reason}): ${pnl >= 0 ? "+" : ""}${fmt(pnl)} USD`);
  }

  private trailStop(p: StockPos, price: number): number {
    p.peak = Math.max(p.peak, price);
    if (p.peak >= p.entry * (1 + STOCK_TRAIL.trailActivatePct)) {
      return Math.max(p.stop, p.peak * (1 - STOCK_TRAIL.trailPct));
    }
    return p.stop;
  }

  async step(_ctx?: unknown): Promise<string> {
    if (!this.broker) return `no Alpaca key · ${this.positions.size} open`;
    const clock = await this.broker.clock();
    const day = this.now.toISOString().slice(0, 10);

    for (const p of [...this.positions.values()]) {
      try {
        const price = await this.broker.lastPrice(p.symbol);
        p.stop = this.trailStop(p, price);
        if (price <= p.stop) await this.sell(p, "trail/stop hit");
        else await this.savePos(p);
      } catch (e) {
        await this.log("error", `${p.symbol}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const block = this.entryBlock();
    if (block) return `${block} · ${fmt(this.equity)} USD · ${this.positions.size} open`;
    if (!clock.is_open) return `market closed · ${fmt(this.equity)} USD · ${this.positions.size} open`;
    if (this.lastScanDay === day) return `watching · ${fmt(this.equity)} USD · ${this.positions.size} open`;
    this.lastScanDay = day;

    for (const symbol of STOCK_TRAIL.symbols) {
      if (this.positions.has(symbol)) continue;
      const [ok] = this.risk.canOpen(this.now, symbol, this.positions.size);
      if (!ok) break;
      try {
        const start = new Date(this.now.getTime() - 400 * 86_400_000).toISOString().slice(0, 10);
        const bars = await this.broker.dailyBars(symbol, start);
        if (bars.length < 220) continue;
        const closes = bars.map((b) => b.c);
        const highs = bars.map((b) => b.h);
        const last = closes.length - 1;
        let hi = -Infinity;
        for (let i = last - 55; i < last; i++) if (highs[i] > hi) hi = highs[i];
        const trend = ema(closes, 200);
        if (!(closes[last] > hi && closes[last] > trend[last])) continue;
        const entry = closes[last];
        const stop = entry * (1 - STOCK_TRAIL.stopPct);
        const qty = Math.floor((this.equity * STOCK_TRAIL.riskPerTrade) / (entry - stop));
        if (qty < 1) continue;
        await this.buy(symbol, qty, entry, stop);
      } catch (e) {
        if (e instanceof AlpacaError && (e.status === 401 || e.status === 403)) throw e;
        await this.log("warn", `${symbol}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return `running · ${fmt(this.equity)} USD · ${this.positions.size} open`;
  }

  private async buy(symbol: string, qty: number, entry: number, stop: number): Promise<void> {
    const o = await this.broker!.stockOrder(symbol, "buy", qty);
    const fillPx = Number(o.filled_avg_price || entry);
    const p: StockPos = { kind: "stock", symbol, qty, entry: fillPx, stop, peak: fillPx, entryTime: this.now.toISOString() };
    const { data: t } = await this.sb.from("exbot_trades").insert({
      user_id: this.a.user_id, mode: this.a.mode, exchange: "alpaca", symbol, side: 1, qty, entry: fillPx, stop0: stop,
      entry_time: p.entryTime,
      reason_in: `55-day high breakout above 200-day avg; ${(STOCK_TRAIL.stopPct * 100).toFixed(0)}% stop, trail ${(STOCK_TRAIL.trailPct * 100).toFixed(0)}% after +${(STOCK_TRAIL.trailActivatePct * 100).toFixed(0)}%`,
    }).select("id").single();
    p.tradeId = t?.id;
    this.positions.set(symbol, p);
    await this.savePos(p);
    await this.log("trade", `${symbol} BUY ${qty} @ ${fmt(fillPx)}`);
  }

  private async sell(p: StockPos, why: string): Promise<void> {
    const o = await this.broker!.stockOrder(p.symbol, "sell", p.qty);
    await this.finish(p, Number(o.filled_avg_price || p.entry), why);
  }

  async closeAll(_ctx?: unknown, _why = "closed by you"): Promise<number> {
    let n = 0;
    for (const p of [...this.positions.values()]) {
      try {
        await this.sell(p, _why);
        n += 1;
      } catch (e) {
        await this.log("error", `${p.symbol}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return n;
  }

  async save(status?: string): Promise<void> {
    if (this.stateLoaded) {
      await this.sb.from("exbot_state").upsert({
        user_id: this.a.user_id, mode: this.a.mode, risk: this.risk.s, last_bar: { lastScanDay: this.lastScanDay }, updated_at: new Date().toISOString(),
      });
    }
    await this.release(status);
  }

  release(status?: string): Promise<void> {
    return releaseAccount(this.sb, this.a.user_id, status);
  }
}
