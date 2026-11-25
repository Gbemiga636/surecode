/**
 * Indicators and the EMA trend signal, a line-for-line port of
 * exbot/indicators.py (ema, atr) and exbot/strategies.py (ema_trend).
 * tests/strategy.test.ts checks it against values computed by the Python code.
 */
export type Bar = { t: number; o: number; h: number; l: number; c: number };

export type TrendSignals = {
  side: Int8Array;
  stop: Float64Array;
  exitLong: boolean[];
  exitShort: boolean[];
};

/** pandas ewm(span=n, adjust=False).mean() */
export function ema(x: ArrayLike<number>, n: number): Float64Array {
  const out = new Float64Array(x.length);
  const a = 2 / (n + 1);
  for (let i = 0; i < x.length; i++) out[i] = i === 0 ? x[0] : a * x[i] + (1 - a) * out[i - 1];
  return out;
}

/** Wilder ATR: pandas ewm(alpha=1/n, adjust=False) of the true range, first bar's previous close = its own close. */
export function atr(h: ArrayLike<number>, l: ArrayLike<number>, c: ArrayLike<number>, n = 14): Float64Array {
  const out = new Float64Array(c.length);
  const a = 1 / n;
  for (let i = 0; i < c.length; i++) {
    const prev = i === 0 ? c[0] : c[i - 1];
    const tr = Math.max(h[i] - l[i], Math.abs(h[i] - prev), Math.abs(l[i] - prev));
    out[i] = i === 0 ? tr : a * tr + (1 - a) * out[i - 1];
  }
  return out;
}

export function emaTrend(bars: Bar[], fast: number, slow: number, kAtr: number, allowShort = true): TrendSignals {
  const n = bars.length;
  const h = bars.map((b) => b.h), l = bars.map((b) => b.l), c = bars.map((b) => b.c);
  const f = ema(c, fast), s = ema(c, slow), a = atr(h, l, c, 14);
  const above = Array.from({ length: n }, (_, i) => f[i] > s[i]);
  const side = new Int8Array(n);
  const stop = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const prev = above[i === 0 ? n - 1 : i - 1]; // np.roll(above, 1)
    if (above[i] && !prev) side[i] = 1;
    else if (allowShort && !above[i] && prev) side[i] = -1;
    if (i < slow + 1) side[i] = 0;
    if (side[i] === 1) stop[i] = c[i] - kAtr * a[i];
    else if (side[i] === -1) stop[i] = c[i] + kAtr * a[i];
  }
  return { side, stop, exitLong: above.map((x) => !x), exitShort: above };
}

/**
 * 55-bar breakout (video-style): long when close breaks the prior 55-bar high
 * and sits above the trend EMA; short on the opposite. Exit on the opposite break.
 */
export function breakout55(bars: Bar[], lookback: number, trendEma: number, kAtr: number, allowShort = true): TrendSignals {
  const n = bars.length;
  const h = bars.map((b) => b.h), l = bars.map((b) => b.l), c = bars.map((b) => b.c);
  const trend = ema(c, trendEma);
  const a = atr(h, l, c, 14);
  const side = new Int8Array(n);
  const stop = new Float64Array(n).fill(NaN);
  const exitLong: boolean[] = Array(n).fill(false);
  const exitShort: boolean[] = Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (i < Math.max(lookback, trendEma) + 1) continue;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - lookback; j < i; j++) {
      if (h[j] > hi) hi = h[j];
      if (l[j] < lo) lo = l[j];
    }
    if (c[i] > hi && c[i] > trend[i]) {
      side[i] = 1;
      stop[i] = c[i] - kAtr * a[i];
    } else if (allowShort && c[i] < lo && c[i] < trend[i]) {
      side[i] = -1;
      stop[i] = c[i] + kAtr * a[i];
    }
    exitLong[i] = c[i] < lo;
    exitShort[i] = c[i] > hi;
  }
  return { side, stop, exitLong, exitShort };
}
