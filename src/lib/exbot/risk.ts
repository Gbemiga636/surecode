/** Port of exbot/risk.py. Days are UTC calendar days. */
import type { RiskParams } from "./config";

export type RiskState = {
  peak: number;
  day: string | null;
  dayStart: number;
  haltDay: string | null;
  lossStreak: number;
  pausedUntil: string | null;
  killed: boolean;
  recentR: Record<string, number[]>;
  symbolPause: Record<string, string>;
};

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export class RiskManager {
  s: RiskState;

  constructor(readonly rp: RiskParams, equity: number, saved?: Partial<RiskState> | null) {
    this.s = {
      peak: equity, day: null, dayStart: equity, haltDay: null, lossStreak: 0,
      pausedUntil: null, killed: false, recentR: {}, symbolPause: {},
      ...(saved || {}),
    };
  }

  update(now: Date, equity: number): void {
    const d = utcDay(now);
    if (d !== this.s.day) {
      this.s.day = d;
      this.s.dayStart = equity;
    }
    this.s.peak = Math.max(this.s.peak, equity);
    if (equity <= this.s.peak * (1 - this.rp.maxDrawdown)) this.s.killed = true;
    if (equity <= this.s.dayStart * (1 - this.rp.dailyLossLimit)) this.s.haltDay = d;
  }

  canOpen(now: Date, symbol: string, openPositions: number): [boolean, string] {
    const rp = this.rp;
    if (this.s.killed) return [false, `kill switch: drawdown ≥ ${Math.round(rp.maxDrawdown * 100)}% from peak (an admin must reset it)`];
    if (this.s.haltDay === utcDay(now)) return [false, "daily loss limit reached"];
    if (this.s.pausedUntil && now < new Date(this.s.pausedUntil)) return [false, `cool-down after ${rp.lossStreakPause} losses in a row`];
    const until = this.s.symbolPause[symbol];
    if (until && now < new Date(until)) return [false, `${symbol} paused: recent trades below expectancy floor`];
    if (openPositions >= rp.maxOpenPositions) return [false, "max open positions"];
    return [true, ""];
  }

  riskFraction(): number {
    const r = this.rp.riskPerTrade;
    return this.s.lossStreak >= this.rp.lossStreakHalve ? r / 2 : r;
  }

  size(equity: number, entry: number, stop: number): number {
    const perUnit = Math.abs(entry - stop);
    if (!(perUnit > 0) || !(entry > 0)) return 0;
    const qty = (equity * this.riskFraction()) / perUnit;
    return Math.min(qty, (equity * this.rp.maxLeverage) / entry);
  }

  onClose(now: Date, symbol: string, pnl: number, rMult: number): void {
    const rp = this.rp;
    if (pnl < 0) {
      this.s.lossStreak += 1;
      if (this.s.lossStreak >= rp.lossStreakPause) {
        this.s.pausedUntil = new Date(now.getTime() + rp.pauseHours * 3_600_000).toISOString();
        this.s.lossStreak = rp.lossStreakHalve;
      }
    } else if (pnl > 0) {
      this.s.lossStreak = 0;
    }
    const q = [...(this.s.recentR[symbol] || []), rMult].slice(-rp.symbolReviewTrades);
    if (q.length === rp.symbolReviewTrades && q.reduce((a, b) => a + b, 0) / q.length < rp.symbolMinExpectancyR) {
      this.s.symbolPause[symbol] = new Date(now.getTime() + rp.symbolPauseDays * 86_400_000).toISOString();
      this.s.recentR[symbol] = [];
    } else {
      this.s.recentR[symbol] = q;
    }
  }

  resetKillSwitch(equity: number): void {
    this.s.killed = false;
    this.s.peak = equity;
  }
}
