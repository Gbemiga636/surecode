/**
 * Candidate-universe tracing for the Sure engine.
 *
 * The engine calls these hooks at each point where it accepts or drops a
 * selection. They only record; they never change a decision, never throw and
 * do nothing at all unless a trace is active (see `withCandidateTrace`). The
 * store is scoped per request with AsyncLocalStorage, so concurrent requests
 * can't mix their candidates.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type CandidateStage = "analysis" | "pool" | "slip";

export type CandidateEval = {
  mode: string;
  eventId: string;
  home: string;
  away: string;
  league?: string;
  sport?: string;
  kickoff: number;
  pickCode: string;
  odds: number;
  fairProb: number | null;
  score: number | null;
  status: "selected" | "rejected";
  stage: CandidateStage;
  reason: string | null;
  slipCode: string | null;
  evaluatedAt: number;
};

export type CandidateStore = { items: Map<string, CandidateEval>; max: number };

type EventLike = {
  eventId: string;
  home: string;
  away: string;
  league?: string;
  kickoff: number;
  sport?: string;
};

const als = new AsyncLocalStorage<CandidateStore>();
const STAGE_RANK: Record<CandidateStage, number> = { analysis: 0, pool: 1, slip: 2 };

export function newCandidateStore(max = 8_000): CandidateStore {
  return { items: new Map(), max };
}

/** Run `fn` with tracing active. Errors from `fn` propagate unchanged. */
export function withCandidateTrace<T>(store: CandidateStore, fn: () => Promise<T>): Promise<T> {
  return als.run(store, fn);
}

const keyOf = (mode: string, eventId: string, pickCode: string) => `${mode}|${eventId}|${pickCode}`;

/**
 * Record an evaluation. Later stages overwrite earlier ones; a selected
 * candidate is never downgraded.
 */
export function traceCandidate(
  ev: EventLike,
  mode: string,
  pickCode: string,
  odds: number,
  stage: CandidateStage,
  reason: string | null,
  extra: { score?: number | null; fairProb?: number | null; onlyIfStage?: CandidateStage } = {},
): void {
  try {
    const store = als.getStore();
    if (!store || !ev?.eventId || !pickCode) return;
    const key = keyOf(mode, ev.eventId, pickCode);
    const prev = store.items.get(key);
    if (prev) {
      if (prev.status === "selected") return;
      if (extra.onlyIfStage && prev.stage !== extra.onlyIfStage) return;
      if (STAGE_RANK[stage] < STAGE_RANK[prev.stage]) return;
    } else if (store.items.size >= store.max) {
      return;
    }
    store.items.set(key, {
      mode,
      eventId: String(ev.eventId),
      home: ev.home,
      away: ev.away,
      league: ev.league,
      sport: ev.sport,
      kickoff: Number(ev.kickoff) || 0,
      pickCode,
      odds: Number(odds) || 0,
      fairProb: extra.fairProb ?? prev?.fairProb ?? null,
      score: extra.score ?? prev?.score ?? null,
      status: "rejected",
      stage,
      reason,
      slipCode: null,
      evaluatedAt: prev?.evaluatedAt ?? Date.now(),
    });
  } catch {
    /* tracing must never affect the engine */
  }
}

/** Mark the legs of a booked slip as selected. */
export function traceSelected(
  mode: string,
  legs: (EventLike & { pickCode: string; odds: number })[],
  slipCode: string | undefined,
): void {
  try {
    const store = als.getStore();
    if (!store || !slipCode || !Array.isArray(legs)) return;
    for (const leg of legs) {
      const key = keyOf(mode, leg.eventId, leg.pickCode);
      const prev = store.items.get(key);
      store.items.set(key, {
        mode,
        eventId: String(leg.eventId),
        home: leg.home,
        away: leg.away,
        league: leg.league,
        sport: leg.sport,
        kickoff: Number(leg.kickoff) || 0,
        pickCode: leg.pickCode,
        odds: Number(leg.odds) || 0,
        fairProb: prev?.fairProb ?? null,
        score: prev?.score ?? null,
        status: "selected",
        stage: "slip",
        reason: null,
        slipCode,
        evaluatedAt: prev?.evaluatedAt ?? Date.now(),
      });
    }
  } catch {
    /* tracing must never affect the engine */
  }
}

/** Whether a trace is active — lets callers skip building trace-only data. */
export function tracing(): boolean {
  try {
    return Boolean(als.getStore());
  } catch {
    return false;
  }
}

export function readCandidates(store: CandidateStore): CandidateEval[] {
  try {
    return [...store.items.values()];
  } catch {
    return [];
  }
}
