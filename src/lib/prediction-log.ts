/**
 * Prediction audit log.
 *
 * Deliberately isolated from the prediction engine: every exported function
 * swallows its own errors, bounds every network call with a timeout and
 * returns a count instead of throwing. Callers never need a try/catch, and a
 * missing table, bad credentials or a slow database can only mean "nothing was
 * logged" — never a failed crawl or a failed booking.
 *
 * Set PREDICTION_LOG_DISABLED=1 to turn logging and settlement off entirely.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PICKS, fetchFinalScore, settlePick, type BookableLeg } from "./sporty";

export const PREDICTION_LOG_TABLE = "prediction_log";

/** Bump when the logic that produces predictions changes materially. */
const ENGINE_VERSION = "2026.10";

export type LogSource = "sure" | "plenty" | "predictions" | "book" | "builder" | "edit-code" | "demo-auto";

export type LogResult = "pending" | "win" | "loss" | "void" | "cancelled";

const MODEL_NAME: Record<LogSource, string> = {
  sure: "sure-engine",
  plenty: "plenty-codes",
  predictions: "predictions",
  book: "manual-book",
  builder: "combo-builder",
  "edit-code": "edit-code",
  "demo-auto": "demo-auto",
};

export type LogLeg = {
  eventId?: string | null;
  home: string;
  away: string;
  league?: string | null;
  sport?: string | null;
  sportLabel?: string | null;
  pickCode?: string | null;
  pickLabel?: string | null;
  odds: number | string;
  kickoff?: number | string | null;
  /** Probability the engine assigned to this leg (0–1). */
  confidence?: number | null;
};

export type LogSlip = {
  source: LogSource;
  /** SportyBet booking code. Omit for standalone tips. */
  slipCode?: string | null;
  legs: LogLeg[];
  slipOdds?: number | null;
  slipConfidence?: number | null;
  origin?: string | null;
  /** Scope used to de-duplicate tips that have no slip code (e.g. the day). */
  dedupeScope?: string | null;
};

const disabled = () => process.env.PREDICTION_LOG_DISABLED === "1";

let cached: SupabaseClient | null | undefined;
function admin(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached =
    url && key
      ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;
  return cached;
}

function warn(where: string, e: unknown) {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
  console.warn(`[prediction-log] ${where}: ${msg}`);
}

async function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), Math.max(250, ms));
  });
  try {
    return await Promise.race([Promise.resolve(work), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function modelVersion(source: LogSource): string {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7);
  return `${MODEL_NAME[source]}/${ENGINE_VERSION}${sha ? `+${sha}` : ""}`;
}

function sportOf(leg: LogLeg): string {
  const code = leg.pickCode ?? "";
  if (code.startsWith("BB")) return "basketball";
  if (code.startsWith("TN")) return "tennis";
  const s = (leg.sport || leg.sportLabel || "").toString().trim().toLowerCase();
  return s || "football";
}

function num(v: unknown, digits: number): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function isoTime(v: number | string | null | undefined): string | null {
  if (v == null || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null;
}

function toRows(slip: LogSlip) {
  const legs = Array.isArray(slip.legs) ? slip.legs : [];
  const version = modelVersion(slip.source);
  const scope = slip.slipCode || slip.dedupeScope || "";
  return legs
    .filter((l) => l && l.home && l.away)
    .map((l) => {
      const fixture = `${l.home} v ${l.away}`;
      const meta = l.pickCode ? PICKS[l.pickCode] : undefined;
      const selection = l.pickLabel || meta?.label || l.pickCode || null;
      const conf = num(l.confidence, 4);
      return {
        fixture,
        sport: sportOf(l),
        league: l.league || null,
        market: meta?.market ?? null,
        selection,
        odds: num(l.odds, 4),
        confidence: conf != null && conf >= 0 && conf <= 1 ? conf : null,
        slip_code: slip.slipCode || null,
        model_version: version,
        source: slip.source,
        origin: slip.origin ? String(slip.origin).slice(0, 80) : null,
        event_id: l.eventId ? String(l.eventId) : null,
        pick_code: l.pickCode || null,
        kickoff: isoTime(l.kickoff),
        slip_odds: num(slip.slipOdds, 4),
        slip_confidence: num(slip.slipConfidence, 6),
        slip_legs: slip.slipCode ? legs.length : null,
        dedupe_key: [slip.source, scope, l.eventId || fixture, l.pickCode || selection || ""].join("|"),
      };
    });
}

/**
 * Record generated predictions. Never throws. Duplicate legs (same source,
 * slip and selection) are ignored, so re-running a crawl is harmless.
 */
export async function logPredictions(
  slips: LogSlip[],
  opts: { timeoutMs?: number } = {},
): Promise<number> {
  try {
    if (disabled() || !Array.isArray(slips) || !slips.length) return 0;
    const rows = slips.flatMap(toRows);
    if (!rows.length) return 0;
    const sb = admin();
    if (!sb) return 0;

    const timeoutMs = opts.timeoutMs ?? 6_000;
    const started = Date.now();
    let written = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const left = timeoutMs - (Date.now() - started);
      if (left < 300) break;
      const chunk = rows.slice(i, i + 200);
      const res = await withTimeout(
        sb.from(PREDICTION_LOG_TABLE).upsert(chunk, { onConflict: "dedupe_key", ignoreDuplicates: true }),
        left,
      );
      if (!res) {
        warn("insert", "timed out");
        break;
      }
      if (res.error) {
        warn("insert", res.error.message);
        break;
      }
      written += chunk.length;
    }
    return written;
  } catch (e) {
    warn("insert", e);
    return 0;
  }
}

type PendingRow = { id: string; event_id: string; pick_code: string | null; kickoff: string };

const SETTLE_AFTER_MS = 105 * 60_000;
const CANCEL_AFTER_MS = 72 * 3_600_000;

/**
 * Settle pending rows whose matches should be over. Uses SportyBet final
 * scores (the same source the app already uses). Never throws.
 *
 * - win / loss: from the full-time score
 * - void: a stake-refund outcome (Draw No Bet ending level)
 * - cancelled: still no final result 72h after kickoff (postponed / abandoned)
 * - markets that can't be graded from a full-time score (1st-half lines) keep
 *   result = pending, get the final score and a settle_note, and are not retried
 */
export async function settlePredictionLog(
  opts: { budgetMs?: number; limit?: number } = {},
): Promise<{ checked: number; settled: number }> {
  const out = { checked: 0, settled: 0 };
  try {
    if (disabled()) return out;
    const sb = admin();
    if (!sb) return out;
    const end = Date.now() + (opts.budgetMs ?? 15_000);
    const left = () => end - Date.now();

    const cutoff = new Date(Date.now() - SETTLE_AFTER_MS).toISOString();
    const res = await withTimeout(
      sb
        .from(PREDICTION_LOG_TABLE)
        .select("id, event_id, pick_code, kickoff")
        .eq("result", "pending")
        .is("settled_at", null)
        .not("event_id", "is", null)
        .lt("kickoff", cutoff)
        .order("kickoff", { ascending: true })
        .limit(opts.limit ?? 300),
      Math.min(6_000, left()),
    );
    if (!res || res.error || !res.data?.length) {
      if (res?.error) warn("settle select", res.error.message);
      return out;
    }

    const byEvent = new Map<string, PendingRow[]>();
    for (const row of res.data as PendingRow[]) {
      const list = byEvent.get(row.event_id) ?? [];
      list.push(row);
      byEvent.set(row.event_id, list);
    }

    const events = [...byEvent.entries()];
    const nowIso = () => new Date().toISOString();

    async function apply(ids: string[], patch: Record<string, unknown>) {
      if (!ids.length || left() < 400) return;
      const r = await withTimeout(
        sb!.from(PREDICTION_LOG_TABLE).update(patch).in("id", ids).eq("result", "pending"),
        Math.min(4_000, left()),
      );
      if (r && !r.error) out.settled += ids.length;
      else if (r?.error) warn("settle update", r.error.message);
    }

    async function settleEvent([eventId, rows]: [string, PendingRow[]]) {
      out.checked += rows.length;
      const score = await withTimeout(fetchFinalScore(eventId), Math.min(8_000, left()));
      const oldest = Math.min(...rows.map((r) => Date.parse(r.kickoff) || Date.now()));

      if (!score || !score.ended) {
        if (Date.now() - oldest > CANCEL_AFTER_MS) {
          await apply(
            rows.map((r) => r.id),
            { result: "cancelled", settled_at: nowIso(), settle_note: "No final result 72h after kickoff" },
          );
        }
        return;
      }

      const finalScore = `${score.home}-${score.away}`;
      const groups: Record<"win" | "loss" | "void" | "ungraded", PendingRow[]> = {
        win: [],
        loss: [],
        void: [],
        ungraded: [],
      };
      for (const row of rows) {
        const graded = row.pick_code ? settlePick(row.pick_code, score.home, score.away) : null;
        if (graded === true) groups.win.push(row);
        else if (graded === false) groups.loss.push(row);
        else if ((row.pick_code === "DNBH" || row.pick_code === "DNBA") && score.home === score.away)
          groups.void.push(row);
        else groups.ungraded.push(row);
      }

      for (const result of ["win", "loss", "void"] as const) {
        await apply(
          groups[result].map((r) => r.id),
          { result, final_score: finalScore, settled_at: nowIso() },
        );
      }
      await apply(
        groups.ungraded.map((r) => r.id),
        {
          final_score: finalScore,
          settled_at: nowIso(),
          settle_note: "Market can't be graded from the full-time score",
        },
      );
    }

    for (let i = 0; i < events.length; i += 4) {
      if (left() < 2_500) break;
      await Promise.all(events.slice(i, i + 4).map((e) => settleEvent(e).catch((err) => warn("settle event", err))));
    }
    return out;
  } catch (e) {
    warn("settle", e);
    return out;
  }
}

type SlipLike = {
  code?: string | null;
  legs: BookableLeg[];
  totalOdds: number;
  /** Defaults to the product of the legs' probabilities. */
  confidence?: number;
};

type TipLike = {
  eventId?: string;
  home: string;
  away: string;
  league?: string;
  kickoff: string;
  pickCode: string;
  pick?: string;
  odds: string | number;
  confidence: number;
};

/** Turn a booked slip (legs carry `implied` probabilities) into a log entry. */
export function slipToLog(source: LogSource, s: SlipLike, origin: string): LogSlip | null {
  if (!s?.code || !Array.isArray(s.legs)) return null;
  return {
    source,
    slipCode: s.code,
    slipOdds: s.totalOdds,
    slipConfidence: s.confidence ?? s.legs.reduce((a, l) => a * (Number(l.implied) || 0), 1),
    origin,
    legs: s.legs.map((l) => ({ ...l, confidence: l.implied })),
  };
}

/** Shape what one crawl produced into log rows. */
export function crawlLogSlips(input: {
  day: string;
  sure: (SlipLike & { slot: number; mode?: string })[];
  plenty: (SlipLike & { codeType: string })[];
  predictions: TipLike[];
}): LogSlip[] {
  const out: LogSlip[] = [];
  for (const s of input.sure ?? []) {
    if (!s) continue;
    const row = slipToLog("sure", s, `slot-${s.slot}${s.mode ? `:${s.mode}` : ""}`);
    if (row) out.push(row);
  }
  for (const p of input.plenty ?? []) {
    const row = slipToLog("plenty", p, p.codeType);
    if (row) out.push(row);
  }
  const tips = (input.predictions ?? []).filter((t) => t && t.pickCode);
  if (tips.length) {
    out.push({
      source: "predictions",
      dedupeScope: input.day,
      origin: "daily-pool",
      legs: tips.map((t) => ({
        eventId: t.eventId,
        home: t.home,
        away: t.away,
        league: t.league,
        pickCode: t.pickCode,
        pickLabel: t.pick,
        odds: t.odds,
        kickoff: t.kickoff,
        confidence: t.confidence,
      })),
    });
  }
  return out;
}

/**
 * Log, then settle, inside a hard time budget. `build` runs inside the guard
 * so a shaping bug is contained too. Never throws.
 */
export async function runPredictionLog(build: () => LogSlip[], budgetMs: number): Promise<void> {
  try {
    if (disabled() || budgetMs < 1_500) return;
    const start = Date.now();
    await logPredictions(build(), { timeoutMs: Math.min(8_000, budgetMs - 500) });
    const remaining = budgetMs - (Date.now() - start);
    if (remaining > 4_000) await settlePredictionLog({ budgetMs: Math.min(20_000, remaining - 1_000) });
  } catch (e) {
    warn("run", e);
  }
}
