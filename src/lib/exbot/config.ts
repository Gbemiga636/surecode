/**
 * exbot (hidden page /exbot). Kept apart from the prediction engine: nothing
 * here imports SureCode modules except the Supabase clients.
 *
 * The tested setup (see exbot/README.md, "Research results"): EMA 50/200 trend
 * on 4h candles, long and short, stop 2.5 ATR, exit on the cross back, one
 * position per coin, 0.35% of equity at risk per trade. Mirrors
 * exbot/config.py so the web bot trades exactly what the Python lab tested.
 */
export type ExchangeId = "bybit" | "binance";
export type Mode = "paper" | "testnet" | "live";

export const EXCHANGES: ExchangeId[] = ["bybit", "binance"];
export const MODES: Mode[] = ["paper", "testnet", "live"];

export const SYMBOLS = [
  "BTC/USDT:USDT", "ETH/USDT:USDT", "BNB/USDT:USDT", "SOL/USDT:USDT",
  "XRP/USDT:USDT", "ADA/USDT:USDT", "DOGE/USDT:USDT", "LINK/USDT:USDT",
] as const;

export const TIMEFRAME = "4h";
export const TIMEFRAME_MS = 4 * 3_600_000;
export const BARS = 1000;
export const MIN_BARS = 300;

export const STRATEGY = { fast: 50, slow: 200, kAtr: 2.5 } as const;

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
