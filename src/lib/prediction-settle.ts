/**
 * Settlement + closing-odds capture for the prediction audit tables.
 *
 * Fail-safe like the rest of the audit: nothing here throws, every network
 * call has a timeout and every pass stops when its time budget is used.
 * Updates only ever touch rows that are still `pending`, so a manual grade is
 * never overwritten.
 */
import { PICKS, getAllSportyFixtures, settlePick } from "./sporty";
import {
  CANDIDATES_TABLE,
  PREDICTION_LOG_TABLE,
  auditDb,
  auditDisabled,
  auditSchema,
  auditWarn,
  withTimeout,
} from "./audit-db";
import type { LogResult } from "./prediction-log";

const EVENT_API = "https://www.sportybet.com/api/ng/factsCenter/event?eventId=";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.sportybet.com/",
  ClientId: "web",
};

/** Matches are checked from 105 min after kickoff. */
const SETTLE_AFTER_MS = 105 * 60_000;
/** No final result this long after kickoff → cancelled (postponed / abandoned). */
const CANCEL_AFTER_MS = 72 * 3_600_000;
/** Markets that need a half-time score stop retrying after this many checks. */
const MAX_UNGRADED_ATTEMPTS = 6;
/** Checks (with an answer from SportyBet) needed before "no result" becomes cancelled. */
const MIN_CANCEL_ATTEMPTS = 3;
/** Failed lookups past the cancel window before a row is parked for manual grading. */
const MAX_NO_DATA_ATTEMPTS = 12;

type Score = { home: number; away: number };

export type EventResult = {
  state: "ended" | "live" | "not_started" | "cancelled" | "unknown";
  ft: Score | null;
  ht: Score | null;
  note?: string;
};

async function fetchEventJson(eventId: string, ms: number): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, ms));
  try {
    const res = await fetch(EVENT_API + encodeURIComponent(eventId), { headers: HEADERS, signal: controller.signal });
    const json = (await res.json()) as { data?: Record<string, unknown> };
    return json?.data ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseScorePair(v: unknown): Score | null {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const h = Number(o.homeScore ?? o.home);
    const a = Number(o.awayScore ?? o.away);
    return Number.isFinite(h) && Number.isFinite(a) ? { home: h, away: a } : null;
  }
  const m = String(v ?? "").match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
  return m ? { home: Number(m[1]), away: Number(m[2]) } : null;
}

/**
 * Final and (when SportyBet provides period scores) half-time result.
 * Mirrors the app's existing `fetchFinalScore` rules for "ended" and the
 * full-time score, and adds cancellation detection and period parsing.
 */
export async function fetchEventResult(eventId: string, ms = 8_000): Promise<EventResult | null> {
  const d = await fetchEventJson(eventId, ms);
  if (!d) return null;
  const statusNum = Number(d.status);
  const matchStatus = String(d.matchStatus ?? "").toLowerCase();

  if (/cancel|abandon/.test(matchStatus)) return { state: "cancelled", ft: null, ht: null, note: String(d.matchStatus) };

  const ended =
    statusNum === 4 ||
    matchStatus.includes("ended") ||
    matchStatus.includes("finished") ||
    matchStatus.includes("closed");

  let ft: Score | null = null;
  const h = Number(d.homeScore);
  const a = Number(d.awayScore);
  if (Number.isFinite(h) && Number.isFinite(a) && d.homeScore != null && d.awayScore != null) ft = { home: h, away: a };
  else if (d.setScore) ft = parseScorePair(d.setScore);

  const rawPeriods = Array.isArray(d.gameScore) ? d.gameScore : Array.isArray(d.periodScores) ? d.periodScores : [];
  const periods = rawPeriods.map(parseScorePair).filter((p): p is Score => Boolean(p));

  // Trust a half-time score only when exactly two periods add up to the final score.
  let ht: Score | null = null;
  if (ft && periods.length === 2) {
    const sumHome = periods[0].home + periods[1].home;
    const sumAway = periods[0].away + periods[1].away;
    if (sumHome === ft.home && sumAway === ft.away) ht = periods[0];
  }

  if (!ft) return { state: ended ? "unknown" : "not_started", ft: null, ht: null };
  return { state: ended ? "ended" : "live", ft, ht };
}

const FIRST_HALF = new Set(["1HO05", "1HDC1X", "1HDCX2"]);

/** Grade one selection. `null` result = can't be graded from what we have. */
export function gradeSelection(
  pickCode: string | null,
  ft: Score,
  ht: Score | null,
): { result: LogResult | null; note?: string } {
  if (!pickCode || !PICKS[pickCode]) return { result: null, note: "unknown market code" };
  if (FIRST_HALF.has(pickCode)) {
    const half = ht ?? (ft.home === 0 && ft.away === 0 ? { home: 0, away: 0 } : null);
    if (!half) return { result: null, note: "half-time score unavailable" };
    const ok =
      pickCode === "1HO05"
        ? half.home + half.away > 0
        : pickCode === "1HDC1X"
          ? half.home >= half.away
          : half.home <= half.away;
    return { result: ok ? "win" : "loss" };
  }
  if ((pickCode === "DNBH" || pickCode === "DNBA") && ft.home === ft.away) {
    return { result: "void", note: "Draw No Bet ended level — stake returned" };
  }
  const graded = settlePick(pickCode, ft.home, ft.away);
  if (graded === null) return { result: null, note: "market can't be graded from the score" };
  return { result: graded ? "win" : "loss" };
}

type PendingRow = {
  id: string;
  event_id: string;
  pick_code: string | null;
  kickoff: string;
  settle_attempts?: number | null;
};

export type SettleStats = { checked: number; settled: number; events: number; needsReview: number };

type ResultCache = Map<string, Promise<EventResult | null>>;

async function settleTable(
  table: string,
  v2: boolean,
  cache: ResultCache,
  budgetMs: number,
  limit: number,
): Promise<SettleStats> {
  const stats: SettleStats = { checked: 0, settled: 0, events: 0, needsReview: 0 };
  const sb = auditDb();
  if (!sb || budgetMs < 2_000) return stats;
  const end = Date.now() + budgetMs;
  const left = () => end - Date.now();
  const nowIso = () => new Date().toISOString();

  let query = sb
    .from(table)
    .select(v2 ? "id, event_id, pick_code, kickoff, settle_attempts" : "id, event_id, pick_code, kickoff")
    .eq("result", "pending")
    .is("settled_at", null)
    .not("event_id", "is", null)
    .lt("kickoff", new Date(Date.now() - SETTLE_AFTER_MS).toISOString());
  if (v2) query = query.order("last_checked_at", { ascending: true, nullsFirst: true });
  const res = await withTimeout(query.order("kickoff", { ascending: true }).limit(limit), Math.min(8_000, left()));
  if (!res || res.error || !res.data?.length) {
    if (res?.error) auditWarn(`${table} settle select`, res.error.message);
    return stats;
  }

  const byEvent = new Map<string, PendingRow[]>();
  for (const row of res.data as unknown as PendingRow[]) {
    const list = byEvent.get(row.event_id) ?? [];
    list.push(row);
    byEvent.set(row.event_id, list);
  }

  const strip = (patch: Record<string, unknown>) => {
    if (v2) return patch;
    const { result, final_score, settled_at, settle_note } = patch;
    return Object.fromEntries(
      Object.entries({ result, final_score, settled_at, settle_note }).filter(([, v]) => v !== undefined),
    );
  };

  async function apply(ids: string[], patch: Record<string, unknown>, counts = true) {
    if (!ids.length || left() < 400) return;
    const body = strip(patch);
    if (!Object.keys(body).length) return;
    const r = await withTimeout(
      sb!.from(table).update(body).in("id", ids).eq("result", "pending"),
      Math.min(5_000, left()),
    );
    if (r && !r.error) {
      if (counts) stats.settled += ids.length;
    } else if (r?.error) auditWarn(`${table} settle update`, r.error.message);
  }

  /** Not settled yet: bump the attempt counter so the backlog keeps rotating. */
  async function touch(rows: PendingRow[]) {
    if (!v2) return;
    const byAttempts = new Map<number, string[]>();
    for (const r of rows) {
      const n = (r.settle_attempts ?? 0) + 1;
      byAttempts.set(n, [...(byAttempts.get(n) ?? []), r.id]);
    }
    for (const [n, ids] of byAttempts) await apply(ids, { settle_attempts: n, last_checked_at: nowIso() }, false);
  }

  async function settleEvent(eventId: string, rows: PendingRow[]) {
    stats.checked += rows.length;
    stats.events++;
    let pending = cache.get(eventId);
    if (!pending) {
      pending = fetchEventResult(eventId, Math.min(8_000, left()));
      cache.set(eventId, pending);
    }
    const ev = await withTimeout(pending, Math.min(9_000, left()));
    const oldest = Math.min(...rows.map((r) => Date.parse(r.kickoff) || Date.now()));
    const age = Date.now() - oldest;

    if (ev?.state === "cancelled") {
      await apply(
        rows.map((r) => r.id),
        { result: "cancelled", settled_at: nowIso(), settle_note: `SportyBet status: ${ev.note ?? "cancelled"}`, result_source: "auto" },
      );
      return;
    }

    if (!ev || ev.state !== "ended" || !ev.ft) {
      const attempts = Math.min(...rows.map((r) => r.settle_attempts ?? 0)) + 1;
      if (ev && age > CANCEL_AFTER_MS && (!v2 || attempts >= MIN_CANCEL_ATTEMPTS)) {
        // SportyBet answered, repeatedly, and still has no final result.
        await apply(
          rows.map((r) => r.id),
          { result: "cancelled", settled_at: nowIso(), settle_note: "No final result 72h after kickoff", result_source: "auto" },
        );
      } else if (!ev && v2 && age > CANCEL_AFTER_MS && attempts >= MAX_NO_DATA_ATTEMPTS) {
        // Never cancel on a failed lookup: park it for a human instead.
        stats.needsReview += rows.length;
        await apply(
          rows.map((r) => r.id),
          { settled_at: nowIso(), settle_note: "needs manual grading: SportyBet returned no event data", settle_attempts: attempts, last_checked_at: nowIso() },
          false,
        );
      } else {
        await touch(rows);
      }
      return;
    }

    const finalScore = `${ev.ft.home}-${ev.ft.away}`;
    const htScore = ev.ht ? `${ev.ht.home}-${ev.ht.away}` : null;
    const groups = new Map<string, { patch: Record<string, unknown>; ids: string[] }>();
    const ungraded: PendingRow[] = [];

    for (const row of rows) {
      const g = gradeSelection(row.pick_code, ev.ft, ev.ht);
      if (!g.result) {
        ungraded.push(row);
        continue;
      }
      const note = g.note ?? null;
      const key = `${g.result}|${note ?? ""}`;
      const entry = groups.get(key) ?? {
        patch: {
          result: g.result,
          final_score: finalScore,
          ht_score: htScore,
          settled_at: nowIso(),
          settle_note: note,
          result_source: "auto",
        },
        ids: [],
      };
      entry.ids.push(row.id);
      groups.set(key, entry);
    }
    for (const { patch, ids } of groups.values()) await apply(ids, patch);

    if (ungraded.length) {
      const giveUp = ungraded.filter((r) => (r.settle_attempts ?? 0) + 1 >= MAX_UNGRADED_ATTEMPTS || age > CANCEL_AFTER_MS);
      const retry = ungraded.filter((r) => !giveUp.includes(r));
      if (giveUp.length || !v2) {
        const list = v2 ? giveUp : ungraded;
        stats.needsReview += list.length;
        await apply(
          list.map((r) => r.id),
          {
            final_score: finalScore,
            ht_score: htScore,
            settled_at: nowIso(),
            settle_note: "needs manual grading: half-time score unavailable",
          },
          false,
        );
      }
      if (v2 && retry.length) await touch(retry);
    }
  }

  const events = [...byEvent.entries()];
  for (let i = 0; i < events.length; i += 6) {
    if (left() < 2_500) break;
    await Promise.all(
      events.slice(i, i + 6).map(([id, rows]) => settleEvent(id, rows).catch((e) => auditWarn("settle event", e))),
    );
  }
  return stats;
}

export type ClosingStats = { rows: number; updated: number; feedEvents: number };

/**
 * Record the latest pre-kickoff price for pending predictions. Each run
 * overwrites the previous snapshot, so after kickoff `closing_odds` holds the
 * last price observed before the match started.
 */
export async function snapshotClosingOdds(budgetMs: number): Promise<ClosingStats> {
  const stats: ClosingStats = { rows: 0, updated: 0, feedEvents: 0 };
  try {
    const sb = auditDb();
    if (!sb || auditDisabled() || budgetMs < 4_000) return stats;
    const end = Date.now() + budgetMs;
    const left = () => end - Date.now();
    const schema = await auditSchema();
    const now = Date.now();

    const res = await withTimeout(
      sb
        .from(PREDICTION_LOG_TABLE)
        .select("id, event_id, pick_code, closing_odds")
        .eq("result", "pending")
        .not("event_id", "is", null)
        .not("pick_code", "is", null)
        .gt("kickoff", new Date(now + 60_000).toISOString())
        .lt("kickoff", new Date(now + 6 * 24 * 3_600_000).toISOString())
        .limit(1_500),
      Math.min(6_000, left()),
    );
    if (!res || res.error || !res.data?.length) {
      if (res?.error) auditWarn("closing select", res.error.message);
      return stats;
    }
    const rows = res.data as { id: string; event_id: string; pick_code: string; closing_odds: number | null }[];
    stats.rows = rows.length;

    const feed = await withTimeout(getAllSportyFixtures({ maxPagesPerSport: 5 }), Math.min(25_000, left() - 2_000));
    if (!feed?.length) return stats;
    const byEvent = new Map(feed.map((e) => [e.eventId, e.outcomes]));
    stats.feedEvents = byEvent.size;

    const at = new Date().toISOString();
    const updates = rows
      .map((r) => ({ r, price: byEvent.get(r.event_id)?.[r.pick_code] }))
      .filter((u): u is { r: (typeof rows)[number]; price: number } => Boolean(u.price && u.price > 1));

    for (let i = 0; i < updates.length; i += 8) {
      if (left() < 800) break;
      await Promise.all(
        updates.slice(i, i + 8).map(async ({ r, price }) => {
          const patch: Record<string, unknown> = { closing_odds: Number(price.toFixed(4)) };
          if (schema.v2) Object.assign(patch, { closing_odds_at: at, closing_odds_source: "sportybet-prematch-feed" });
          const u = await withTimeout(
            sb.from(PREDICTION_LOG_TABLE).update(patch).eq("id", r.id).eq("result", "pending"),
            Math.min(4_000, left()),
          );
          if (u && !u.error) stats.updated++;
        }),
      );
    }
    return stats;
  } catch (e) {
    auditWarn("closing odds", e);
    return stats;
  }
}

export type MaintenanceResult = {
  closing: ClosingStats;
  predictions: SettleStats;
  candidates: SettleStats;
  ms: number;
};

/**
 * One maintenance pass: closing-odds snapshot, then settle published
 * predictions first, then the candidate universe with whatever time is left.
 * Never throws.
 */
export async function runAuditMaintenance(opts: {
  budgetMs: number;
  closing?: boolean;
}): Promise<MaintenanceResult> {
  const started = Date.now();
  const empty: SettleStats = { checked: 0, settled: 0, events: 0, needsReview: 0 };
  const out: MaintenanceResult = {
    closing: { rows: 0, updated: 0, feedEvents: 0 },
    predictions: { ...empty },
    candidates: { ...empty },
    ms: 0,
  };
  try {
    if (auditDisabled() || opts.budgetMs < 2_000) return out;
    const left = () => opts.budgetMs - (Date.now() - started);
    const schema = await auditSchema();
    const cache: ResultCache = new Map();

    if (opts.closing !== false && left() > 12_000) {
      out.closing = await snapshotClosingOdds(Math.min(30_000, left() * 0.35));
    }
    out.predictions = await settleTable(PREDICTION_LOG_TABLE, schema.v2, cache, Math.min(45_000, left() * 0.6), 400);
    if (schema.candidates && left() > 4_000) {
      out.candidates = await settleTable(CANDIDATES_TABLE, true, cache, left() - 1_000, 1_500);
    }
  } catch (e) {
    auditWarn("maintenance", e);
  }
  out.ms = Date.now() - started;
  return out;
}
