/** Probability-quality metrics for settled predictions (p = forecast, y = 0/1). */

export type Sample = { p: number; y: 0 | 1; odds?: number };

const EPS = 1e-6;
const clip = (p: number) => Math.min(1 - EPS, Math.max(EPS, p));
const round = (v: number, d = 4) => Number(v.toFixed(d));

export function brier(samples: Sample[]): number {
  if (!samples.length) return NaN;
  return samples.reduce((a, s) => a + (s.p - s.y) ** 2, 0) / samples.length;
}

export function logLoss(samples: Sample[]): number {
  if (!samples.length) return NaN;
  return (
    -samples.reduce((a, s) => {
      const p = clip(s.p);
      return a + (s.y ? Math.log(p) : Math.log(1 - p));
    }, 0) / samples.length
  );
}

/** Wilson score interval for a binomial proportion (95%). */
export function wilson(wins: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 0];
  const phat = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = phat + (z * z) / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - margin) / denom), Math.min(1, (centre + margin) / denom)];
}

export type CalibrationBin = {
  range: string;
  n: number;
  meanForecast: number;
  observedRate: number;
};

export function calibration(samples: Sample[], bins = 10): { bins: CalibrationBin[]; ece: number } {
  const buckets = Array.from({ length: bins }, () => ({ n: 0, p: 0, y: 0 }));
  for (const s of samples) {
    const i = Math.min(bins - 1, Math.floor(clip(s.p) * bins));
    buckets[i].n++;
    buckets[i].p += s.p;
    buckets[i].y += s.y;
  }
  const total = samples.length || 1;
  let ece = 0;
  const out: CalibrationBin[] = [];
  buckets.forEach((b, i) => {
    if (!b.n) return;
    const meanForecast = b.p / b.n;
    const observedRate = b.y / b.n;
    ece += (b.n / total) * Math.abs(observedRate - meanForecast);
    out.push({
      range: `${(i / bins).toFixed(1)}-${((i + 1) / bins).toFixed(1)}`,
      n: b.n,
      meanForecast: round(meanForecast),
      observedRate: round(observedRate),
    });
  });
  return { bins: out, ece: round(ece) };
}

export function summarize(samples: Sample[]) {
  const n = samples.length;
  const wins = samples.reduce((a, s) => a + s.y, 0);
  const hitRate = n ? wins / n : NaN;
  const meanForecast = n ? samples.reduce((a, s) => a + s.p, 0) / n : NaN;
  const b = brier(samples);
  // Reference forecast = constant base rate (climatology)
  const bRef = n ? hitRate * (1 - hitRate) : NaN;
  const withOdds = samples.filter((s) => s.odds && s.odds > 1);
  const roi = withOdds.length
    ? withOdds.reduce((a, s) => a + (s.y ? (s.odds as number) - 1 : -1), 0) / withOdds.length
    : null;
  const [lo, hi] = wilson(wins, n);

  return {
    n,
    wins,
    hitRate: round(hitRate),
    hitRate95ci: [round(lo), round(hi)],
    meanForecast: round(meanForecast),
    calibrationGap: round(hitRate - meanForecast),
    brier: round(b),
    brierBaseRate: round(bRef),
    brierSkill: bRef > 0 ? round(1 - b / bRef) : null,
    logLoss: round(logLoss(samples)),
    flatStakeRoi: roi == null ? null : round(roi),
    lowSample: n < 30,
  };
}

export function inferSport(pickCode: string): string {
  if (pickCode.startsWith("BB")) return "basketball";
  if (pickCode.startsWith("TN")) return "tennis";
  if (pickCode === "1" || pickCode === "2") return "moneyline (football/hockey/baseball)";
  return "football";
}
