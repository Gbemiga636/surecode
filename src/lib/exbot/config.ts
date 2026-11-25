/**
 * exbot (hidden page /exbot). Kept apart from the prediction engine: nothing
 * here imports SureCode modules except the Supabase clients.
 *
 * The tested setup (see exbot/README.md, "Research results"): EMA 50/200 trend
 * on 4h candles, long and short, stop 2.5 ATR, exit on the cross back, one
 * position per coin, 0.35% of equity at risk per trade. Mirrors
 * exbot/config.py so the web bot trades exactly what the Python lab tested.
 */
export type ExchangeId = "bybit" | "binance" | "alpaca";
export type CryptoExchangeId = Exclude<ExchangeId, "alpaca">;
export type Mode = "paper" | "testnet" | "live";

export const EXCHANGES: ExchangeId[] = ["bybit", "binance", "alpaca"];
export const MODES: Mode[] = ["paper", "testnet", "live"];

/** Core liquid set — fewer coins = fewer API calls and fewer rate limits. */
export const SYMBOLS = [
  "BTC/USDT:USDT", "ETH/USDT:USDT", "SOL/USDT:USDT", "BNB/USDT:USDT",
  "XRP/USDT:USDT", "DOGE/USDT:USDT",
] as const;

export const TIMEFRAME = "4h";
export const TIMEFRAME_MS = 4 * 3_600_000;
/** EMA 200 needs ~300 closed 4h bars; keep a small buffer only. */
export const BARS = 340;
export const MIN_BARS = 300;
/** How many coins without an open position to scan for new entries each tick. */
export const ENTRY_SCAN_PER_TICK = 2;

export const STRATEGY = { fast: 50, slow: 200, kAtr: 2.5 } as const;

/** User-selectable strategies (crypto + Alpaca). */
export type StrategyId = "ema_trend" | "breakout_55" | "spy_condor" | "stock_trail";

export const STRATEGIES: {
  id: StrategyId;
  title: string;
  market: "crypto" | "options" | "stocks";
  blurb: string;
  exchange: ExchangeId | "crypto";
}[] = [
  { id: "ema_trend", title: "EMA Trend", market: "crypto", exchange: "crypto", blurb: "4h EMA 50/200 cross — tested crypto default." },
  { id: "breakout_55", title: "55-Bar Breakout", market: "crypto", exchange: "crypto", blurb: "Buy/sell when price breaks the 55-bar high/low above the 200 EMA." },
  { id: "spy_condor", title: "SPY Iron Condor", market: "options", exchange: "alpaca", blurb: "Weekly SPY condor on Alpaca (paper or live)." },
  { id: "stock_trail", title: "Stock Trail", market: "stocks", exchange: "alpaca", blurb: "Alpaca stocks with a trailing stop (video-style)." },
];

export const BREAKOUT = { lookback: 55, trendEma: 200, kAtr: 2.0 } as const;
export const STOCK_TRAIL = {
  symbols: ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "SPY"] as const,
  stopPct: 0.05,
  trailActivatePct: 0.10,
  trailPct: 0.05,
  riskPerTrade: 0.01,
  maxOpen: 5,
} as const;

export type RiskParams = {
  riskPerTrade: number;
  maxOpenPositions: number;
  maxLeverage: number;
  dailyLossLimit: number;
  maxDrawdown: number;
  lossStreakHalve: number;
  lossStreakPause: number;
  pauseHours: number;
  symbolReviewTrades: number;
  symbolMinExpectancyR: number;
  symbolPauseDays: number;
};

// Streak rules are off: 5+ losses in a row are normal at a ~27% win rate, and
// cutting size then shrinks the rare big winners that pay for everything.
export const RISK: RiskParams = {
  riskPerTrade: 0.0035,
  maxOpenPositions: 8,
  maxLeverage: 3,
  dailyLossLimit: 0.03,
  maxDrawdown: 0.2,
  lossStreakHalve: 1e6,
  lossStreakPause: 1e6,
  pauseHours: 24,
  symbolReviewTrades: 20,
  symbolMinExpectancyR: -0.5,
  symbolPauseDays: 3,
};

export const COSTS = { takerFee: 0.00055, makerFee: 0.0002, slippage: 0.0002 } as const;

export const NEWS_BLACKOUT_MIN = 30;

/**
 * Alpaca options bot (exbot/scripts/options_lab.py). Of 1,500 option setups on
 * SPY/QQQ/IWM priced from Cboe vol indices, the only family positive both in
 * 2005-2018 and out of sample in 2019-2026 was a SPY iron condor: ~20-delta
 * short strikes, wings 2% of SPY, 5 trading days to expiry, held to expiry,
 * only while SPY is above its 200-day average. One opens each trading day
 * near the close, so up to five overlap. QQQ/IWM, 1-day expiries, buying
 * calls/puts, narrow wings and taking profit at 50% all lost.
 * Alpaca mode "testnet" is the Alpaca paper account.
 */
export const OPTIONS = {
  underlying: "SPY",
  dte: 5,
  shortDelta: 0.2,
  widths: [0.02, 0.01],          // preferred wing (fraction of SPY), then the fallback for smaller balances
  trendSma: 200,
  entryFromEt: 15 * 60 + 35,     // New York minutes after midnight: open near the close, as tested
  entryToEt: 15 * 60 + 56,
  expiryCloseEt: 15 * 60 + 40,   // on expiry day, close any condor whose short strike is within nearMoney of SPY
  nearMoney: 0.005,
  maxEntryAttempts: 3,
  riskPerCondor: 0.016,          // max loss of one condor as a share of equity
  maxTotalRisk: 0.08,            // all open condors together
  newsWords: ["halt", "circuit breaker", "crash", "plunge", "emergency", "flash"],
} as const;

export const OPTIONS_RISK: RiskParams = {
  riskPerTrade: OPTIONS.riskPerCondor,
  maxOpenPositions: 6,
  maxLeverage: 1,
  dailyLossLimit: 0.05,
  maxDrawdown: 0.25,
  lossStreakHalve: 1e6,
  lossStreakPause: 1e6,
  pauseHours: 24,
  symbolReviewTrades: 1e6,
  symbolMinExpectancyR: -1,
  symbolPauseDays: 0,
};
