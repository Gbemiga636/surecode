/**
 * Prediction audit log — one row per predicted selection.
 *
 * Deliberately isolated from the prediction engine: every exported function
 * swallows its own errors, bounds every network call with a timeout and
 * returns a count instead of throwing. A missing table, bad credentials or a
 * slow database can only mean "nothing was logged" — never a failed crawl or
 * a failed booking.
 *
 * Set PREDICTION_LOG_DISABLED=1 to turn logging and settlement off entirely.
 */
import { createHash } from "node:crypto";
import { PICKS, type BookableLeg } from "./sporty";
import {
  PREDICTION_LOG_TABLE,
  auditDisabled,
  auditDb,
  auditSchema,
  auditWarn,
  isoTime,
  num,
  sportOf,
  upsertChunks,
} from "./audit-db";

export { PREDICTION_LOG_TABLE };

/**
 * Version of the prediction logic. Bump it in the same commit as any change
 * that alters which picks are produced (see docs/CHAMPION_SNAPSHOT.md).
 * UI-only deploys keep the version; the deployed commit goes to `app_commit`.
 */
export const ENGINE_VERSION = "2026.10";

/**
 * Commits that changed the Sure engine before ENGINE_VERSION existed, used to
 * stamp predictions recovered from stored codes with the logic that made them.
 * The last entry is the logic ENGINE_VERSION still describes.
 */
const SURE_ENGINE_ERAS: { from: string; version: string }[] = [
  { from: "2026-09-13T09:18:32Z", version: "2026.09-273aa6f" },
  { from: "2026-09-13T09:53:42Z", version: "2026.09-2fc1ea9" },
  { from: "2026-09-17T13:42:27Z", version: "2026.09-3cd9893" },
  { from: "2026-09-17T15:01:28Z", version: "2026.09-9acae43" },
  { from: "2026-09-17T15:21:20Z", version: "2026.09-ccc26b0" },
  { from: "2026-09-19T17:33:38Z", version: "2026.09-ea01821" },
  { from: "2026-09-22T23:59:48Z", version: "2026.09-8086bbf" },
  { from: "2026-09-23T00:15:06Z", version: "2026.09-1d39bfa" },
  { from: "2026-09-23T00:33:49Z", version: "2026.09-6b1148c" },
  { from: "2026-09-26T00:25:19Z", version: "2026.09-3fadd51" },
  { from: "2026-09-26T05:44:42Z", version: "2026.09-9f9f21c" },
  { from: "2026-09-29T10:28:28Z", version: "2026.09-7ccb4d1" },
  { from: "2026-09-30T09:16:32Z", version: ENGINE_VERSION },
];

/** Sure engine version that was live at `iso` (null before the first era). */
export function sureEngineVersionAt(iso: string | null | undefined): string | null {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return null;
  let found: string | null = null;
  for (const era of SURE_ENGINE_ERAS) {
    if (t >= Date.parse(era.from)) found = era.version;
  }
  return found ? `${MODEL_NAME.sure}/${found}` : null;
}

export type LogSource =
  | "sure"
  | "plenty"
  | "predictions"
  | "book"
  | "builder"
  | "edit-code"
  | "demo-auto"
  | "sure-combine";

export type LogResult = "pending" | "win" | "loss" | "void" | "cancelled";

const MODEL_NAME: Record<LogSource, string> = {
  sure: "sure-engine",
  plenty: "plenty-codes",
  predictions: "predictions",
  book: "manual-book",
  builder: "combo-builder",
  "edit-code": "edit-code",
  "demo-auto": "demo-auto",
  "sure-combine": "sure-combine",
};

/** Sources whose output the system itself shows to customers. */
const PUBLISHED: Record<LogSource, boolean> = {
  sure: true,
  plenty: true,
  predictions: true,
  book: false,
  builder: false,
  "edit-code": false,
  "demo-auto": false,
  "sure-combine": false,
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
  /** Product tier, e.g. safe / boost / longshot for Sure slots. */
  tier?: string | null;
  slot?: number | null;
  /** Scope used to de-duplicate tips that have no slip code (e.g. the day). */
  dedupeScope?: string | null;
  /**
   * `recovered` = rebuilt later from a stored code; `createdAt` then carries
   * the time the code was originally generated. Needs the v2 schema.
   */
  dataOrigin?: "prospective" | "recovered";
  createdAt?: string | null;
  modelVersion?: string | null;
};

export function modelVersion(source: LogSource): string {
  return `${MODEL_NAME[source]}/${ENGINE_VERSION}`;
}

export function appCommit(): string | null {
  return (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null;
}

/** Stable id: the same prediction always gets the same id ('pl_' + 24 hex). */
export function predictionId(dedupeKey: string): string {
  return `pl_${createHash("sha256").update(dedupeKey, "utf8").digest("hex").slice(0, 24)}`;
}

const V2_FIELDS = [
  "prediction_id",
  "product_tier",
  "slot",
  "published",
  "data_origin",
  "app_commit",
] as const;

function defaultTier(source: LogSource): string {
  if (source === "predictions") return "tip";
  if (source === "sure" || source === "plenty") return source;
  return "user";
}

function toRows(slip: LogSlip): Record<string, unknown>[] {
  const legs = Array.isArray(slip.legs) ? slip.legs : [];
  const version = slip.modelVersion || modelVersion(slip.source);
  const recovered = slip.dataOrigin === "recovered";
  const createdAt = isoTime(slip.createdAt);
  const scope = slip.slipCode || slip.dedupeScope || "";
  const usable = legs.filter((l) => l && l.home && l.away && l.eventId);
  if (usable.length < legs.length) {
    auditWarn("rows", `${legs.length - usable.length} leg(s) without event id skipped (${slip.source})`);
  }
  return usable.map((l) => {
    const meta = l.pickCode ? PICKS[l.pickCode] : undefined;
    const selection = l.pickLabel || meta?.label || l.pickCode || null;
    const conf = num(l.confidence, 4);
    const dedupeKey = [slip.source, scope, String(l.eventId), l.pickCode || selection || ""].join("|");
    return {
      fixture: `${l.home} v ${l.away}`,
      sport: sportOf(l.pickCode, l.sport, l.sportLabel),
      league: l.league || null,
      market: meta?.market ?? null,
      selection,
      odds: num(l.odds, 4),
      confidence: conf != null && conf >= 0 && conf <= 1 ? conf : null,
      slip_code: slip.slipCode || null,
      model_version: version,
      source: slip.source,
      origin: slip.origin ? String(slip.origin).slice(0, 80) : null,
      event_id: String(l.eventId),
      pick_code: l.pickCode || null,
      kickoff: isoTime(l.kickoff),
      slip_odds: num(slip.slipOdds, 4),
      slip_confidence: num(slip.slipConfidence, 6),
      slip_legs: slip.slipCode ? usable.length : null,
      dedupe_key: dedupeKey,
      prediction_id: predictionId(dedupeKey),
      product_tier: slip.tier || defaultTier(slip.source),
      slot: slip.slot ?? null,
      published: PUBLISHED[slip.source],
      data_origin: recovered ? "recovered" : "prospective",
      app_commit: recovered ? null : appCommit(),
      ...(createdAt ? { created_at: createdAt } : {}),
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
    if (auditDisabled() || !Array.isArray(slips) || !slips.length || !auditDb()) return 0;
    const schema = await auditSchema();
    // Without the v2 columns a recovered row can't be told apart from a live one.
    const usable = schema.v2 ? slips : slips.filter((s) => s && s.dataOrigin !== "recovered");
    let rows = usable.flatMap(toRows);
    if (!rows.length) return 0;
    if (schema.v2 && !schema.appCommit) {
      rows = rows.map(({ app_commit: _omit, ...rest }) => rest);
    }
    if (!schema.v2) {
      rows = rows.map((r) => {
        const copy = { ...r };
        for (const f of V2_FIELDS) delete copy[f];
        return copy;
      });
    }
    const res = await upsertChunks(PREDICTION_LOG_TABLE, rows, {
      onConflict: "dedupe_key",
      ignoreDuplicates: true,
      timeoutMs: opts.timeoutMs ?? 6_000,
    });
    if (res.error) auditWarn("insert", res.error);
    return res.written;
  } catch (e) {
    auditWarn("insert", e);
    return 0;
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
export function slipToLog(
  source: LogSource,
  s: SlipLike,
  origin: string,
  extra: { tier?: string | null; slot?: number | null } = {},
): LogSlip | null {
  if (!s?.code || !Array.isArray(s.legs)) return null;
  return {
    source,
    slipCode: s.code,
    slipOdds: s.totalOdds,
    slipConfidence: s.confidence ?? s.legs.reduce((a, l) => a * (Number(l.implied) || 0), 1),
    origin,
    tier: extra.tier ?? null,
    slot: extra.slot ?? null,
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
    const row = slipToLog("sure", s, `slot-${s.slot}${s.mode ? `:${s.mode}` : ""}`, {
      tier: s.mode ?? null,
      slot: s.slot,
    });
    if (row) out.push(row);
  }
  for (const p of input.plenty ?? []) {
    const row = slipToLog("plenty", p, p.codeType, { tier: p.codeType });
    if (row) out.push(row);
  }
  const tips = (input.predictions ?? []).filter((t) => t && t.pickCode);
  if (tips.length) {
    out.push({
      source: "predictions",
      dedupeScope: input.day,
      origin: "daily-pool",
      tier: "tip",
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
