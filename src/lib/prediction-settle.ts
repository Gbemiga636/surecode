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
import { RESCHEDULED_NOTE_PREFIX } from "./prediction-report";

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
/** SportyBet keeps answering without a final result this long after kickoff → parked for manual grading. */
const PARK_AFTER_MS = 6 * 3_600_000;
/** Parked "no final result" rows are re-checked for this long, so a late result still grades automatically. */
const PARKED_RETRY_MS = 7 * 24 * 3_600_000;
/** A match moved further than this from the logged kickoff is void (standard postponement rule). */
const POSTPONED_VOID_MS = 48 * 3_600_000;
/** Markets that need a half-time score stop retrying after this many checks. */
const MAX_UNGRADED_ATTEMPTS = 6;
/** Checks (with an answer from SportyBet) needed before a row is parked. */
const MIN_PARK_ATTEMPTS = 3;
/** Failed lookups past the park window before a row is parked for manual grading. */
const MAX_NO_DATA_ATTEMPTS = 12;
/** Fake cancellations written by the old 72h rule; reset once so the fixed settler grades them. */
export const STALE_CANCEL_NOTE = "No final result 72h after kickoff";
export const NO_RESULT_PARK_NOTE = "needs manual grading: no final result from SportyBet";

type Score = { home: number; away: number };
export type EventSport = "football" | "basketball" | "tennis" | "hockey" | "baseball";

export type EventResult = {
  state: "ended" | "live" | "not_started" | "postponed" | "cancelled" | "unknown";
  /** Final score including overtime / extra innings (sets for tennis). */
  ft: Score | null;
  /** Regulation-time score (90 min, 3 periods, 9 innings). Null when it can't be established. */
  regular: Score | null;
  ht: Score | null;
  sport: EventSport | null;
  /** SportyBet's current scheduled start (ms), which moves when a match is rescheduled. */
  startTime: number | null;
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

const SPORT_IDS: Record<string, EventSport> = {
  "sr:sport:1": "football",
  "sr:sport:2": "basketball",
  "sr:sport:3": "baseball",
  "sr:sport:4": "hockey",
  "sr:sport:5": "tennis",
};

/** Periods that make up regulation time; every market except basketball / tennis Winner settles on it. */
const REGULATION_PERIODS: Partial<Record<EventSport, number>> = { football: 2, hockey: 3, baseball: 9 };

const sumScores = (xs: Score[]): Score => xs.reduce((a, p) => ({ home: a.home + p.home, away: a.away + p.away }), { home: 0, away: 0 });
const sameScore = (a: Score, b: Score) => a.home === b.home && a.away === b.away;

/** Inning / period list. Baseball marks an unplayed half-inning "X" (0 runs); anything else unreadable voids the list. */
function parsePeriods(raw: unknown[]): Score[] | null {
  const out: Score[] = [];
  for (const v of raw) {
    const p = parseScorePair(v);
    if (p) out.push(p);
    else {
      const m = String(v ?? "").match(/^\s*(\d+|x)\s*[-:]\s*(\d+|x)\s*$/i);
      if (!m) return null;
      out.push({ home: Number(m[1]) || 0, away: Number(m[2]) || 0 });
    }
  }
  return out;
}

function playedMinutes(v: unknown): number | null {
  const m = String(v ?? "").match(/^(\d+):(\d{2})$/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

function bestOfFive(d: Record<string, unknown>): boolean {
  const sport = (d.sport ?? {}) as { category?: { name?: string; tournament?: { name?: string } } };
  const name = `${sport.category?.name ?? ""} ${sport.category?.tournament?.name ?? ""}`;
  return /australian open|roland garros|french open|wimbledon|us open|davis cup/i.test(name) && !/wta|women|ladies|itf|mixed|doubles/i.test(name);
}

/**
 * Turn a SportyBet event payload into a gradeable result (pure, for tests).
 * Handles what the old rules missed: "PostMatch" as ended, ITF feeds that
 * stall on a decided set score, rescheduled matches, and regulation-time
 * scores for hockey overtime / extra innings / football extra time.
 */
export function parseEventResult(d: Record<string, unknown>): EventResult {
  const statusNum = Number(d.status);
  const matchStatus = String(d.matchStatus ?? "").toLowerCase();
  const period = String(d.period ?? "").toLowerCase();
  const sport = SPORT_IDS[String((d.sport as { id?: string } | undefined)?.id ?? "")] ?? null;
  const startTime = Number(d.estimateStartTime) || null;
  const base = { sport, startTime, regular: null, ht: null } as const;

  if (/cancel|abandon/.test(matchStatus)) return { ...base, state: "cancelled", ft: null, note: String(d.matchStatus) };
  if (/retire|walkover|w\.o\./.test(matchStatus)) return { ...base, state: "unknown", ft: null, note: `retirement / walkover (${d.matchStatus})` };
  if (/postpon|delayed|interrupt|suspend/.test(matchStatus)) return { ...base, state: "postponed", ft: null, note: String(d.matchStatus) };

  let ft: Score | null = null;
  const h = Number(d.homeScore);
  const a = Number(d.awayScore);
  if (Number.isFinite(h) && Number.isFinite(a) && d.homeScore != null && d.awayScore != null) ft = { home: h, away: a };
  else if (d.setScore) ft = parseScorePair(d.setScore);

  let ended =
    statusNum === 4 || /ended|finished|closed|postmatch|post match|after|aet|\bap\b/.test(matchStatus) || period === "postmatch";
  let note: string | undefined;

  if (!ended && !ft && (statusNum === 0 || /not start/.test(matchStatus))) return { ...base, state: "not_started", ft: null };

  // ITF feeds often freeze on "set 2" after the last point; a decided set score is final.
  if (!ended && ft && sport === "tennis") {
    const need = bestOfFive(d) ? 3 : 2;
    if (Math.max(ft.home, ft.away) >= need && ft.home !== ft.away) {
      ended = true;
      note = "final inferred from decided set score (feed did not flip to Ended)";
    }
  }

  const rawPeriods = Array.isArray(d.gameScore) ? d.gameScore : Array.isArray(d.periodScores) ? d.periodScores : [];
  const periods = parsePeriods(rawPeriods) ?? [];
  const periodsMatchFinal = Boolean(ft && periods.length && sameScore(sumScores(periods), ft));

  let ht: Score | null = null;
  if (ft && sport !== "tennis" && sport !== "baseball" && periodsMatchFinal && periods.length >= 2) {
    // Football: first period is the first half (also when extra-time periods follow).
    if (sport === "football" || periods.length === 2) ht = periods[0];
  }

  let regular: Score | null = ft;
  const regPeriods = sport ? REGULATION_PERIODS[sport] : undefined;
  if (ft && regPeriods) {
    const statusText = `${matchStatus} ${period}`;
    const extraByText =
      sport === "hockey"
        ? /overtime|\bot\b|shootout|penalt|\bso\b|aet/.test(statusText)
        : sport === "football"
          ? /aet|after extra|extra time|penalt|\bap\b/.test(statusText)
          : /extra/.test(statusText);
    const mins = playedMinutes(d.playedSeconds);
    const extra = extraByText || (sport === "hockey" && mins != null && mins > 60.5);
    if (periodsMatchFinal && periods.length >= regPeriods) {
      regular = sumScores(periods.slice(0, regPeriods));
    } else if (extra && sport === "hockey" && Math.abs(ft.home - ft.away) === 1) {
      // Sudden-death overtime and shootouts add exactly one goal to the winner.
      regular = ft.home > ft.away ? { home: ft.home - 1, away: ft.away } : { home: ft.home, away: ft.away - 1 };
    } else if (extra) {
      regular = null;
    }
  }

  if (!ft) return { ...base, state: ended ? "unknown" : "live", ft: null };
  return { state: ended ? "ended" : "live", ft, regular, ht, sport, startTime, ...(note ? { note } : {}) };
}

/** Final, regulation and (when SportyBet provides period scores) half-time result. */
export async function fetchEventResult(eventId: string, ms = 8_000): Promise<EventResult | null> {
  const d = await fetchEventJson(eventId, ms);
  return d ? parseEventResult(d) : null;
}

/** Logged kickoff vs SportyBet's current start: how far the match was moved (ms), or null. */
export function rescheduledBy(ev: Pick<EventResult, "state" | "startTime">, loggedKickoffMs: number): number | null {
  if ((ev.state !== "not_started" && ev.state !== "postponed") || !ev.startTime || !Number.isFinite(loggedKickoffMs)) return null;
  const moved = ev.startTime - loggedKickoffMs;
  return moved > 30 * 60_000 ? moved : null;
}

const FIRST_HALF = new Set(["1HO05", "1HDC1X", "1HDCX2"]);
/** Winner markets (basketball incl. overtime, tennis) settle on the final result; everything else on regulation time. */
const FULL_MATCH_MARKETS = new Set(["BBH", "BBA", "TNH", "TNA"]);

/** Score a market settles on: final for Winner markets, regulation time otherwise. */
export function settlementScore(pickCode: string | null, ev: Pick<EventResult, "ft" | "regular">): Score | null {
  return pickCode && FULL_MATCH_MARKETS.has(pickCode) ? ev.ft : ev.regular;
}

/** Grade one selection. `null` result = can't be graded from what we have. */
export function gradeSelection(
  pickCode: string | null,
  ft: Score | null,
  ht: Score | null,
): { result: LogResult | null; note?: string } {
  if (!pickCode || !PICKS[pickCode]) return { result: null, note: "unknown market code" };
  if (!ft) return { result: null, note: "regulation-time score unavailable" };
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

const V1_SETTLE_COLUMNS = ["result", "final_score", "settled_at", "settle_note"];
/** prediction_candidates has no result_source column. */
const CANDIDATE_EXCLUDED_COLUMNS = ["result_source"];

/** The subset of a settlement patch the target table can accept. */
export function settlePatchFor(table: string, v2: boolean, patch: Record<string, unknown>): Record<string, unknown> {
  const keep = ([k, v]: [string, unknown]) =>
    v !== undefined &&
    (v2 ? !(table === CANDIDATES_TABLE && CANDIDATE_EXCLUDED_COLUMNS.includes(k)) : V1_SETTLE_COLUMNS.includes(k));
  return Object.fromEntries(Object.entries(patch).filter(keep));
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

  const columns = v2 ? "id, event_id, pick_code, kickoff, settle_attempts" : "id, event_id, pick_code, kickoff";
  let query = sb
    .from(table)
    .select(columns)
    .eq("result", "pending")
    .is("settled_at", null)
    .not("event_id", "is", null)
    .lt("kickoff", new Date(Date.now() - SETTLE_AFTER_MS).toISOString());
  if (v2) query = query.order("last_checked_at", { ascending: true, nullsFirst: true });
  const res = await withTimeout(query.order("kickoff", { ascending: true }).limit(limit), Math.min(8_000, left()));
  if (!res || res.error) {
    if (res?.error) auditWarn(`${table} settle select`, res.error.message);
    return stats;
  }
  const due = [...((res.data ?? []) as unknown as PendingRow[])];

  // Parked "no final result" rows get re-checked for a week so late results still grade automatically.
  if (v2 && left() > 4_000) {
    const parked = await withTimeout(
      sb
        .from(table)
        .select(columns)
        .eq("result", "pending")
        .eq("settle_note", NO_RESULT_PARK_NOTE)
        .gt("kickoff", new Date(Date.now() - PARKED_RETRY_MS).toISOString())
        .order("last_checked_at", { ascending: true, nullsFirst: true })
        .limit(Math.max(20, Math.floor(limit / 4))),
      Math.min(6_000, left()),
    );
    if (parked && !parked.error) due.push(...((parked.data ?? []) as unknown as PendingRow[]));
  }
  if (!due.length) return stats;

  const byEvent = new Map<string, PendingRow[]>();
  for (const row of due) {
    const list = byEvent.get(row.event_id) ?? [];
    if (!list.some((r) => r.id === row.id)) list.push(row);
    byEvent.set(row.event_id, list);
  }

  async function apply(ids: string[], patch: Record<string, unknown>, counts = true) {
    if (!ids.length || left() < 400) return;
    const body = settlePatchFor(table, v2, patch);
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
    const ids = rows.map((r) => r.id);

    if (ev?.state === "cancelled") {
      await apply(ids, { result: "cancelled", settled_at: nowIso(), settle_note: `SportyBet status: ${ev.note ?? "cancelled"}`, result_source: "auto" });
      return;
    }

    if (ev && (ev.state === "not_started" || ev.state === "postponed")) {
      const moved = rescheduledBy(ev, oldest);
      if ((moved != null && moved > POSTPONED_VOID_MS) || (ev.state === "postponed" && age > POSTPONED_VOID_MS)) {
        const when = ev.startTime ? ` (now ${new Date(ev.startTime).toISOString()})` : "";
        await apply(ids, { result: "void", settled_at: nowIso(), settle_note: `postponed more than 48h after the logged kickoff${when}`, result_source: "auto" });
        return;
      }
      if (moved != null && ev.startTime) {
        // Kept pending against the new start time; the report measures "overdue" from it.
        await apply(ids, { settle_note: `${RESCHEDULED_NOTE_PREFIX}${new Date(ev.startTime).toISOString()}` }, false);
        await touch(rows);
        return;
      }
    }

    if (!ev || ev.state !== "ended" || !ev.ft) {
      const attempts = Math.min(...rows.map((r) => r.settle_attempts ?? 0)) + 1;
      if (ev && age > PARK_AFTER_MS && (!v2 || attempts >= MIN_PARK_ATTEMPTS)) {
        // SportyBet answers but has no final result: never invent a cancellation, park for a human
        // (parked rows keep being re-checked, so a late result still grades automatically).
        stats.needsReview += rows.length;
        await apply(
          ids,
          {
            settled_at: nowIso(),
            settle_note: ev.note?.startsWith("retirement") ? `needs manual grading: ${ev.note}` : NO_RESULT_PARK_NOTE,
            settle_attempts: attempts,
            last_checked_at: nowIso(),
          },
          false,
        );
      } else if (!ev && v2 && age > PARK_AFTER_MS && attempts >= MAX_NO_DATA_ATTEMPTS) {
        stats.needsReview += rows.length;
        await apply(
          ids,
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
    const ungraded: { row: PendingRow; note: string }[] = [];

    for (const row of rows) {
      const g = gradeSelection(row.pick_code, settlementScore(row.pick_code, ev), ev.ht);
      if (!g.result) {
        ungraded.push({ row, note: g.note ?? "market can't be graded from the score" });
        continue;
      }
      const regNote =
        ev.regular && !sameScore(ev.regular, ev.ft) && !FULL_MATCH_MARKETS.has(row.pick_code ?? "")
          ? `graded on regulation time ${ev.regular.home}-${ev.regular.away}`
          : null;
      const note = [g.note, regNote, ev.note].filter(Boolean).join("; ") || null;
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
      const giveUp = ungraded.filter(({ row }) => (row.settle_attempts ?? 0) + 1 >= MAX_UNGRADED_ATTEMPTS || age > PARK_AFTER_MS);
      const retry = ungraded.filter((u) => !giveUp.includes(u)).map((u) => u.row);
      const list = v2 ? giveUp : ungraded;
      stats.needsReview += list.length;
      const byNote = new Map<string, string[]>();
      for (const { row, note } of list) byNote.set(note, [...(byNote.get(note) ?? []), row.id]);
      for (const [note, noteIds] of byNote) {
        await apply(
          noteIds,
          { final_score: finalScore, ht_score: htScore, settled_at: nowIso(), settle_note: `needs manual grading: ${note}` },
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

/**
 * Undo the old rule that turned "no final result after 72h" into `cancelled`.
 * Only rows carrying exactly that automatic note are touched (never a manual
 * or SportyBet-confirmed cancellation); they go back to pending for the
 * settler. Returns rows reset per table.
 */
export async function resetStaleCancellations(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const sb = auditDb();
  if (!sb || auditDisabled()) return out;
  const schema = await auditSchema();
  const tables: [string, boolean][] = [[PREDICTION_LOG_TABLE, schema.v2]];
  if (schema.candidates) tables.push([CANDIDATES_TABLE, true]);
  for (const [table, v2] of tables) {
    const patch = settlePatchFor(table, v2, {
      result: "pending",
      settled_at: null,
      final_score: null,
      settle_note: null,
      result_source: null,
      settle_attempts: 0,
      last_checked_at: null,
    });
    const res = await withTimeout(
      sb.from(table).update(patch, { count: "exact" }).eq("result", "cancelled").eq("settle_note", STALE_CANCEL_NOTE),
      15_000,
    );
    if (res?.error) auditWarn(`${table} reset stale cancels`, res.error.message);
    out[table] = res && !res.error ? (res.count ?? 0) : 0;
  }
  return out;
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
  /** Spend the whole budget on the candidate backlog (no closing odds, no published predictions). */
  candidatesOnly?: boolean;
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

    if (opts.candidatesOnly) {
      if (schema.candidates) out.candidates = await settleTable(CANDIDATES_TABLE, true, cache, left() - 1_000, 3_000);
      out.ms = Date.now() - started;
      return out;
    }
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
