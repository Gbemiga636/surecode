/**
 * Full-market snapshot at prediction time (audit only): every outcome price of
 * the predicted market, its overround and the proportional de-vig probability
 * of the predicted outcome. Read from the fixtures the engine just fetched;
 * events missing from that cache are fetched from SportyBet's event API.
 * Never throws and never changes what the engine picks.
 */
import { PICKS, cachedMarketBook, readMarketBook, type MarketBook } from "./sporty";
import { withTimeout } from "./audit-db";

const EVENT_API = "https://www.sportybet.com/api/ng/factsCenter/event?eventId=";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.sportybet.com/",
  ClientId: "web",
};
/** Cached feed prices older than this are refreshed from the event API. */
const CACHE_FRESH_MS = 30 * 60_000;

/** Outcome ids that make up each market we predict on (all must be priced to de-vig). */
const MARKET_OUTCOMES: Record<string, string[]> = {
  "1": ["1", "2", "3"],
  "10": ["9", "10", "11"],
  "11": ["4", "5"],
  "18": ["12", "13"],
  "19": ["12", "13"],
  "20": ["12", "13"],
  "29": ["74", "76"],
  "63": ["9", "10", "11"],
  "68": ["12", "13"],
  "186": ["4", "5"],
  "219": ["4", "5"],
};
/** Double-chance outcomes each cover two of the three results, so their implied probabilities sum to ~2. */
const RESULTS_PER_OUTCOME: Record<string, number> = { "10": 2, "63": 2 };

export type MarketSnapshot = {
  market_odds: {
    market_id: string;
    specifier: string;
    outcomes: Record<string, number>;
    picked_outcome: string;
    captured_at: string;
    source: "fixture-feed" | "event-api";
  };
  overround: number;
  devig_prob: number;
};

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Proportional de-vig of one pick from a market book; null when the market isn't fully priced. */
export function snapshotFromBook(
  pickCode: string | null | undefined,
  book: MarketBook,
  capturedAt: string,
  source: MarketSnapshot["market_odds"]["source"],
): MarketSnapshot | null {
  const meta = pickCode ? PICKS[pickCode] : undefined;
  if (!meta) return null;
  const prices = book[`${meta.marketId}|${meta.specifier}`];
  const expected = MARKET_OUTCOMES[meta.marketId];
  if (!prices || !expected || !expected.every((id) => prices[id] > 1)) return null;
  const k = RESULTS_PER_OUTCOME[meta.marketId] ?? 1;
  const sum = expected.reduce((a, id) => a + 1 / prices[id], 0);
  const devig = ((1 / prices[meta.outcomeId]) / sum) * k;
  if (!(devig > 0 && devig < 1)) return null;
  return {
    market_odds: {
      market_id: meta.marketId,
      specifier: meta.specifier,
      outcomes: Object.fromEntries(expected.map((id) => [id, prices[id]])),
      picked_outcome: meta.outcomeId,
      captured_at: capturedAt,
      source,
    },
    overround: r6(sum / k - 1),
    devig_prob: r6(devig),
  };
}

async function fetchEventBook(eventId: string, ms: number): Promise<MarketBook | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, ms));
  try {
    const res = await fetch(EVENT_API + encodeURIComponent(eventId), { headers: HEADERS, signal: controller.signal });
    const json = (await res.json()) as { data?: { markets?: unknown; status?: number } };
    if (!json?.data || Number(json.data.status) !== 0) return null; // only pre-match prices
    return readMarketBook(json.data.markets);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Snapshot for each (event, pick). Key `${eventId}|${pickCode}`. Missing keys
 * = market not fully priced or not reachable inside the budget.
 */
export async function marketSnapshots(
  picks: { eventId: string | null | undefined; pickCode: string | null | undefined }[],
  budgetMs: number,
): Promise<Map<string, MarketSnapshot>> {
  const out = new Map<string, MarketSnapshot>();
  try {
    const started = Date.now();
    const want = new Map<string, Set<string>>();
    for (const p of picks) {
      if (!p.eventId || !p.pickCode || !PICKS[p.pickCode]) continue;
      want.set(p.eventId, (want.get(p.eventId) ?? new Set()).add(p.pickCode));
    }
    const misses: string[] = [];
    for (const [eventId, codes] of want) {
      const cached = cachedMarketBook(eventId);
      const fresh = cached && Date.now() - cached.at < CACHE_FRESH_MS;
      let complete = Boolean(fresh);
      if (cached && fresh) {
        const at = new Date(cached.at).toISOString();
        for (const code of codes) {
          const snap = snapshotFromBook(code, cached.markets, at, "fixture-feed");
          if (snap) out.set(`${eventId}|${code}`, snap);
          else complete = false;
        }
      }
      if (!complete) misses.push(eventId);
    }
    for (let i = 0; i < misses.length; i += 8) {
      const left = budgetMs - (Date.now() - started);
      if (left < 800) break;
      await Promise.all(
        misses.slice(i, i + 8).map(async (eventId) => {
          const book = await withTimeout(fetchEventBook(eventId, Math.min(4_000, left)), Math.min(4_500, left));
          if (!book) return;
          const at = new Date().toISOString();
          for (const code of want.get(eventId) ?? []) {
            if (out.has(`${eventId}|${code}`)) continue;
            const snap = snapshotFromBook(code, book, at, "event-api");
            if (snap) out.set(`${eventId}|${code}`, snap);
          }
        }),
      );
    }
  } catch {
    /* audit only */
  }
  return out;
}
