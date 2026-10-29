/**
 * Brief v3 D2: every candidate that matches a frozen hypothesis is logged as an
 * unpublished shadow selection at creation (price, p_fair, timestamps). Shadow
 * rows are internal only: nothing user-facing reads sc_shadow_selections.
 * Fail-safe: never throws, bounded by a time budget, skipped until
 * sql/schema-eval-v3.sql has run.
 */
import { HYPOTHESES_TABLE, SHADOW_TABLE, auditDb, auditSchema, auditWarn, upsertChunks, withTimeout } from "./audit-db";
import { isFrozenActive, matchesHypothesis, type Hypothesis } from "./eval-v3";

let cache: { at: number; list: Hypothesis[] } | null = null;

/** Frozen, active hypotheses (cached 10 min). */
export async function activeHypotheses(): Promise<Hypothesis[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.list;
  const sb = auditDb();
  if (!sb) return [];
  const res = await withTimeout(sb.from(HYPOTHESES_TABLE).select("id, title, definition, success_rule, frozen_at, min_n, status"), 5_000);
  if (!res || res.error) {
    if (res?.error) auditWarn("hypotheses select", res.error.message);
    return cache?.list ?? [];
  }
  const list = ((res.data ?? []) as Hypothesis[]).filter(isFrozenActive);
  cache = { at: Date.now(), list };
  return list;
}

type CandidateRow = Record<string, unknown>;

/** Shadow rows for market-band hypotheses from freshly logged candidate rows. */
export function shadowRowsFor(rows: CandidateRow[], hypotheses: Hypothesis[], now = Date.now()): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const h of hypotheses) {
    if (h.definition.kind !== "market_band" || !isFrozenActive(h)) continue;
    const frozen = Date.parse(String(h.frozen_at));
    for (const r of rows) {
      const created = Date.parse(String(r.evaluated_at ?? "")) || now;
      const kickoff = Date.parse(String(r.kickoff ?? ""));
      if (created <= frozen || !(kickoff > created) || r.p_fair == null) continue;
      if (!matchesHypothesis(h, { market: r.market as string, sport: r.sport as string, odds: r.odds as number, p_fair: r.p_fair as number })) continue;
      out.push({
        hypothesis_id: h.id,
        candidate_key: r.dedupe_key ?? null,
        event_id: r.event_id,
        fixture: r.fixture ?? null,
        sport: r.sport ?? null,
        league: r.league ?? null,
        market: r.market ?? null,
        pick_code: r.pick_code,
        odds: r.odds,
        p_fair: r.p_fair,
        devig_method: r.devig_method ?? null,
        market_odds: r.market_odds ?? null,
        kickoff: r.kickoff ?? null,
        created_at: new Date(created).toISOString(),
      });
    }
  }
  return out;
}

export async function logShadowSelections(rows: CandidateRow[], timeoutMs: number): Promise<number> {
  try {
    if (!rows.length || timeoutMs < 500) return 0;
    const schema = await auditSchema();
    if (!schema.evalV3) return 0;
    const hyps = await activeHypotheses();
    const shadow = shadowRowsFor(rows, hyps);
    if (!shadow.length) return 0;
    // First sighting wins: a later run never moves the logged price or time.
    const res = await upsertChunks(SHADOW_TABLE, shadow, {
      onConflict: "hypothesis_id,event_id,pick_code",
      ignoreDuplicates: true,
      timeoutMs,
      chunk: 500,
    });
    if (res.error) auditWarn("shadow insert", res.error);
    return res.written;
  } catch (e) {
    auditWarn("shadow", e);
    return 0;
  }
}
