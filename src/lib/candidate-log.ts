/**
 * Persist the Sure engine's candidate universe (selected + rejected) for
 * selection-lift analysis. Fail-safe: never throws, bounded by a time budget,
 * silently skipped until the v2 migration has created the table.
 */
import { PICKS, pickLabel } from "./sporty";
import { readCandidates, type CandidateStore } from "./candidate-trace";
import {
  CANDIDATES_TABLE,
  auditDb,
  auditDisabled,
  auditSchema,
  auditWarn,
  isoTime,
  num,
  sportOf,
  upsertChunks,
  withTimeout,
} from "./audit-db";
import { modelVersion } from "./prediction-log";

export async function logCandidates(
  store: CandidateStore,
  ctx: { day: string; runId: string },
  timeoutMs: number,
): Promise<{ written: number; selected: number }> {
  const out = { written: 0, selected: 0 };
  try {
    if (auditDisabled() || timeoutMs < 1_000) return out;
    const sb = auditDb();
    if (!sb) return out;
    const schema = await auditSchema();
    if (!schema.candidates) return out;

    const started = Date.now();
    const version = modelVersion("sure");
    const items = readCandidates(store).filter((c) => c.eventId && c.pickCode);
    if (!items.length) return out;

    const rows = items.map((c) => ({
      run_id: ctx.runId,
      day: ctx.day,
      evaluated_at: new Date(c.evaluatedAt).toISOString(),
      product_tier: c.mode,
      event_id: c.eventId,
      fixture: `${c.home} v ${c.away}`,
      sport: sportOf(c.pickCode, c.sport),
      league: c.league || null,
      kickoff: isoTime(c.kickoff),
      market: PICKS[c.pickCode]?.market ?? null,
      pick_code: c.pickCode,
      selection: pickLabel(c.pickCode, c.home, c.away),
      odds: num(c.odds, 4),
      fair_market_probability: c.fairProb != null && c.fairProb > 0 && c.fairProb < 1 ? num(c.fairProb, 6) : null,
      engine_score: num(c.score, 4),
      status: c.status,
      stage: c.stage,
      rejection_reason: c.reason ? c.reason.slice(0, 160) : null,
      slip_code: c.slipCode,
      model_version: version,
      dedupe_key: `${ctx.day}|${c.mode}|${c.eventId}|${c.pickCode}`,
    }));

    // First evaluation of the day is kept; selected rows go first so a short
    // budget still records them.
    const selected = rows.filter((r) => r.status === "selected");
    const ordered = [...selected, ...rows.filter((r) => r.status !== "selected")];
    const ins = await upsertChunks(CANDIDATES_TABLE, ordered, {
      onConflict: "dedupe_key",
      ignoreDuplicates: true,
      timeoutMs: Math.max(500, Math.floor(timeoutMs * 0.75)),
      chunk: 500,
    });
    if (ins.error) auditWarn("candidates insert", ins.error);
    out.written = ins.written;

    // Anything that ended up in a published slip is always marked selected,
    // even if an earlier run of the day logged it as rejected.
    for (let i = 0; i < selected.length; i += 10) {
      const left = timeoutMs - (Date.now() - started);
      if (left < 300) break;
      const results = await Promise.all(
        selected.slice(i, i + 10).map((r) =>
          withTimeout(
            sb
              .from(CANDIDATES_TABLE)
              .update({ status: "selected", stage: "slip", rejection_reason: null, slip_code: r.slip_code, odds: r.odds })
              .eq("dedupe_key", r.dedupe_key),
            left,
          ),
        ),
      );
      for (const res of results) {
        if (res && !res.error) out.selected++;
        else if (res?.error) auditWarn("candidates select-mark", res.error.message);
      }
    }
    return out;
  } catch (e) {
    auditWarn("candidates", e);
    return out;
  }
}
