/**
 * Evaluation layer v1 (pure functions; no I/O).
 *
 * Accuracy is measured on unique selections — one row per (product, event,
 * pick), the first time it was published — because the Sure board re-books
 * the same leg into many slips. `evalSelections` mirrors the SQL view
 * `v_eval_selections` exactly so the two can be checked against each other.
 */

export const PRODUCTS = ["sure-engine", "plenty-codes", "predictions", "combo-builder", "user", "demo"] as const;
export const TIERS = ["safe", "boost", "longshot", "none"] as const;
export type Product = (typeof PRODUCTS)[number];
export type Tier = (typeof TIERS)[number];

/** Server-booked customer combinations (not codes pasted in by users). */
export const CUSTOMER_SLIP_SOURCES = ["book", "builder", "sure-combine"] as const;

/** Same mapping as the generated `product` column. */
export function productOf(source: string | null | undefined): Product {
  switch (source) {
    case "sure":
      return "sure-engine";
    case "plenty":
      return "plenty-codes";
    case "predictions":
      return "predictions";
    case "builder":
      return "combo-builder";
    case "demo-auto":
      return "demo";
    default:
      return "user";
  }
}

/** Same mapping as the generated `tier` column: Sure by slot, SAFE codes → safe, everything else none. */
export function tierOf(source: string | null | undefined, slot: number | null | undefined, productTier: string | null | undefined): Tier {
  const pt = String(productTier ?? "").toLowerCase();
  if (source === "sure") {
    const s = Number(slot);
    if (s >= 1 && s <= 3) return "safe";
    if (s >= 4 && s <= 6) return "boost";
    if (s >= 7 && s <= 9) return "longshot";
  }
  if (pt === "safe") return "safe";
  if (source === "sure" && (pt === "boost" || pt === "longshot")) return pt;
  return "none";
}

export type EvalRow = {
  event_id: string | null;
  pick_code: string | null;
  source: string | null;
  product?: string | null;
  tier?: string | null;
  slot?: number | null;
  product_tier?: string | null;
  data_origin?: string | null;
  published?: boolean | null;
  predicted_before_kickoff?: boolean | null;
  result: string;
  odds: number | string | null;
  confidence: number | string | null;
  devig_prob?: number | string | null;
  overround?: number | string | null;
  created_at: string;
  kickoff: string | null;
  model_version: string | null;
  app_commit?: string | null;
  slip_code: string | null;
  slip_odds?: number | string | null;
  slip_confidence?: number | string | null;
  sport?: string | null;
  market?: string | null;
  league?: string | null;
};

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const ms = (iso: string | null | undefined) => Date.parse(String(iso ?? ""));
const productFor = (r: EvalRow) => (r.product as Product) || productOf(r.source);
const tierFor = (r: EvalRow) => (r.tier as Tier) || tierOf(r.source, r.slot, r.product_tier);
const preKickoff = (r: EvalRow) =>
  r.predicted_before_kickoff ?? (!r.kickoff || ms(r.created_at) < ms(r.kickoff));

/** Fill product / tier from the TS mapping when the generated columns aren't there yet. */
export function withProductTier<T extends EvalRow>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r, product: productFor(r), tier: tierFor(r) }));
}

/**
 * JS twin of v_eval_selections: prospective, published, predicted before
 * kickoff, graded win/loss; distinct on (product, event_id, pick_code)
 * keeping the earliest row. Window filters apply after de-duplication.
 */
export function evalSelections<T extends EvalRow>(rows: T[]): T[] {
  const first = new Map<string, T>();
  for (const r of withProductTier(rows)) {
    if (r.data_origin !== "prospective" || !r.published || !preKickoff(r)) continue;
    if (r.result !== "win" && r.result !== "loss") continue;
    const key = `${r.product}|${r.event_id}|${r.pick_code}`;
    const cur = first.get(key);
    if (!cur || ms(r.created_at) < ms(cur.created_at)) first.set(key, r);
  }
  return [...first.values()].sort((a, b) => ms(a.created_at) - ms(b.created_at));
}

export function inWindow(iso: string, fromIso: string | null, toIso: string | null): boolean {
  const t = ms(iso);
  return (!fromIso || t >= ms(fromIso)) && (!toIso || t < ms(toIso));
}

export function wilson(k: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [r4(Math.max(0, c - h)), r4(Math.min(1, c + h))];
}

function groupKeys<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

// ───────────────────────────── level 1: legs ─────────────────────────────

function legStats(rows: EvalRow[]) {
  const n = rows.length;
  const wins = rows.filter((r) => r.result === "win").length;
  const priced = rows.filter((r) => Number(r.odds) > 1);
  const profit = priced.reduce((a, r) => a + (r.result === "win" ? Number(r.odds) - 1 : -1), 0);
  const devig = rows.map((r) => Number(r.devig_prob)).filter((p) => p > 0 && p < 1);
  return {
    n,
    wins,
    hit_rate: n ? r4(wins / n) : null,
    hit_rate_ci95: wilson(wins, n),
    avg_odds: priced.length ? r4(priced.reduce((a, r) => a + Number(r.odds), 0) / priced.length) : null,
    avg_implied: priced.length ? r4(priced.reduce((a, r) => a + 1 / Number(r.odds), 0) / priced.length) : null,
    avg_devig_prob: devig.length ? r4(devig.reduce((a, p) => a + p, 0) / devig.length) : null,
    devig_n: devig.length,
    roi_flat_stake: priced.length ? r4(profit / priced.length) : null,
  };
}

/** Unique-selection performance per product and tier (rows = view rows). */
export function legLevel(rows: EvalRow[]) {
  const all = withProductTier(rows);
  return {
    unique_selections: all.length,
    overall: legStats(all),
    by_product_tier: [...groupKeys(all, (r) => `${r.product}|${r.tier}`).entries()]
      .map(([k, list]) => {
        const [product, tier] = k.split("|");
        return { product, tier, ...legStats(list) };
      })
      .sort((a, b) => b.n - a.n),
    by_sport: [...groupKeys(all, (r) => `${r.product}|${r.tier}|${r.sport ?? "unknown"}`).entries()]
      .map(([k, list]) => {
        const [product, tier, sport] = k.split("|");
        return { product, tier, sport, ...legStats(list) };
      })
      .sort((a, b) => b.n - a.n),
  };
}

// ─────────────────────────── levels 2 and 3: slips ───────────────────────────

type SlipOutcome = "win" | "loss" | "void" | "pending";

export type SlipRecord = {
  slip_code: string;
  product: string;
  tier: string;
  source: string | null;
  created_at: string;
  first_kickoff: string | null;
  legs: number;
  outcome: SlipOutcome;
  slip_odds: number | null;
  payout_odds: number | null;
  slip_confidence: number | null;
  created_before_first_kickoff: boolean;
};

/** One record per (source, slip_code); void / cancelled legs drop out of the payout. */
export function buildSlips(rows: EvalRow[]): SlipRecord[] {
  const out: SlipRecord[] = [];
  for (const legs of groupKeys(withProductTier(rows.filter((r) => r.slip_code)), (r) => `${r.source}|${r.slip_code}`).values()) {
    let outcome: SlipOutcome;
    if (legs.some((l) => l.result === "loss")) outcome = "loss";
    else if (legs.some((l) => l.result === "pending")) outcome = "pending";
    else if (legs.every((l) => l.result === "void" || l.result === "cancelled")) outcome = "void";
    else outcome = "win";
    const created = legs.reduce((a, l) => (ms(l.created_at) < ms(a) ? l.created_at : a), legs[0].created_at);
    const kicks = legs.map((l) => ms(l.kickoff)).filter(Number.isFinite);
    const firstKick = kicks.length ? new Date(Math.min(...kicks)).toISOString() : null;
    const winOdds = legs.filter((l) => l.result === "win").reduce((a, l) => a * (Number(l.odds) || 1), 1);
    out.push({
      slip_code: String(legs[0].slip_code),
      product: String(legs[0].product),
      tier: String(legs[0].tier),
      source: legs[0].source,
      created_at: created,
      first_kickoff: firstKick,
      legs: legs.length,
      outcome,
      slip_odds: Number(legs[0].slip_odds) || null,
      payout_odds: outcome === "win" ? r4(winOdds) : null,
      slip_confidence: Number(legs[0].slip_confidence) || null,
      created_before_first_kickoff: firstKick == null || ms(created) < ms(firstKick),
    });
  }
  return out;
}

function slipStats(slips: SlipRecord[]) {
  const c = { slips: slips.length, win: 0, loss: 0, void: 0, pending: 0 };
  let profit = 0;
  for (const s of slips) {
    c[s.outcome]++;
    if (s.outcome === "win") profit += (s.payout_odds ?? 1) - 1;
    else if (s.outcome === "loss") profit -= 1;
  }
  const graded = c.win + c.loss;
  const conf = slips.filter((s) => (s.outcome === "win" || s.outcome === "loss") && s.slip_confidence);
  return {
    ...c,
    graded,
    win_rate: graded ? r4(c.win / graded) : null,
    win_rate_ci95: wilson(c.win, graded),
    /** Void slips return the stake and are outside the denominator. */
    roi_flat_stake: graded ? r4(profit / graded) : null,
    avg_slip_odds: slips.length ? r4(slips.reduce((a, s) => a + (s.slip_odds ?? 0), 0) / slips.length) : null,
    avg_slip_confidence: conf.length ? r4(conf.reduce((a, s) => a + (s.slip_confidence ?? 0), 0) / conf.length) : null,
  };
}

function slipLevel(slips: SlipRecord[]) {
  return {
    overall: slipStats(slips),
    by_product_tier: [...groupKeys(slips, (s) => `${s.product}|${s.tier}`).entries()]
      .map(([k, list]) => {
        const [product, tier] = k.split("|");
        return { product, tier, ...slipStats(list) };
      })
      .sort((a, b) => b.slips - a.slips),
    by_leg_count: [...groupKeys(slips, (s) => String(s.legs)).entries()]
      .map(([legs, list]) => ({ legs: Number(legs), ...slipStats(list) }))
      .sort((a, b) => a.legs - b.legs),
  };
}

/** Level 2: slips the system published (Sure / Plenty), prospective, by slip_code. */
export function officialSlipLevel(rows: EvalRow[], fromIso: string | null, toIso: string | null) {
  const pub = rows.filter((r) => r.published && r.data_origin === "prospective");
  const slips = buildSlips(pub).filter((s) => inWindow(s.created_at, fromIso, toIso));
  const clean = slips.filter((s) => s.created_before_first_kickoff);
  return { excluded_created_after_first_kickoff: slips.length - clean.length, ...slipLevel(clean) };
}

/** Level 3: customer-combined slips booked by the server at creation (book / builder / sure-combine). */
export function customerSlipLevel(rows: EvalRow[], fromIso: string | null, toIso: string | null) {
  const cust = rows.filter(
    (r) => r.data_origin === "prospective" && (CUSTOMER_SLIP_SOURCES as readonly string[]).includes(String(r.source)),
  );
  const slips = buildSlips(cust).filter((s) => inWindow(s.created_at, fromIso, toIso));
  const clean = slips.filter((s) => s.created_before_first_kickoff);
  return {
    sources: CUSTOMER_SLIP_SOURCES,
    excluded_created_after_first_kickoff: slips.length - clean.length,
    all_created_before_first_kickoff: clean.length === slips.length,
    ...slipLevel(clean),
  };
}

// ───────────────────────── Champion vs de-vigged market ─────────────────────────

/** Deterministic PRNG so bootstrap intervals are reproducible. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const EPS = 1e-6;
type Pair = { champ: number; market: number; y: 0 | 1 };

function scores(pairs: Pair[], f: (p: Pair) => number) {
  let brier = 0;
  let ll = 0;
  for (const p of pairs) {
    const q = Math.min(1 - EPS, Math.max(EPS, f(p)));
    brier += (q - p.y) ** 2;
    ll += -(p.y ? Math.log(q) : Math.log(1 - q));
  }
  return { brier: brier / pairs.length, log_loss: ll / pairs.length };
}

export function ece(pairs: { p: number; y: 0 | 1 }[], bins = 10): number {
  if (!pairs.length) return NaN;
  const b = Array.from({ length: bins }, () => ({ n: 0, p: 0, y: 0 }));
  for (const x of pairs) {
    const i = Math.min(bins - 1, Math.floor(Math.min(1 - EPS, Math.max(0, x.p)) * bins));
    b[i].n++;
    b[i].p += x.p;
    b[i].y += x.y;
  }
  return b.reduce((a, s) => (s.n ? a + (s.n / pairs.length) * Math.abs(s.y / s.n - s.p / s.n) : a), 0);
}

function percentile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function compare(pairs: Pair[], iterations: number, seed: number) {
  const n = pairs.length;
  if (!n) return null;
  const c = scores(pairs, (p) => p.champ);
  const m = scores(pairs, (p) => p.market);
  const point = {
    champion: {
      brier: r4(c.brier),
      log_loss: r4(c.log_loss),
      ece: r4(ece(pairs.map((p) => ({ p: p.champ, y: p.y })))),
      mean_forecast: r4(pairs.reduce((a, p) => a + p.champ, 0) / n),
    },
    devig_market: {
      brier: r4(m.brier),
      log_loss: r4(m.log_loss),
      ece: r4(ece(pairs.map((p) => ({ p: p.market, y: p.y })))),
      mean_forecast: r4(pairs.reduce((a, p) => a + p.market, 0) / n),
    },
    hit_rate: r4(pairs.reduce((a, p) => a + p.y, 0) / n),
    brier_skill_vs_devig: m.brier > 0 ? r4(1 - c.brier / m.brier) : null,
    log_loss_skill_vs_devig: m.log_loss > 0 ? r4(1 - c.log_loss / m.log_loss) : null,
  };
  const rand = mulberry32(seed);
  const bs: { bs: number; ls: number; db: number }[] = [];
  for (let it = 0; it < iterations; it++) {
    const sample: Pair[] = new Array(n);
    for (let i = 0; i < n; i++) sample[i] = pairs[Math.floor(rand() * n)];
    const sc = scores(sample, (p) => p.champ);
    const sm = scores(sample, (p) => p.market);
    bs.push({ bs: sm.brier > 0 ? 1 - sc.brier / sm.brier : 0, ls: sm.log_loss > 0 ? 1 - sc.log_loss / sm.log_loss : 0, db: sc.brier - sm.brier });
  }
  const ci = (vals: number[]): [number, number] | null => {
    if (!vals.length) return null;
    const s = [...vals].sort((a, b) => a - b);
    return [r4(percentile(s, 0.025)), r4(percentile(s, 0.975))];
  };
  return {
    n,
    ...point,
    ci95: {
      brier_skill_vs_devig: ci(bs.map((x) => x.bs)),
      log_loss_skill_vs_devig: ci(bs.map((x) => x.ls)),
      brier_difference_champion_minus_devig: ci(bs.map((x) => x.db)),
    },
    low_sample: n < 100,
  };
}

/**
 * Champion forecast (logged `confidence`) vs the proportional de-vig of the
 * full market at prediction time, scored on exactly the same unique
 * selections (rows lacking either forecast are excluded from both).
 */
export function modelVsMarket(rows: EvalRow[], opts: { iterations?: number; seed?: number } = {}) {
  const iterations = Math.min(5_000, Math.max(100, opts.iterations ?? 1_000));
  const seed = opts.seed ?? 20_261_017;
  const all = withProductTier(rows);
  const toPair = (r: EvalRow): Pair | null => {
    const champ = Number(r.confidence);
    const market = Number(r.devig_prob);
    if (!(champ > 0 && champ < 1 && market > 0 && market < 1)) return null;
    return { champ, market, y: r.result === "win" ? 1 : 0 };
  };
  const paired = all.map((r) => ({ r, p: toPair(r) })).filter((x): x is { r: EvalRow & { product: string; tier: string }; p: Pair } => Boolean(x.p));
  const groups = groupKeys(paired, (x) => `${x.r.product}|${x.r.tier}`);
  return {
    forecasts: {
      champion: "Logged confidence at prediction time (the frozen Champion's per-leg probability).",
      devig_market: "Proportional de-vig of every outcome price in the same market at prediction time.",
    },
    bootstrap: { iterations, seed, unit: "unique selection" },
    rows_considered: all.length,
    rows_scored: paired.length,
    rows_missing_devig: all.filter((r) => !(Number(r.devig_prob) > 0)).length,
    overall: compare(paired.map((x) => x.p), iterations, seed),
    by_product_tier: [...groups.entries()]
      .map(([k, list]) => {
        const [product, tier] = k.split("|");
        return { product, tier, ...compare(list.map((x) => x.p), iterations, seed) };
      })
      .sort((a, b) => (b.n ?? 0) - (a.n ?? 0)),
  };
}

// ───────────────────────────── integrity checks ─────────────────────────────

/** Task 7: model_version / app_commit coverage and the number of Sure engine versions in the window. */
export function versionCheck(rows: EvalRow[]) {
  const all = withProductTier(rows);
  const count = (xs: (string | null | undefined)[]) =>
    Object.fromEntries([...groupKeys(xs, (x) => x ?? "(missing)").entries()].map(([k, v]) => [k, v.length]));
  const sure = all.filter((r) => r.product === "sure-engine");
  const versions = new Set(sure.map((r) => r.model_version ?? "(missing)"));
  return {
    sure_engine_versions: count(sure.map((r) => r.model_version)),
    one_sure_engine_version: versions.size <= 1 && !versions.has("(missing)"),
    app_commits: count(all.map((r) => r.app_commit)),
    rows_missing_model_version: all.filter((r) => !r.model_version).length,
    rows_missing_app_commit: all.filter((r) => !r.app_commit).length,
  };
}

/** Task 2 checks on raw published rows. */
export function enumCheck(rows: EvalRow[]) {
  const all = withProductTier(rows);
  return {
    tiers_outside_enum: all.filter((r) => !(TIERS as readonly string[]).includes(String(r.tier))).length,
    products_outside_enum: all.filter((r) => !(PRODUCTS as readonly string[]).includes(String(r.product))).length,
    published_rows_without_product: all.filter((r) => r.published && !r.product).length,
  };
}

/** Task 6: share of live rows written after market capture started that carry devig_prob. */
export function devigCoverage(rows: EvalRow[]) {
  const live = rows.filter((r) => r.data_origin === "prospective");
  const firstWith = live.filter((r) => Number(r.devig_prob) > 0).reduce<number | null>((a, r) => {
    const t = ms(r.created_at);
    return a == null || t < a ? t : a;
  }, null);
  if (firstWith == null) return { capture_started_at: null, rows_since: 0, with_devig: 0, coverage: null };
  const since = live.filter((r) => ms(r.created_at) >= firstWith);
  const withDevig = since.filter((r) => Number(r.devig_prob) > 0).length;
  return {
    capture_started_at: new Date(firstWith).toISOString(),
    rows_since: since.length,
    with_devig: withDevig,
    coverage: since.length ? r4(withDevig / since.length) : null,
  };
}

/** Task 3: recovered rows are never evaluated; this is their separate breakdown. */
export function recoveredBreakdown(rows: EvalRow[]) {
  const rec = withProductTier(
    rows.filter((r) => r.data_origin === "recovered" && preKickoff(r) && (r.result === "win" || r.result === "loss")),
  );
  const unique = new Map<string, EvalRow>();
  for (const r of rec) {
    const key = `${r.product}|${r.event_id}|${r.pick_code}`;
    const cur = unique.get(key);
    if (!cur || ms(r.created_at) < ms(cur.created_at)) unique.set(key, r);
  }
  return {
    note: "Rebuilt later from stored codes. Excluded from every evaluation metric; shown for reference only.",
    graded_rows: rec.length,
    unique_selections: legStats([...unique.values()]),
  };
}
