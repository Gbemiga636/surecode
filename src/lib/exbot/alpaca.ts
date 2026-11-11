/**
 * Alpaca Trading + Market Data REST client (no SDK). Paper and live accounts
 * use the same API with different hosts and keys. Option chains come from
 * the free "indicative" feed unless the account has an OPRA subscription.
 */
const TRADE_HOST = { paper: "https://paper-api.alpaca.markets", live: "https://api.alpaca.markets" } as const;
const DATA_HOST = "https://data.alpaca.markets";

export type AlpacaAccount = {
  status: string;
  equity: string;
  cash: string;
  options_buying_power?: string;
  options_trading_level?: number;
  options_approved_level?: number;
  trading_blocked: boolean;
  account_blocked: boolean;
  currency: string;
};

export type Clock = { timestamp: string; is_open: boolean; next_open: string; next_close: string };
export type DayBar = { t: string; o: number; h: number; l: number; c: number };
export type Quote = { bp: number; ap: number };
export type OptionSnap = { symbol: string; type: "put" | "call"; strike: number; expiry: string; bid: number; ask: number; delta: number | null; iv: number | null };
export type Leg = { symbol: string; side: "buy" | "sell"; position_intent: "buy_to_open" | "sell_to_open" | "buy_to_close" | "sell_to_close"; ratio_qty: "1" };
export type Order = {
  id: string;
  status: string;
  filled_qty: string;
  filled_avg_price: string | null;
  limit_price: string | null;
  legs?: { symbol: string; filled_avg_price: string | null; side: string; status: string }[] | null;
};

export class AlpacaError extends Error {
  constructor(readonly status: number, message: string) {
    super(`Alpaca ${status}: ${message}`);
  }
}

/** OCC option symbol, e.g. SPY261120P00740000 → strike 740, put, 2026-11-20. */
export function parseOcc(sym: string): { root: string; expiry: string; type: "put" | "call"; strike: number } | null {
  const m = sym.match(/^([A-Z.]+?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  return { root: m[1], expiry: `20${m[2]}-${m[3]}-${m[4]}`, type: m[5] === "P" ? "put" : "call", strike: Number(m[6]) / 1000 };
}

export class Alpaca {
  private readonly trade: string;

  constructor(private readonly key: string, private readonly secret: string, readonly live: boolean) {
    this.trade = live ? TRADE_HOST.live : TRADE_HOST.paper;
  }

  private async req<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const r = await fetch(url, {
      method: init?.method || "GET",
      headers: { "APCA-API-KEY-ID": this.key, "APCA-API-SECRET-KEY": this.secret, "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = text.slice(0, 300);
      try {
        msg = (JSON.parse(text) as { message?: string }).message || msg;
      } catch {
        /* not JSON */
      }
      throw new AlpacaError(r.status, msg);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  account() {
    return this.req<AlpacaAccount>(`${this.trade}/v2/account`);
  }

  clock() {
    return this.req<Clock>(`${this.trade}/v2/clock`);
  }

  /** Trading days (YYYY-MM-DD) from `start` to `end` inclusive. */
  async calendar(start: string, end: string): Promise<string[]> {
    const rows = await this.req<{ date: string }[]>(`${this.trade}/v2/calendar?start=${start}&end=${end}`);
    return rows.map((r) => r.date);
  }

  async dailyBars(symbol: string, start: string): Promise<DayBar[]> {
    const out: DayBar[] = [];
    let token = "";
    for (let i = 0; i < 5; i++) {
      const q = `timeframe=1Day&start=${start}&adjustment=raw&feed=iex&limit=1000${token ? `&page_token=${token}` : ""}`;
      const r = await this.req<{ bars: DayBar[] | null; next_page_token: string | null }>(`${DATA_HOST}/v2/stocks/${symbol}/bars?${q}`);
      out.push(...(r.bars || []));
      if (!r.next_page_token) break;
      token = r.next_page_token;
    }
    return out;
  }

  async lastPrice(symbol: string): Promise<number> {
    const r = await this.req<{ trade: { p: number } }>(`${DATA_HOST}/v2/stocks/${symbol}/trades/latest?feed=iex`);
    return r.trade.p;
  }

  /** Puts and calls for one expiry with strikes inside [lo, hi]: quotes and (when given) delta. */
  async chain(underlying: string, expiry: string, lo: number, hi: number): Promise<OptionSnap[]> {
    const out: OptionSnap[] = [];
    let token = "";
    for (let i = 0; i < 10; i++) {
      const q = `expiration_date=${expiry}&strike_price_gte=${lo.toFixed(2)}&strike_price_lte=${hi.toFixed(2)}&limit=1000${token ? `&page_token=${token}` : ""}`;
      const r = await this.req<{
        snapshots: Record<string, { latestQuote?: Quote; greeks?: { delta?: number }; impliedVolatility?: number }>;
        next_page_token: string | null;
      }>(`${DATA_HOST}/v1beta1/options/snapshots/${underlying}?${q}`);
      for (const [symbol, s] of Object.entries(r.snapshots || {})) {
        const occ = parseOcc(symbol);
        if (!occ) continue;
        out.push({
          symbol, type: occ.type, strike: occ.strike, expiry: occ.expiry,
          bid: s.latestQuote?.bp ?? 0, ask: s.latestQuote?.ap ?? 0,
          delta: s.greeks?.delta ?? null, iv: s.impliedVolatility ?? null,
        });
      }
      if (!r.next_page_token) break;
      token = r.next_page_token;
    }
    return out;
  }

  async headlines(symbols: string, sinceIso: string): Promise<{ headline: string; created_at: string }[]> {
    const r = await this.req<{ news: { headline: string; created_at: string }[] }>(
      `${DATA_HOST}/v1beta1/news?symbols=${symbols}&start=${encodeURIComponent(sinceIso)}&limit=50&sort=desc`,
    );
    return r.news || [];
  }

  /** Multi-leg limit order. Alpaca quotes credits as negative prices, debits positive. */
  mleg(legs: Leg[], qty: number, netPrice: number, clientId: string) {
    return this.req<Order>(`${this.trade}/v2/orders`, {
      method: "POST",
      body: { order_class: "mleg", type: "limit", time_in_force: "day", qty: String(qty), limit_price: netPrice.toFixed(2), legs, client_order_id: clientId },
    });
  }

  order(id: string) {
    return this.req<Order>(`${this.trade}/v2/orders/${id}?nested=true`);
  }

  async cancel(id: string): Promise<void> {
    try {
      await this.req(`${this.trade}/v2/orders/${id}`, { method: "DELETE" });
    } catch (e) {
      if (!(e instanceof AlpacaError) || (e.status !== 404 && e.status !== 422)) throw e;
    }
  }

  positions() {
    return this.req<{ symbol: string; qty: string; side: string }[]>(`${this.trade}/v2/positions`);
  }
}
