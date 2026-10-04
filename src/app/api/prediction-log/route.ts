import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PREDICTION_LOG_TABLE } from "@/lib/prediction-log";
import { checkPredictionLogAuth } from "@/lib/prediction-log-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const COLUMNS = [
  "id",
  "created_at",
  "fixture",
  "sport",
  "league",
  "market",
  "selection",
  "odds",
  "confidence",
  "slip_code",
  "model_version",
  "result",
  "final_score",
  "closing_odds",
  "source",
  "origin",
  "event_id",
  "pick_code",
  "kickoff",
  "slip_odds",
  "slip_confidence",
  "slip_legs",
  "settled_at",
  "settle_note",
].join(", ");

const RESULTS = new Set(["pending", "win", "loss", "void", "cancelled"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NO_STORE = { "Cache-Control": "no-store" };

function bad(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400, headers: NO_STORE });
}

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

function int(q: URLSearchParams, key: string, def: number, min: number, max: number): number | null {
  const raw = q.get(key);
  if (raw == null || raw === "") return def;
  if (!/^\d+$/.test(raw)) return null;
  return Math.min(max, Math.max(min, Number(raw)));
}

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * GET /api/prediction-log — read-only audit export.
 *
 * Auth: `Authorization: Bearer <PREDICTION_LOG_API_KEY>` or `x-api-key: <key>`.
 *
 * Query params (all optional):
 *   from, to      YYYY-MM-DD (UTC, both inclusive)
 *   date_field    created (default) | kickoff — which timestamp from/to apply to
 *   sport, market, result, slip_code, source, model_version   exact match
 *   league        case-insensitive "contains"
 *   limit         1–1000 (default 100)
 *   offset        for paging (default 0)
 *   order         desc (default) | asc
 */
export async function GET(request: Request) {
  const auth = checkPredictionLogAuth(request);
  if (!auth.ok) return auth.response;

  const q = new URL(request.url).searchParams;

  const from = parseDay(q.get("from"));
  const to = parseDay(q.get("to"));
  if (from === "invalid" || to === "invalid") return bad("from / to must be YYYY-MM-DD");
  if (from && to && from > to) return bad("from must be on or before to");

  const dateField = (q.get("date_field") ?? "created").toLowerCase();
  if (dateField !== "created" && dateField !== "kickoff") return bad("date_field must be created or kickoff");
  const column = dateField === "kickoff" ? "kickoff" : "created_at";

  const result = text(q, "result")?.toLowerCase() ?? null;
  if (result && !RESULTS.has(result)) return bad("result must be pending, win, loss, void or cancelled");

  const order = (q.get("order") ?? "desc").toLowerCase();
  if (order !== "asc" && order !== "desc") return bad("order must be asc or desc");

  const limit = int(q, "limit", 100, 1, 1000);
  const offset = int(q, "offset", 0, 0, 1_000_000);
  if (limit == null || offset == null) return bad("limit / offset must be whole numbers");

  const sport = text(q, "sport")?.toLowerCase() ?? null;
  const league = text(q, "league");
  const market = text(q, "market");
  const slipCode = text(q, "slip_code");
  const source = text(q, "source")?.toLowerCase() ?? null;
  const modelVersion = text(q, "model_version");

  try {
    const sb = createAdminClient();
    let query = sb.from(PREDICTION_LOG_TABLE).select(COLUMNS, { count: "exact" });

    if (from) query = query.gte(column, from.toISOString());
    if (to) query = query.lt(column, new Date(to.getTime() + 86_400_000).toISOString());
    if (sport) query = query.eq("sport", sport);
    if (league) query = query.ilike("league", `%${escapeLike(league)}%`);
    if (market) query = query.eq("market", market);
    if (result) query = query.eq("result", result);
    if (slipCode) query = query.eq("slip_code", slipCode);
    if (source) query = query.eq("source", source);
    if (modelVersion) query = query.eq("model_version", modelVersion);

    const { data, count, error } = await query
      .order(column, { ascending: order === "asc", nullsFirst: false })
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("[api/prediction-log]", error.message);
      return NextResponse.json({ ok: false, error: "Query failed" }, { status: 500, headers: NO_STORE });
    }

    const rows = data ?? [];
    const total = count ?? rows.length;
    return NextResponse.json(
      {
        ok: true,
        total,
        count: rows.length,
        limit,
        offset,
        next_offset: offset + rows.length < total ? offset + rows.length : null,
        filters: {
          from: q.get("from"),
          to: q.get("to"),
          date_field: dateField,
          sport,
          league,
          market,
          result,
          slip_code: slipCode,
          source,
          model_version: modelVersion,
          order,
        },
        rows,
      },
      { headers: NO_STORE },
    );
  } catch (e) {
    console.error("[api/prediction-log]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Query failed" }, { status: 500, headers: NO_STORE });
  }
}
