/**
 * SportyBet public fixtures + share-code booking (no API key).
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const EVENTS_API =
  "https://www.sportybet.com/api/ng/factsCenter/pcUpcomingEvents?sportId=sr%3Asport%3A1&marketId=1%2C10%2C11%2C18%2C19%2C20%2C29&pageSize=100&option=1&pageNum=";

const SHARE_API = "https://www.sportybet.com/api/ng/orders/share";
const EVENT_API = "https://www.sportybet.com/api/ng/factsCenter/event?eventId=";

export const PICKS: Record<
  string,
  { marketId: string; specifier: string; outcomeId: string; label: string; market: string }
> = {
  "1": { marketId: "1", specifier: "", outcomeId: "1", label: "Home", market: "1X2" },
  X: { marketId: "1", specifier: "", outcomeId: "2", label: "Draw", market: "1X2" },
  "2": { marketId: "1", specifier: "", outcomeId: "3", label: "Away", market: "1X2" },
  O05: { marketId: "18", specifier: "total=0.5", outcomeId: "12", label: "Over 0.5 Goals", market: "Over/Under" },
  O15: { marketId: "18", specifier: "total=1.5", outcomeId: "12", label: "Over 1.5 Goals", market: "Over/Under" },
  O25: { marketId: "18", specifier: "total=2.5", outcomeId: "12", label: "Over 2.5 Goals", market: "Over/Under" },
  U15: { marketId: "18", specifier: "total=1.5", outcomeId: "13", label: "Under 1.5 Goals", market: "Over/Under" },
  U25: { marketId: "18", specifier: "total=2.5", outcomeId: "13", label: "Under 2.5 Goals", market: "Over/Under" },
  DC1X: { marketId: "10", specifier: "", outcomeId: "9", label: "Home or Draw (1X)", market: "Double Chance" },
  DC12: { marketId: "10", specifier: "", outcomeId: "10", label: "Home or Away (12)", market: "Double Chance" },
  DCX2: { marketId: "10", specifier: "", outcomeId: "11", label: "Draw or Away (X2)", market: "Double Chance" },
  DNBH: { marketId: "11", specifier: "", outcomeId: "4", label: "Home (Draw No Bet)", market: "Draw No Bet" },
  DNBA: { marketId: "11", specifier: "", outcomeId: "5", label: "Away (Draw No Bet)", market: "Draw No Bet" },
  BTTSY: { marketId: "29", specifier: "", outcomeId: "74", label: "Both Teams To Score", market: "BTTS" },
  BTTSN: { marketId: "29", specifier: "", outcomeId: "76", label: "Both Teams NOT To Score", market: "BTTS" },
  HO05: { marketId: "19", specifier: "total=0.5", outcomeId: "12", label: "Home Over 0.5 Goals", market: "Team Goals" },
  AO05: { marketId: "20", specifier: "total=0.5", outcomeId: "12", label: "Away Over 0.5 Goals", market: "Team Goals" },
};

/** High hit-rate markets for “sure” slips */
export const SAFE_PICK_CODES = ["DC1X", "DCX2", "O15", "HO05", "AO05", "BTTSY", "DNBH", "DNBA"] as const;

export type GameType =
  | "result"
  | "goals"
  | "double"
  | "dnb"
  | "btts"
  | "teamgoals"
  | "safe"
  | "both"
  | "value";

export const CODE_SETS: Record<GameType, readonly string[]> = {
  result: ["1", "X", "2"],
  goals: ["O05", "O15", "O25", "U15", "U25"],
  double: ["DC1X", "DC12", "DCX2"],
  dnb: ["DNBH", "DNBA"],
  btts: ["BTTSY", "BTTSN"],
  teamgoals: ["HO05", "AO05"],
  safe: [...SAFE_PICK_CODES],
  both: [
    "1",
    "X",
    "2",
    "O15",
    "O25",
    "U25",
    "DC1X",
    "DCX2",
    "DC12",
    "DNBH",
    "DNBA",
    "BTTSY",
    "HO05",
    "AO05",
  ],
  value: ["1", "2", "O25", "U25", "BTTSY", "DC12"],
};

export function pickLabel(code: string, home: string, away: string): string {
  const meta = PICKS[code];
  if (!meta) return code;
  return meta.label.replace("Home", home).replace("Away", away);
}

/** Shortest price among allowed codes = highest implied hit rate. */
export function bestOutcome(
  ev: SbEvent,
  codes: readonly string[],
): { code: string; odds: number; implied: number } | null {
  let best: { code: string; odds: number; implied: number } | null = null;
  for (const code of codes) {
    const odds = ev.outcomes[code];
    if (!odds || odds <= 1) continue;
    const implied = 1 / odds;
    if (!best || implied > best.implied) best = { code, odds, implied };
  }
  return best;
}

export function fixtureKey(home: string, away: string): string {
  return `${home}|${away}`.toLowerCase();
}

export function legsFromPicks(
  picks: {
    eventId: string;
    home: string;
    away: string;
    league?: string;
    kickoff?: number | string;
    pickCode: string;
    odds: number;
  }[],
): BookableLeg[] {
  const out: BookableLeg[] = [];
  for (const p of picks) {
    const meta = PICKS[p.pickCode];
    if (!meta || !p.eventId) continue;
    const odds = Number(p.odds) || 0;
    if (odds <= 1) continue;
    out.push({
      eventId: p.eventId,
      marketId: meta.marketId,
      specifier: meta.specifier,
      outcomeId: meta.outcomeId,
      home: p.home,
      away: p.away,
      league: p.league,
      kickoff: typeof p.kickoff === "string" ? Date.parse(p.kickoff) || 0 : Number(p.kickoff) || 0,
      pickCode: p.pickCode,
      pickLabel: pickLabel(p.pickCode, p.home, p.away),
      odds,
      implied: 1 / odds,
    });
  }
  return out;
}

export async function legsForFixtureKeys(
  keys: string[],
  gameType: GameType = "result",
): Promise<BookableLeg[]> {
  const fixtures = await getSportyFixtures(10);
  const byKey = new Map(fixtures.map((e) => [fixtureKey(e.home, e.away), e]));
  const codes = CODE_SETS[gameType] ?? CODE_SETS.result;
  const legs: BookableLeg[] = [];
  for (const key of keys) {
    const ev = byKey.get(key.toLowerCase());
    if (!ev) continue;
    const fav = bestOutcome(ev, codes);
    if (!fav) continue;
    const meta = PICKS[fav.code];
    if (!meta) continue;
    legs.push({
      eventId: ev.eventId,
      marketId: meta.marketId,
      specifier: meta.specifier,
      outcomeId: meta.outcomeId,
      home: ev.home,
      away: ev.away,
      league: ev.league,
      kickoff: ev.kickoff,
      pickCode: fav.code,
      pickLabel: pickLabel(fav.code, ev.home, ev.away),
      odds: fav.odds,
      implied: fav.implied,
    });
  }
  return legs;
}

export type SbEvent = {
  eventId: string;
  home: string;
  away: string;
  league?: string;
  kickoff: number;
  outcomes: Record<string, number>;
};

export type BookableLeg = {
  eventId: string;
  marketId: string;
  specifier: string;
  outcomeId: string;
  home: string;
  away: string;
  league?: string;
  kickoff: number;
  pickCode: string;
  pickLabel: string;
  odds: number;
  implied: number;
};

const headers = {
  "User-Agent": UA,
  Accept: "application/json",
  Referer: "https://www.sportybet.com/",
  ClientId: "web",
};

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const ms = Number(process.env.SPORTY_FETCH_MS) || 8_000;
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseEvent(e: Record<string, unknown>, league?: string): SbEvent | null {
  if (!e.eventId || !e.homeTeamName || !e.awayTeamName) return null;
  const outcomes: Record<string, number> = {};
  for (const m of (e.markets as Record<string, unknown>[]) ?? []) {
    for (const [code, meta] of Object.entries(PICKS)) {
      if (String(m.id) !== meta.marketId) continue;
      if (meta.specifier && (m.specifier ?? "") !== meta.specifier) continue;
      const o = ((m.outcomes as { id: string; odds: string }[]) ?? []).find(
        (x) => String(x.id) === meta.outcomeId,
      );
      const odds = o ? Number(o.odds) : NaN;
      if (Number.isFinite(odds) && odds > 1) outcomes[code] = odds;
    }
  }
  if (!Object.keys(outcomes).length) return null;
  return {
    eventId: String(e.eventId),
    home: String(e.homeTeamName),
    away: String(e.awayTeamName),
    league,
    kickoff: Number(e.estimateStartTime) || Number(e.startTime) || 0,
    outcomes,
  };
}

export async function getSportyFixtures(maxPages = 8): Promise<SbEvent[]> {
  const out: SbEvent[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const json = (await fetchJson(EVENTS_API + page).catch(() => null)) as {
      data?: { tournaments?: { name?: string; events?: Record<string, unknown>[] }[] };
    } | null;
    const tours = json?.data?.tournaments ?? [];
    let added = 0;
    for (const t of tours) {
      for (const e of t.events ?? []) {
        const parsed = parseEvent(e, t.name ? String(t.name) : undefined);
        if (!parsed) continue;
        out.push(parsed);
        added++;
      }
    }
    if (!added) break;
  }
  return out;
}

/** De-vig approx: inverse odds as rough probability (single market). */
export function impliedProb(odds: number): number {
  if (!odds || odds <= 1) return 0;
  return 1 / odds;
}

export async function createBookingCode(
  legs: { eventId: string; marketId: string; specifier?: string; outcomeId: string }[],
): Promise<{ code?: string; url?: string; games?: number; error?: string }> {
  const selections = legs
    .filter((l) => l.eventId && l.marketId && l.outcomeId)
    .map((l) => ({
      eventId: l.eventId,
      marketId: l.marketId,
      specifier: l.specifier ?? "",
      outcomeId: l.outcomeId,
    }))
    .slice(0, 70);
  if (!selections.length) return { error: "no bookable selections" };

  try {
    const res = await fetch(SHARE_API, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(Number(process.env.SPORTY_FETCH_MS) || 8_000),
      body: JSON.stringify({ selections }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      bizCode?: number;
      data?: {
        shareCode?: string;
        shareURL?: string;
        outcomes?: unknown[];
        unavailableOutcomes?: unknown[];
      };
    };
    if (json.bizCode !== 10000 || !json.data?.shareCode) {
      return { error: `bizCode=${json.bizCode ?? "?"}` };
    }
    return {
      code: json.data.shareCode,
      url:
        json.data.shareURL ||
        `https://www.sportybet.com/ng/?shareCode=${json.data.shareCode}`,
      games: Array.isArray(json.data.outcomes) ? json.data.outcomes.length : undefined,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function sportyOpenUrl(code: string): string {
  return `https://www.sportybet.com/ng/?shareCode=${encodeURIComponent(code)}`;
}

/** Best-effort final score from SportyBet event API (ended matches only). */
export async function fetchFinalScore(
  eventId: string,
): Promise<{ home: number; away: number; ended: boolean } | null> {
  try {
    const json = (await fetchJson(EVENT_API + encodeURIComponent(eventId))) as {
      data?: {
        homeScore?: number | string;
        awayScore?: number | string;
        setScore?: string;
        status?: number | string;
        matchStatus?: string;
      };
    };
    const d = json?.data;
    if (!d) return null;
    const statusNum = Number(d.status);
    const matchStatus = String(d.matchStatus ?? "").toLowerCase();
    // SportyBet: status 4 / "Ended" ≈ finished
    const ended =
      statusNum === 4 ||
      matchStatus.includes("ended") ||
      matchStatus.includes("finished") ||
      matchStatus.includes("closed");

    let home = Number(d.homeScore);
    let away = Number(d.awayScore);
    if ((!Number.isFinite(home) || !Number.isFinite(away)) && d.setScore) {
      const m = String(d.setScore).match(/(\d+)\s*[-:]\s*(\d+)/);
      if (m) {
        home = Number(m[1]);
        away = Number(m[2]);
      }
    }
    if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
    if (!ended) return { home, away, ended: false };
    return { home, away, ended: true };
  } catch {
    return null;
  }
}

export function settlePick(pickCode: string, home: number, away: number): boolean | null {
  const total = home + away;
  switch (pickCode) {
    case "1":
      return home > away;
    case "X":
      return home === away;
    case "2":
      return home < away;
    case "DC1X":
      return home >= away;
    case "DCX2":
      return home <= away;
    case "DC12":
      return home !== away;
    case "DNBH":
      if (home === away) return null;
      return home > away;
    case "DNBA":
      if (home === away) return null;
      return home < away;
    case "O05":
      return total > 0.5;
    case "O15":
      return total > 1.5;
    case "O25":
      return total > 2.5;
    case "U15":
      return total < 1.5;
    case "U25":
      return total < 2.5;
    case "BTTSY":
      return home > 0 && away > 0;
    case "BTTSN":
      return !(home > 0 && away > 0);
    case "HO05":
      return home > 0.5;
    case "AO05":
      return away > 0.5;
    default:
      return null;
  }
}
