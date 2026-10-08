/** Shared, validated filters for the read-only prediction audit endpoints. */

const RESULTS = new Set(["pending", "win", "loss", "void", "cancelled"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type AuditFilters = {
  from: string | null;
  to: string | null;
  date_field: "created" | "kickoff";
  sport: string | null;
  league: string | null;
  market: string | null;
  result: string | null;
  slip_code: string | null;
  source: string | null;
  model_version: string | null;
  product_tier: string | null;
  published: boolean | null;
  event_id: string | null;
  prediction_id: string | null;
  data_origin: string | null;
};

/** Filters that need the v2 columns. */
export const V2_FILTERS: (keyof AuditFilters)[] = ["product_tier", "published", "prediction_id", "data_origin"];

const ORIGINS = new Set(["prospective", "recovered"]);

function parseDay(v: string | null): Date | null | "invalid" {
  if (!v) return null;
  if (!DATE_RE.test(v)) return "invalid";
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? "invalid" : d;
}

function text(q: URLSearchParams, key: string, max = 120): string | null {
  const v = (q.get(key) ?? "").trim();
  return v ? v.slice(0, max) : null;
}

export function parseAuditFilters(q: URLSearchParams): { ok: true; filters: AuditFilters } | { ok: false; error: string } {
  const from = parseDay(q.get("from"));
  const to = parseDay(q.get("to"));
  if (from === "invalid" || to === "invalid") return { ok: false, error: "from / to must be YYYY-MM-DD" };
  if (from && to && from > to) return { ok: false, error: "from must be on or before to" };

  const dateField = (q.get("date_field") ?? "created").toLowerCase();
  if (dateField !== "created" && dateField !== "kickoff") {
    return { ok: false, error: "date_field must be created or kickoff" };
  }

  const result = text(q, "result")?.toLowerCase() ?? null;
  if (result && !RESULTS.has(result)) {
    return { ok: false, error: "result must be pending, win, loss, void or cancelled" };
  }

  const publishedRaw = text(q, "published")?.toLowerCase() ?? null;
  if (publishedRaw && publishedRaw !== "true" && publishedRaw !== "false") {
    return { ok: false, error: "published must be true or false" };
  }

  const origin = text(q, "data_origin")?.toLowerCase() ?? null;
  if (origin && !ORIGINS.has(origin)) {
    return { ok: false, error: "data_origin must be prospective or recovered" };
  }

  return {
    ok: true,
    filters: {
      from: from ? q.get("from") : null,
      to: to ? q.get("to") : null,
      date_field: dateField,
      sport: text(q, "sport")?.toLowerCase() ?? null,
      league: text(q, "league"),
      market: text(q, "market"),
      result,
      slip_code: text(q, "slip_code"),
      source: text(q, "source")?.toLowerCase() ?? null,
      model_version: text(q, "model_version"),
      product_tier: text(q, "product_tier") ?? text(q, "tier"),
      published: publishedRaw == null ? null : publishedRaw === "true",
      event_id: text(q, "event_id"),
      prediction_id: text(q, "prediction_id"),
      data_origin: origin,
    },
  };
}

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

type Filterable = {
  gte(column: string, value: string): Filterable;
  lt(column: string, value: string): Filterable;
  eq(column: string, value: string | boolean): Filterable;
  ilike(column: string, pattern: string): Filterable;
};

export function dateColumn(f: AuditFilters): "kickoff" | "created_at" {
  return f.date_field === "kickoff" ? "kickoff" : "created_at";
}

/** Returns the same Supabase builder type it was given, with the filters applied. */
export function applyAuditFilters<Q>(query: Q, f: AuditFilters): Q {
  const column = dateColumn(f);
  // Supabase's builder generics are too deep to express structurally here.
  let q = query as unknown as Filterable;
  if (f.from) q = q.gte(column, `${f.from}T00:00:00.000Z`);
  if (f.to) q = q.lt(column, new Date(Date.parse(`${f.to}T00:00:00.000Z`) + 86_400_000).toISOString());
  if (f.sport) q = q.eq("sport", f.sport);
  if (f.league) q = q.ilike("league", `%${escapeLike(f.league)}%`);
  if (f.market) q = q.eq("market", f.market);
  if (f.result) q = q.eq("result", f.result);
  if (f.slip_code) q = q.eq("slip_code", f.slip_code);
  if (f.source) q = q.eq("source", f.source);
  if (f.model_version) q = q.eq("model_version", f.model_version);
  if (f.product_tier) q = q.eq("product_tier", f.product_tier);
  if (f.published != null) q = q.eq("published", f.published);
  if (f.event_id) q = q.eq("event_id", f.event_id);
  if (f.prediction_id) q = q.eq("prediction_id", f.prediction_id);
  if (f.data_origin) q = q.eq("data_origin", f.data_origin);
  return q as unknown as Q;
}
