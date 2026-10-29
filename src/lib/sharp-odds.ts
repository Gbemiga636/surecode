/**
 * Brief v3 Phase 0 / C1 / C2: sharp (Pinnacle) prices next to SportyBet's.
 *
 * Provider: pinnodds.com (Pinnacle prematch board, one request per sport;
 * trial key = 100 requests/day). Configure with SHARP_ODDS_API_KEY (and
 * optionally SHARP_ODDS_BASE_URL, SHARP_SPORTS, SHARP_PROBE,
 * SHARP_CLOSE_WINDOW_MIN). Sharp prices are internal only — check the
 * provider licence before showing any of them to users.
 *
 * Each run: in-scope candidates (upcoming, any sport we log) → SportyBet
 * prices now → sharp boards now → event map (normalised names, kickoff
 * ±15 min) → Phase 0 price pairs, sharp captures at creation / close, and
 * H3 shadow rows once H3 is frozen. Never throws.
 */
import { getAllSportyFixtures, type SportKey } from "./sporty";
import {
  CANDIDATES_TABLE,
  EVENT_MAP_TABLE,
  LINE_PROBE_TABLE,
  SHADOW_TABLE,
  SHARP_ODDS_TABLE,
  auditDb,
  auditDisabled,
  auditSchema,
  auditWarn,
  upsertChunks,
  withTimeout,
} from "./audit-db";
import { P_FAIR_METHOD } from "./devig";
import { matchSharpEvent, matchesHypothesis, sharpFairForPick, type MatchableEvent, type SharpPeriod } from "./eval-v3";
import { activeHypotheses } from "./shadow-log";

const PINNODDS_SPORT: Record<string, number> = { football: 1, tennis: 2, basketball: 3, hockey: 4, baseball: 6 };
const SOURCE = "pinnacle";

type SharpEvent = MatchableEvent & { league: string; periods: Record<string, SharpPeriod> };

export type SharpRunStats = {
  ok: boolean;
  reason?: string;
  requests: number;
  rate_limited: boolean;
  candidates: number;
  candidate_events: number;
  sharp_events: number;
  mapped_events: number;
  new_mappings: number;
  coverage: number | null;
  probe_pairs: number;
  sharp_rows: number;
  shadow_rows: number;
  by_sport: Record<string, { candidate_events: number; sharp_events: number; mapped: number }>;
  ms: number;
};

async function fetchBoard(sport: string, key: string, ms: number): Promise<{ events: SharpEvent[]; status: number } | null> {
  const id = PINNODDS_SPORT[sport];
  if (!id) return null;
  const base = (process.env.SHARP_ODDS_BASE_URL || "https://pinnodds.com").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, ms));
  try {
    const res = await fetch(`${base}/kit/v1/prematch/fixtures?sport_id=${id}`, {
      headers: { "x-portal-apikey": key, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return { events: [], status: res.status };
    const json = (await res.json()) as { events?: Record<string, unknown>[] };
    const events: SharpEvent[] = [];
    for (const e of json.events ?? []) {
      const kickoffMs = Date.parse(String(e.starts ?? e.start_ts ?? ""));
      if (!e.event_id || !e.home || !e.away || !Number.isFinite(kickoffMs) || !e.periods) continue;
      events.push({
        id: String(e.event_id),
        home: String(e.home),
        away: String(e.away),
        kickoffMs,
        league: String(e.league_name ?? ""),
        periods: e.periods as Record<string, SharpPeriod>,
      });
    }
    return { events, status: res.status };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type Cand = { event_id: string; pick_code: string; fixture: string | null; sport: string | null; league: string | null; kickoff: string; evaluated_at: string; market: string | null; odds: number | null };

function splitFixture(f: string | null): [string, string] | null {
  const parts = String(f ?? "").split(" v ");
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null;
}

export async function runSharpCapture(budgetMs: number): Promise<SharpRunStats> {
  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);
  const stats: SharpRunStats = {
    ok: false,
    requests: 0,
    rate_limited: false,
    candidates: 0,
    candidate_events: 0,
    sharp_events: 0,
    mapped_events: 0,
    new_mappings: 0,
    coverage: null,
    probe_pairs: 0,
    sharp_rows: 0,
    shadow_rows: 0,
    by_sport: {},
    ms: 0,
  };
  const done = (reason?: string) => ({ ...stats, ok: !reason, ...(reason ? { reason } : {}), ms: Date.now() - started });
  try {
    const key = (process.env.SHARP_ODDS_API_KEY || "").trim();
    if (!key) return done("SHARP_ODDS_API_KEY is not set");
    const sb = auditDb();
    if (!sb || auditDisabled()) return done("audit database unavailable");
    const schema = await auditSchema();
    if (!schema.evalV3) return done("run sql/schema-eval-v3.sql first");

    const wanted = (process.env.SHARP_SPORTS || "football,tennis,basketball,hockey")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => PINNODDS_SPORT[s]);
    const now = Date.now();

    // In-scope candidates: upcoming in the next 48h, logged in the last 36h.
    const cands: Cand[] = [];
    for (let from = 0; from < 20_000 && left() > 20_000; from += 1_000) {
      const res = await withTimeout(
        sb
          .from(CANDIDATES_TABLE)
          .select("event_id, pick_code, fixture, sport, league, kickoff, evaluated_at, market, odds")
          .gt("kickoff", new Date(now).toISOString())
          .lt("kickoff", new Date(now + 48 * 3_600_000).toISOString())
          .gt("created_at", new Date(now - 36 * 3_600_000).toISOString())
          .in("sport", wanted)
          .order("id")
          .range(from, from + 999),
        Math.min(8_000, left()),
      );
      if (!res || res.error) break;
      cands.push(...((res.data ?? []) as Cand[]));
      if ((res.data ?? []).length < 1_000) break;
    }
    const uniq = new Map<string, Cand>();
    for (const c of cands) {
      const k = `${c.event_id}|${c.pick_code}`;
      const cur = uniq.get(k);
      if (!cur || Date.parse(c.evaluated_at) < Date.parse(cur.evaluated_at)) uniq.set(k, c);
    }
    const selections = [...uniq.values()];
    const eventsById = new Map(selections.map((c) => [c.event_id, c]));
    stats.candidates = selections.length;
    stats.candidate_events = eventsById.size;
    if (!selections.length) return done();
    const sports = wanted.filter((s) => selections.some((c) => c.sport === s));

    // SportyBet now, then the sharp boards now (seconds apart).
    const sportyAt = new Date().toISOString();
    const feed = await withTimeout(getAllSportyFixtures({ sports: sports as SportKey[], maxPagesPerSport: 5 }), Math.min(25_000, left() - 15_000));
    const sportyPrice = new Map((feed ?? []).map((e) => [e.eventId, e.outcomes]));

    const boards = new Map<string, SharpEvent[]>();
    for (const sport of sports) {
      if (left() < 8_000) break;
      const b = await fetchBoard(sport, key, Math.min(10_000, left() - 5_000));
      stats.requests++;
      if (b?.status === 429) {
        stats.rate_limited = true;
        break;
      }
      if (b?.events.length) boards.set(sport, b.events);
    }
    const sharpAt = new Date().toISOString();
    stats.sharp_events = [...boards.values()].reduce((a, l) => a + l.length, 0);
    if (!boards.size) return done(stats.rate_limited ? "sharp provider rate limit reached" : "no sharp events returned");

    // C2: existing map first, then match the rest.
    const ids = [...eventsById.keys()];
    const mapped = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 300) {
      const res = await withTimeout(
        sb.from(EVENT_MAP_TABLE).select("sportybet_event_id, sharp_event_id").in("sportybet_event_id", ids.slice(i, i + 300)),
        Math.min(5_000, left()),
      );
      for (const r of (res && !res.error ? res.data : []) ?? []) mapped.set(r.sportybet_event_id as string, r.sharp_event_id as string);
    }
    const sharpById = new Map<string, SharpEvent>();
    for (const list of boards.values()) for (const e of list) sharpById.set(e.id, e);
    const newMaps: Record<string, unknown>[] = [];
    for (const [id, c] of eventsById) {
      if (mapped.has(id)) continue;
      const names = splitFixture(c.fixture);
      const pool = boards.get(String(c.sport));
      if (!names || !pool) continue;
      const m = matchSharpEvent({ id, home: names[0], away: names[1], kickoffMs: Date.parse(c.kickoff) }, pool);
      if (!m) continue;
      mapped.set(id, m.event.id);
      newMaps.push({
        sportybet_event_id: id,
        sharp_event_id: m.event.id,
        source: SOURCE,
        method: "name+kickoff",
        confidence: m.confidence,
        sportybet_fixture: c.fixture,
        sharp_fixture: `${m.event.home} v ${m.event.away}`,
        sportybet_kickoff: c.kickoff,
        sharp_kickoff: new Date(m.event.kickoffMs).toISOString(),
      });
    }
    if (newMaps.length) {
      const r = await upsertChunks(EVENT_MAP_TABLE, newMaps, { onConflict: "sportybet_event_id", ignoreDuplicates: true, timeoutMs: Math.min(6_000, left()) });
      if (r.error) auditWarn("event map insert", r.error);
      stats.new_mappings = r.written;
    }
    for (const sport of sports) {
      const evs = [...eventsById.values()].filter((c) => c.sport === sport);
      stats.by_sport[sport] = {
        candidate_events: evs.length,
        sharp_events: boards.get(sport)?.length ?? 0,
        mapped: evs.filter((c) => mapped.has(c.event_id) && sharpById.has(mapped.get(c.event_id)!)).length,
      };
    }
    stats.mapped_events = Object.values(stats.by_sport).reduce((a, s) => a + s.mapped, 0);
    stats.coverage = stats.candidate_events ? Math.round((stats.mapped_events / stats.candidate_events) * 10_000) / 10_000 : null;

    // Which selections already have a creation capture.
    const haveCreation = new Set<string>();
    const mappedIds = ids.filter((id) => mapped.has(id));
    for (let i = 0; i < mappedIds.length; i += 300) {
      const res = await withTimeout(
        sb.from(SHARP_ODDS_TABLE).select("sportybet_event_id, outcome").eq("phase", "creation").in("sportybet_event_id", mappedIds.slice(i, i + 300)),
        Math.min(5_000, left()),
      );
      for (const r of (res && !res.error ? res.data : []) ?? []) haveCreation.add(`${r.sportybet_event_id}|${r.outcome}`);
    }

    const closeWindow = (Number(process.env.SHARP_CLOSE_WINDOW_MIN) || 70) * 60_000;
    const probeOn = process.env.SHARP_PROBE !== "0";
    const h3 = (await activeHypotheses()).filter((h) => h.definition.kind === "sharp_value");
    const gapMinutes = Math.abs(Date.parse(sharpAt) - Date.parse(sportyAt)) / 60_000;
    const sharpRows: Record<string, unknown>[] = [];
    const probeRows: Record<string, unknown>[] = [];
    const shadowRows: Record<string, unknown>[] = [];

    for (const c of selections) {
      const sharpId = mapped.get(c.event_id);
      const ev = sharpId ? sharpById.get(sharpId) : undefined;
      if (!ev) continue;
      const fair = sharpFairForPick(ev.periods, c.pick_code, P_FAIR_METHOD);
      if (!fair) continue;
      const kickoff = Date.parse(c.kickoff);
      const k = `${c.event_id}|${c.pick_code}`;
      const base = { event_key: ev.id, source: SOURCE, market: c.market ?? "?", outcome: c.pick_code, odds: fair.odds, fair_prob: Number(fair.fair.toFixed(6)), sportybet_event_id: c.event_id, captured_at: sharpAt };
      if (!haveCreation.has(k)) sharpRows.push({ ...base, phase: "creation" });
      if (kickoff - now <= closeWindow) sharpRows.push({ ...base, phase: "close" });

      const sporty = sportyPrice.get(c.event_id)?.[c.pick_code];
      if (sporty && sporty > 1) {
        if (probeOn && kickoff - now <= 12 * 3_600_000) {
          probeRows.push({
            sportybet_event_id: c.event_id,
            sharp_event_id: ev.id,
            sport: c.sport,
            league: c.league,
            pick_code: c.pick_code,
            sporty_odds: sporty,
            sporty_captured_at: sportyAt,
            sharp_fair_prob: base.fair_prob,
            sharp_captured_at: sharpAt,
            kickoff: c.kickoff,
          });
        }
        for (const h of h3) {
          if (!matchesHypothesis(h, { market: c.market, sport: c.sport, odds: sporty, p_fair: null }, { fair: fair.fair, gapMinutes })) continue;
          if (Date.parse(sportyAt) <= Date.parse(String(h.frozen_at))) continue;
          shadowRows.push({
            hypothesis_id: h.id,
            event_id: c.event_id,
            fixture: c.fixture,
            sport: c.sport,
            league: c.league,
            market: c.market,
            pick_code: c.pick_code,
            odds: sporty,
            sharp_fair_prob: base.fair_prob,
            sharp_captured_at: sharpAt,
            kickoff: c.kickoff,
            created_at: sportyAt,
          });
        }
      }
    }

    const write = async (table: string, rows: Record<string, unknown>[], conflict?: string) => {
      if (!rows.length || left() < 1_000) return 0;
      const sbx = auditDb()!;
      let written = 0;
      for (let i = 0; i < rows.length && left() > 800; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const res = await withTimeout(
          conflict ? sbx.from(table).upsert(chunk, { onConflict: conflict, ignoreDuplicates: true }) : sbx.from(table).insert(chunk),
          Math.min(8_000, left()),
        );
        if (res && !res.error) written += chunk.length;
        else if (res?.error) auditWarn(`${table} insert`, res.error.message);
      }
      return written;
    };
    stats.sharp_rows = await write(SHARP_ODDS_TABLE, sharpRows);
    stats.probe_pairs = await write(LINE_PROBE_TABLE, probeRows);
    stats.shadow_rows = await write(SHADOW_TABLE, shadowRows, "hypothesis_id,event_id,pick_code");
    return done();
  } catch (e) {
    auditWarn("sharp capture", e);
    return done("unexpected error");
  }
}
