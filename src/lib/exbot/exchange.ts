/**
 * Exchange access through ccxt, ported from exbot/exchange.py.
 *
 * Safety rules for real accounts (same as the Python bot):
 * - keys must NOT be able to withdraw (checked when a member connects; unknown = refuse on mainnet);
 * - every entry gets an exchange-side reduce-only stop at once; if the stop
 *   can't be placed, the position is closed immediately;
 * - isolated margin and a 3x leverage cap per symbol.
 */
import ccxt, { type Exchange } from "ccxt";
import { COSTS, RISK, TIMEFRAME, TIMEFRAME_MS, type ExchangeId, type Mode } from "./config";
import { fill, type Position } from "./position";
import type { Bar } from "./strategy";

type Creds = { apiKey: string; secret: string };
type Loose = Record<string, (...args: unknown[]) => Promise<Record<string, unknown>>>;

const marketCache = new Map<string, Exchange["markets"]>();

/** testnet mode uses the exchange's test environment for prices and orders; paper and live use mainnet prices. */
export function makeExchange(id: ExchangeId, mode: Mode, creds?: Creds): Exchange {
  const Cls = id === "bybit" ? ccxt.bybit : ccxt.binance;
  const ex = new Cls({
    ...(creds || {}),
    enableRateLimit: true,
    timeout: 20_000,
    options: { defaultType: "swap", fetchMarkets: { types: ["linear"] } },
  });
  if (mode === "testnet") ex.setSandboxMode(true);
  return ex;
}

export async function loadMarkets(ex: Exchange, id: ExchangeId, mode: Mode): Promise<void> {
  const key = `${id}:${mode === "testnet" ? "test" : "main"}`;
  const cached = marketCache.get(key);
  if (cached) ex.markets = cached;
  await ex.loadMarkets();
  if (!cached) marketCache.set(key, ex.markets);
}

/** Closed 4h candles, oldest first. The still-forming candle is dropped. */
export async function closedCandles(ex: Exchange, symbol: string, limit: number, now = Date.now()): Promise<Bar[]> {
  const rows = await ex.fetchOHLCV(symbol, TIMEFRAME, undefined, limit);
  const bars = rows
    .filter((r) => r.length >= 5 && r.slice(0, 5).every((x) => typeof x === "number" && Number.isFinite(x)))
    .map((r) => ({ t: r[0] as number, o: r[1] as number, h: r[2] as number, l: r[3] as number, c: r[4] as number }));
  while (bars.length && bars[bars.length - 1].t + TIMEFRAME_MS > now) bars.pop();
  return bars;
}

const num = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN);

export class LiveBroker {
  constructor(readonly ex: Exchange, readonly id: ExchangeId, readonly mode: Mode) {}

  /** true / false, or null when the exchange doesn't say (testnets often don't). */
  async withdrawalsEnabled(): Promise<boolean | null> {
    const api = this.ex as unknown as Loose;
    try {
      if (this.id === "binance") {
        const r = await api.sapiGetAccountApiRestrictions();
        return Boolean(r.enableWithdrawals);
      }
      const r = await api.privateGetV5UserQueryApi();
      const perms = ((r.result as Record<string, unknown>)?.permissions || {}) as Record<string, unknown>;
      const wallet = (perms.Wallet as unknown[]) || [];
      return wallet.some((x) => String(x).toLowerCase().includes("withdraw"));
    } catch {
      return null;
    }
  }

  async equity(): Promise<number> {
    const bal = await this.ex.fetchBalance();
    const total = (bal.total || {}) as unknown as Record<string, number | undefined>;
    return num(total.USDT ?? 0) || 0;
  }

  /** Problems that must stop this key from trading, empty when it is fine. */
  async check(): Promise<{ problems: string[]; equity: number | null }> {
    const problems: string[] = [];
    let equity: number | null = null;
    try {
      equity = await this.equity();
    } catch (e) {
      problems.push(`could not read the futures balance: ${short(e)}`);
      return { problems, equity };
    }
    const w = await this.withdrawalsEnabled();
    if (w) problems.push("this API key can withdraw funds — create a trade-only key with withdrawals switched off");
    else if (w === null && this.mode === "live") problems.push("could not confirm that withdrawals are disabled on this key — create a trade-only key");
    return { problems, equity };
  }

  async prepare(symbol: string): Promise<void> {
    try {
      await this.ex.setMarginMode("isolated", symbol);
    } catch {
      /* already isolated, or not supported on this account type */
    }
    try {
      await this.ex.setLeverage(RISK.maxLeverage, symbol);
    } catch {
      /* already set */
    }
  }

  private closeSide(p: Position) {
    return p.side === 1 ? "sell" : "buy";
  }

  private async placeStop(p: Position, qty: number, price: number): Promise<string> {
    const o = await this.ex.createOrder(p.symbol, "market", this.closeSide(p), Number(this.ex.amountToPrecision(p.symbol, qty)), undefined, {
      stopLossPrice: Number(this.ex.priceToPrecision(p.symbol, price)),
      reduceOnly: true,
    });
    return String(o.id);
  }

  /** Market entry plus exchange stop. Returns a reason string when the order was not placed. */
  async open(p: Position, refPrice: number): Promise<string | null> {
    const s = p.symbol;
    const m = this.ex.market(s);
    const qty = Number(this.ex.amountToPrecision(s, p.qty));
    const minAmt = m.limits?.amount?.min || 0;
    const minCost = m.limits?.cost?.min || 0;
    if (!(qty > 0) || qty < minAmt) return `size ${qty} is below the exchange minimum ${minAmt}`;
    if (minCost && qty * refPrice < minCost) return `order value ${(qty * refPrice).toFixed(2)} USDT is below the exchange minimum ${minCost} USDT (account too small for this coin)`;
    await this.prepare(s);
    let o = await this.ex.createOrder(s, "market", p.side === 1 ? "buy" : "sell", qty);
    if (!o.average) {
      try {
        o = await this.ex.fetchOrder(String(o.id), s);
      } catch {
        /* use the reference price */
      }
    }
    p.entry = num(o.average) || num(o.price) || refPrice;
    p.qty = p.qtyOpen = qty;
    const fee = p.entry * qty * COSTS.takerFee;
    p.realized -= fee;
    p.fees += fee;
    try {
      if ((p.side === 1 && p.entry <= p.stop) || (p.side === -1 && p.entry >= p.stop)) throw new Error("filled beyond the stop");
      p.orderIds.stop = await this.placeStop(p, qty, p.stop);
    } catch (e) {
      await this.ex.createOrder(s, "market", this.closeSide(p), qty, undefined, { reduceOnly: true });
      p.qtyOpen = 0;
      throw new Error(`stop could not be placed (${short(e)}); position closed`);
    }
    return null;
  }

  async positionSize(symbol: string): Promise<number> {
    for (const q of await this.ex.fetchPositions([symbol])) {
      if (q.symbol === symbol) return Math.abs(num(q.contracts) || 0);
    }
    return 0;
  }

  /** Records a stop-out when the exchange shows the position gone. Returns true if it closed. */
  async sync(p: Position, now: Date): Promise<boolean> {
    if ((await this.positionSize(p.symbol)) > 1e-12 || p.qtyOpen <= 0) return false;
    let price = p.stop;
    if (p.orderIds.stop) {
      for (const params of [{}, { trigger: true }, { stop: true }]) {
        try {
          const o = await this.ex.fetchOrder(p.orderIds.stop, p.symbol, params);
          if (num(o.average) > 0) {
            price = num(o.average);
            break;
          }
        } catch {
          continue;
        }
      }
    }
    fill(p, price, p.qtyOpen, COSTS.takerFee, now.toISOString(), "stop");
    await this.cancelAll(p.symbol);
    return true;
  }

  async cancelAll(symbol: string): Promise<void> {
    for (const params of [{}, { trigger: true }, { stop: true }]) {
      try {
        await this.ex.cancelAllOrders(symbol, params);
      } catch {
        /* nothing to cancel of that kind */
      }
    }
  }

  async close(p: Position, price: number, reason: string, now: Date): Promise<void> {
    await this.cancelAll(p.symbol);
    const size = await this.positionSize(p.symbol);
    if (size > 0) {
      const o = await this.ex.createOrder(p.symbol, "market", this.closeSide(p), size, undefined, { reduceOnly: true });
      price = num(o.average) || price;
    }
    fill(p, price, p.qtyOpen, COSTS.takerFee, now.toISOString(), reason);
  }
}

export function short(e: unknown): string {
  const s = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
  return s.replace(/[A-Za-z0-9]{32,}/g, "…").slice(0, 300);
}
