/**
 * Builds the day's Safe combo (see safe-combo.ts) after the crawl has booked
 * the engine's Safe slips. Reads only what the engine already produced —
 * its Safe slips and the Safe candidates it logged — re-prices every leg live,
 * books the codes and stores the result in sc_pick_pools. The engine and its
 * evaluation are untouched; combo legs are logged under their own source.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { T } from "./db";
import { PICKS, createBookingCode, pickLabel, readMarketBook, sportyOpenUrl, type MarketBook, type SportKey } from "./sporty";
import { snapshotFromBook } from "./market-snapshot";
import { chatJson } from "./openai";
import { logPredictions, type LogSlip } from "./prediction-log";
import {
  SAFE_COMBO,
  bestPerEvent,
  chooseSafeCombo,
  chooseSinglePicks,
  rankSurest,
  safeComboSignature,
  safeLegProblem,
  type SafeComboPayload,
  type SafeComboPick,
  type SafeLeg,
} from "./safe-combo";

const EVENT_API = "https://www.sportybet.com/api/ng/factsCenter/event?eventId=";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.sportybet.com/",
  ClientId: "web",
};
/** A build stuck in "building" longer than this is treated as dead. */
const BUILD_LOCK_MS = 4 * 60_000;
/** An empty result for unchanged Safe codes is retried after this long. */
const EMPTY_RETRY_MS = 90 * 60_000;
const MAX_EVENTS = 40;
const SPORT_LABEL: Record<string, string> = {
  football: "Football",
  basketball: "Basketball",
  tennis: "Tennis",
  hockey: "Ice Hockey",
  baseball: "Baseball",
};

export const safeComboPoolId = (day: string) => `safe-combo:${day}`;

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function prevDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

type RawLeg = {
  eventId: string;
  pickCode: string;
  home: string;
  away: string;
  league?: string;
  sport?: string;
  sportLabel?: string;
  kickoff: number;
  engine: boolean;
};

type LiveEvent = { book: MarketBook; home?: string; away?: string; kickoff?: number };

async function fetchLiveEvent(eventId: string, ms: number): Promise<LiveEvent | null> {
  try {
    const res = await fetch(EVENT_API + encodeURIComponent(eventId), {
      headers: HEADERS,
      signal: AbortSignal.timeout(Math.max(1_000, ms)),
    });
    const json = (await res.json()) as {
      data?: { markets?: unknown; status?: number; homeTeamName?: string; awayTeamName?: string; estimateStartTime?: number };
    };
    const d = json?.data;
    if (!d || Number(d.status) !== 0) return null; // pre-match only
    return {
      book: readMarketBook(d.markets),
      home: d.homeTeamName ? String(d.homeTeamName) : undefined,
      away: d.awayTeamName ? String(d.awayTeamName) : undefined,
      kickoff: Number(d.estimateStartTime) || undefined,
    };
  } catch {
    return null;
  }
}

/** The engine's booked Safe slips (slots 1–3) for the day and their legs. */
async function loadSafeSlips(sb: SupabaseClient, day: string) {
  const raw: RawLeg[] = [];
  const { data: codes } = await sb.from(T.sureCodes).select("slot, code, legs").eq("day", day).gte("slot", 1).lte("slot", 3);
  const safeCodes: string[] = [];
  for (const row of codes ?? []) {
    if (row.code) safeCodes.push(String(row.code));
    for (const l of (Array.isArray(row.legs) ? row.legs : []) as Record<string, unknown>[]) {
      if (!l?.eventId || !l.pickCode) continue;
      raw.push({
        eventId: String(l.eventId),
        pickCode: String(l.pickCode),
        home: String(l.home ?? ""),
        away: String(l.away ?? ""),
        league: l.league ? String(l.league) : undefined,
        sport: l.sport ? String(l.sport) : undefined,
        sportLabel: l.sportLabel ? String(l.sportLabel) : undefined,
        kickoff: Number(l.kickoff) || 0,
        engine: true,
      });
    }
  }
  return { safeCodes, legs: raw };
}

/** Every Safe candidate the engine logged that passed the leg filters, merged with its own slip legs. */
async function loadSafeCandidates(sb: SupabaseClient, day: string, now: number, slipLegs: RawLeg[]): Promise<RawLeg[]> {
  const raw: RawLeg[] = [...slipLegs];
  const { data: cands, error } = await sb
    .from("prediction_candidates")
    .select("event_id, fixture, sport, league, kickoff, pick_code, odds, status, stage, rejection_reason")
    .in("day", [day, prevDay(day)])
    .eq("product_tier", "safe")
    .in("stage", ["pool", "slip"])
    .gt("kickoff", new Date(now + SAFE_COMBO.kickoffBufferMs).toISOString())
    .limit(2000);
  if (error) console.warn("[safe-combo] candidates:", error.message);
  for (const c of cands ?? []) {
    if (!c.event_id || !c.pick_code || !PICKS[c.pick_code]) continue;
    if (String(c.rejection_reason ?? "").includes("AI play-out veto")) continue;
    const [home, away] = String(c.fixture ?? "").split(" v ");
    raw.push({
      eventId: String(c.event_id),
      pickCode: String(c.pick_code),
      home: home ?? "",
      away: away ?? "",
      league: c.league ?? undefined,
      sport: c.sport ?? undefined,
      kickoff: Date.parse(String(c.kickoff)) || 0,
      engine: c.status === "selected",
    });
  }

  const seen = new Map<string, RawLeg>();
  for (const l of raw) {
    const k = `${l.eventId}|${l.pickCode}`;
    const cur = seen.get(k);
    if (!cur) seen.set(k, l);
    else if (l.engine && !cur.engine) seen.set(k, { ...cur, engine: true, sportLabel: cur.sportLabel ?? l.sportLabel });
  }
  return [...seen.values()];
}

/** Current price, margin and fair probability for every leg; legs that can't be re-priced are dropped. */
async function priceLive(raw: RawLeg[], budgetMs: number, now: number): Promise<SafeLeg[]> {
  const started = Date.now();
  const byEvent = new Map<string, RawLeg[]>();
  for (const l of raw) {
    if (l.kickoff && l.kickoff <= now + SAFE_COMBO.kickoffBufferMs) continue;
    byEvent.set(l.eventId, [...(byEvent.get(l.eventId) ?? []), l]);
  }
  const events = [...byEvent.entries()]
    .sort((a, b) => Number(b[1].some((l) => l.engine)) - Number(a[1].some((l) => l.engine)))
    .slice(0, MAX_EVENTS);
  const out: SafeLeg[] = [];
  for (let i = 0; i < events.length; i += 8) {
    const left = budgetMs - (Date.now() - started);
    if (left < 1_500) break;
    await Promise.all(
      events.slice(i, i + 8).map(async ([eventId, legs]) => {
        const live = await fetchLiveEvent(eventId, Math.min(5_000, left));
        if (!live) return;
        const at = new Date().toISOString();
        for (const l of legs) {
          const meta = PICKS[l.pickCode];
          const snap = snapshotFromBook(l.pickCode, live.book, at, "event-api");
          const odds = Number(live.book[`${meta.marketId}|${meta.specifier}`]?.[meta.outcomeId]);
          if (!snap || !(odds > 1)) continue;
          const home = live.home || l.home;
          const away = live.away || l.away;
          if (!home || !away) continue;
          const sport = (l.sport || "football") as SportKey;
          out.push({
            eventId,
            marketId: meta.marketId,
            specifier: meta.specifier,
            outcomeId: meta.outcomeId,
            home,
            away,
            league: l.league,
            kickoff: live.kickoff || l.kickoff,
            pickCode: l.pickCode,
            pickLabel: pickLabel(l.pickCode, home, away),
            odds,
            implied: 1 / odds,
            sport,
            sportLabel: l.sportLabel || SPORT_LABEL[sport] || sport,
            pFair: snap.p_fair ?? snap.devig_prob,
            overround: snap.overround,
            engine: l.engine,
          });
        }
      }),
    );
  }
  return out;
}

const legLine = (l: SafeLeg, i: number) =>
  `${i + 1}. [${l.sportLabel || l.sport}] ${l.home} vs ${l.away}${l.league ? ` (${l.league})` : ""} — ` +
  `${l.pickLabel} @ ${l.odds.toFixed(2)}, market fair chance ${Math.round(l.pFair * 100)}%, ` +
  `kickoff ${new Date(l.kickoff).toISOString().slice(0, 16)}Z`;

/** AI pass over each leg: plays every match out and flags the ones it wouldn't trust. Null when AI is off or fails. */
async function aiScreenLegs(legs: SafeLeg[]): Promise<Map<string, { pass: boolean; note: string }> | null> {
  if (!process.env.OPENAI_API_KEY || !legs.length) return null;
  const res = await chatJson<{ legs?: { n?: number; pass?: boolean; confidence?: number; note?: string }[] }>({
    system:
      "You are a conservative multi-sport match simulator for a betting desk choosing the SUREST short-price legs of the day. " +
      "Mentally play each match out several times using only the teams, competition, market and prices given, plus general knowledge of the teams. " +
      "Fail any leg that looks like a trap: rotation risk, dead rubber, derby volatility, low-tier or youth/women/reserve competitions with unreliable form, " +
      "or a price that looks too short for the matchup. Never invent injuries, lineups or news. " +
      'Return JSON: {"legs":[{"n":1,"pass":true,"confidence":0-1,"note":"one short reason"}]} with one entry per leg.',
    user: `Legs:\n${legs.map(legLine).join("\n")}`,
    temperature: 0.1,
    maxTokens: 900,
  });
  if (!res || !Array.isArray(res.legs)) return null;
  const out = new Map<string, { pass: boolean; note: string }>();
  for (const v of res.legs) {
    const l = legs[Number(v?.n) - 1];
    if (!l) continue;
    out.set(l.eventId, {
      pass: v.pass === true && Number(v.confidence) >= 0.6,
      note: String(v.note ?? "").slice(0, 160),
    });
  }
  return out;
}

type PlayOut = { pass: boolean; confidence: number; story: string; risk: string; weakest: number | null };

async function aiPlayOutCombo(legs: SafeLeg[], totalOdds: number): Promise<PlayOut | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const res = await chatJson<{ pass?: boolean; confidence?: number; story?: string; risk?: string; weakest?: number }>({
    system:
      "You are a conservative match simulator. Play every match of this accumulator out together. Every leg must win for the slip to win. " +
      "pass=true only if you would stake your own bankroll on the whole slip at this price. Never invent injuries, lineups or news. " +
      'Return JSON: {"pass":boolean,"confidence":0-1,"story":"2-3 sentences","risk":"the single biggest risk","weakest":leg number}.',
    user: `Combined odds ${totalOdds.toFixed(2)}\nLegs:\n${legs.map(legLine).join("\n")}`,
    temperature: 0.1,
    maxTokens: 420,
  });
  if (!res || typeof res.pass !== "boolean") return null;
  return {
    pass: res.pass,
    confidence: Math.max(0, Math.min(1, Number(res.confidence) || 0)),
    story: String(res.story ?? "").slice(0, 500),
    risk: String(res.risk ?? "").slice(0, 200),
    weakest: Number.isFinite(Number(res.weakest)) ? Number(res.weakest) : null,
  };
}

const toPick = (l: SafeLeg, code: string | null, url: string | null): SafeComboPick => ({
  eventId: l.eventId,
  pickCode: l.pickCode,
  home: l.home,
  away: l.away,
  league: l.league,
  sport: l.sport,
  sportLabel: l.sportLabel,
  kickoff: l.kickoff,
  pickLabel: l.pickLabel,
  odds: Number(l.odds.toFixed(2)),
  chance: Number(l.pFair.toFixed(4)),
  code,
  url,
  engine: l.engine,
  note: l.aiNote ?? null,
});

/** Booked only if SportyBet accepted every leg (otherwise the shown odds would be wrong). */
async function bookExact(legs: SafeLeg[]): Promise<{ code: string; url: string } | null> {
  const booked = await createBookingCode(legs);
  if (!booked.code) return null;
  if (booked.games != null && booked.games !== legs.length) return null;
  return { code: booked.code, url: booked.url || sportyOpenUrl(booked.code) };
}

async function readPayload(sb: SupabaseClient, day: string): Promise<SafeComboPayload | null> {
  const { data } = await sb.from(T.pickPools).select("payload").eq("id", safeComboPoolId(day)).maybeSingle();
  return (data?.payload as SafeComboPayload) ?? null;
}

async function writePayload(sb: SupabaseClient, payload: SafeComboPayload) {
  const { error } = await sb.from(T.pickPools).upsert({ id: safeComboPoolId(payload.day), payload });
  if (error) throw new Error(`pick_pools upsert: ${error.message}`);
}

export type SafeComboResult = { ok: boolean; skipped?: string; payload?: SafeComboPayload };

/**
 * Build (or rebuild) the day's Safe combo. Skips when the stored one is
 * already for the current Safe codes, unless `force`. Never throws.
 */
export async function buildSafeCombo(opts: { day: string; force?: boolean; budgetMs?: number }): Promise<SafeComboResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 90_000;
  const left = () => budget - (Date.now() - started);
  let sb: SupabaseClient;
  try {
    sb = adminClient();
  } catch (e) {
    return { ok: false, skipped: e instanceof Error ? e.message : String(e) };
  }
  const now = Date.now();
  try {
    const { safeCodes, legs: slipLegs } = await loadSafeSlips(sb, opts.day);
    if (!safeCodes.length) return { ok: false, skipped: "no Safe codes for the day yet" };
    const signature = safeComboSignature(safeCodes);

    const age = (iso?: string) => now - (Date.parse(String(iso ?? "")) || 0);
    const existing = await readPayload(sb, opts.day);
    if (!opts.force && existing) {
      if (existing.status === "ready" && existing.signature === signature) return { ok: true, skipped: "up to date", payload: existing };
      if (existing.status === "empty" && existing.signature === signature && age(existing.builtAt) < EMPTY_RETRY_MS) {
        return { ok: false, skipped: "nothing qualified recently", payload: existing };
      }
    }
    // The lock is its own row so the current combo stays visible during a rebuild.
    const lockId = `${safeComboPoolId(opts.day)}:lock`;
    const { data: lock } = await sb.from(T.pickPools).select("payload").eq("id", lockId).maybeSingle();
    if (!opts.force && age((lock?.payload as { startedAt?: string })?.startedAt) < BUILD_LOCK_MS) {
      return { ok: false, skipped: "already building" };
    }
    await sb.from(T.pickPools).upsert({ id: lockId, payload: { startedAt: new Date().toISOString() } });

    const raw = await loadSafeCandidates(sb, opts.day, now, slipLegs);
    const priced = await priceLive(raw, Math.min(20_000, left() - 30_000), now);
    let pool = rankSurest(bestPerEvent(priced.filter((l) => !safeLegProblem(l, now)))).slice(0, SAFE_COMBO.searchTop);

    let ai = false;
    const screen = left() > 25_000 ? await aiScreenLegs(pool) : null;
    if (screen?.size) {
      ai = true;
      pool = pool
        .filter((l) => screen.get(l.eventId)?.pass === true)
        .map((l) => ({ ...l, aiNote: screen.get(l.eventId)?.note ?? null }));
    }

    let combo: SafeComboPayload["combo"] = null;
    let available = pool;
    for (let attempt = 0; attempt < 3 && left() > 12_000; attempt++) {
      const choice = chooseSafeCombo(available);
      if (!choice) break;
      const play = left() > 20_000 ? await aiPlayOutCombo(choice.legs, choice.totalOdds) : null;
      if (play) ai = true;
      if (play && (!play.pass || play.confidence < 0.55)) {
        const weakest = choice.legs[(play.weakest ?? 0) - 1] ?? choice.legs.slice().sort((a, b) => a.pFair - b.pFair)[0];
        available = available.filter((l) => l.eventId !== weakest.eventId);
        continue;
      }
      const booked = await bookExact(choice.legs);
      if (!booked) break;
      const pct = Math.round(choice.chance * 100);
      combo = {
        code: booked.code,
        url: booked.url,
        totalOdds: Number(choice.totalOdds.toFixed(2)),
        chance: Number(choice.chance.toFixed(4)),
        legs: choice.legs.map((l) => toPick(l, null, null)),
        rationale:
          (play?.story ? `AI play-out (~${Math.round(play.confidence * 100)}%): ${play.story} ` : "") +
          (play?.risk ? `Biggest risk: ${play.risk} ` : "") +
          `${choice.legs.length} of the day's surest Safe legs, chosen for the lowest bookmaker margin. ` +
          `Market-estimated chance that all win: about ${pct}%. Not a guarantee — stake only what you can afford to lose.`,
      };
      break;
    }

    const comboLegs = combo ? pool.filter((l) => combo!.legs.some((c) => c.eventId === l.eventId)) : [];
    const singles = chooseSinglePicks(pool, comboLegs);
    const picks: SafeComboPick[] = [];
    for (let i = 0; i < singles.length; i += 4) {
      if (left() < 4_000) break;
      const booked = await Promise.all(singles.slice(i, i + 4).map((l) => bookExact([l])));
      singles.slice(i, i + 4).forEach((l, j) => {
        const b = booked[j];
        if (b) picks.push(toPick(l, b.code, b.url));
      });
    }

    const payload: SafeComboPayload = {
      day: opts.day,
      status: combo || picks.length ? "ready" : "empty",
      builtAt: new Date().toISOString(),
      signature,
      combo,
      picks,
      ai,
      note: combo
        ? undefined
        : picks.length
          ? "No combination of today's Safe legs reached 2.0 odds without weakening it, so only single picks are shown."
          : "No Safe leg passed every check right now.",
    };
    await writePayload(sb, payload);
    await sb.from(T.pickPools).delete().eq("id", lockId);
    await logSafeCombo(payload, pool, Math.max(1_500, Math.min(6_000, left())));
    return { ok: payload.status === "ready", payload };
  } catch (e) {
    console.warn("[safe-combo]", e instanceof Error ? e.message : e);
    return { ok: false, skipped: e instanceof Error ? e.message : String(e) };
  }
}

/** Every published combo and single is logged so it is graded like the other products. */
async function logSafeCombo(payload: SafeComboPayload, pool: SafeLeg[], timeoutMs: number) {
  const legOf = (p: SafeComboPick) => pool.find((l) => l.eventId === p.eventId && l.pickCode === p.pickCode);
  const asLog = (p: SafeComboPick) => {
    const l = legOf(p);
    return {
      eventId: p.eventId,
      home: p.home,
      away: p.away,
      league: p.league ?? null,
      sport: p.sport ?? null,
      sportLabel: p.sportLabel ?? null,
      pickCode: p.pickCode,
      pickLabel: p.pickLabel,
      odds: l?.odds ?? p.odds,
      kickoff: p.kickoff,
      confidence: p.chance,
    };
  };
  const slips: LogSlip[] = [];
  if (payload.combo) {
    slips.push({
      source: "safe-combo",
      slipCode: payload.combo.code,
      slipOdds: payload.combo.totalOdds,
      slipConfidence: payload.combo.chance,
      origin: `safe-combo:${payload.day}:combo`,
      tier: "safe-combo",
      legs: payload.combo.legs.map(asLog),
    });
  }
  for (const p of payload.picks) {
    if (!p.code) continue;
    slips.push({
      source: "safe-combo",
      slipCode: p.code,
      slipOdds: p.odds,
      slipConfidence: p.chance,
      origin: `safe-combo:${payload.day}:single`,
      tier: "safe-combo",
      legs: [asLog(p)],
    });
  }
  if (slips.length) await logPredictions(slips, { timeoutMs });
}

/** For the combine route: today's Safe combo legs as bookable legs. */
export function safeComboBookable(payload: SafeComboPayload | null) {
  const all = [...(payload?.combo?.legs ?? []), ...(payload?.picks ?? [])];
  return all
    .filter((p) => p.eventId && p.pickCode && PICKS[p.pickCode])
    .map((p) => {
      const meta = PICKS[p.pickCode];
      return {
        eventId: p.eventId,
        marketId: meta.marketId,
        specifier: meta.specifier,
        outcomeId: meta.outcomeId,
        home: p.home,
        away: p.away,
        league: p.league,
        kickoff: p.kickoff,
        pickCode: p.pickCode,
        pickLabel: p.pickLabel,
        odds: p.odds,
        implied: 1 / p.odds,
        sport: p.sport as SportKey | undefined,
        sportLabel: p.sportLabel,
      };
    });
}
