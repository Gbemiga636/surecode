import { createClient } from "@supabase/supabase-js";
import { T } from "./db";
import { makeDeadline, type Deadline } from "./budget";
import {
  buildSureSlipsOfDay,
  lagosDay,
  type PastOutcomeSample,
} from "./sure-engine";
import { fetchFinalScore, settlePick, type BookableLeg } from "./sporty";
import type { LegHistoryRow } from "./learning";
import {
  buildPlentyCodes,
  getAnalysisBoard,
  getCombos,
  getExpertPicks,
  getPredictions,
  getValuePicks,
} from "./picks";

function fmtErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type CrawlResult = {
  ok: boolean;
  day: string;
  codesWritten: number;
  settled: number;
  historyLegs: number;
  summary: string;
  slips: { slot: number; code?: string; error?: string; totalOdds: number }[];
};

async function loadPastHistory(
  sb: ReturnType<typeof adminClient>,
): Promise<PastOutcomeSample[]> {
  const { data } = await sb
    .from(T.pastCodes)
    .select("day, outcome, total_odds, legs")
    .in("outcome", ["WON", "LOST"])
    .order("day", { ascending: false })
    .limit(80);

  return (data ?? []).map((row) => {
    const legs = (Array.isArray(row.legs) ? row.legs : []) as BookableLeg[];
    return {
      day: String(row.day),
      outcome: String(row.outcome),
      totalOdds: row.total_odds != null ? Number(row.total_odds) : null,
      legs: legs.map((l) => ({
        home: l.home,
        away: l.away,
        pick: l.pickLabel || l.pickCode,
        odds: Number(l.odds) || 0,
      })),
    };
  });
}

async function loadLegHistory(
  sb: ReturnType<typeof adminClient>,
): Promise<LegHistoryRow[]> {
  const { data, error } = await sb
    .from(T.legHistory)
    .select(
      "event_id, home, away, league, pick_code, pick_label, odds, home_score, away_score, won",
    )
    .order("settled_at", { ascending: false })
    .limit(1200);

  if (error) {
    console.warn("[crawl] leg_history:", error.message);
    return [];
  }
  return (data ?? []) as LegHistoryRow[];
}

async function upsertLegHistory(
  sb: ReturnType<typeof adminClient>,
  legs: BookableLeg[],
  scores: { home: number; away: number }[],
  results: (boolean | null)[],
): Promise<number> {
  let n = 0;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const score = scores[i];
    const won = results[i];
    if (!score || won === null) continue;
    const { error } = await sb.from(T.legHistory).upsert(
      {
        event_id: leg.eventId,
        home: leg.home,
        away: leg.away,
        league: leg.league ?? null,
        pick_code: leg.pickCode,
        pick_label: leg.pickLabel ?? null,
        odds: Number(leg.odds) || null,
        home_score: score.home,
        away_score: score.away,
        won,
        settled_at: new Date().toISOString(),
      },
      { onConflict: "event_id,pick_code" },
    );
    if (!error) n++;
  }
  return n;
}

async function backfillWonSlips(
  sb: ReturnType<typeof adminClient>,
  deadline?: Deadline,
): Promise<number> {
  const { data } = await sb
    .from(T.pastCodes)
    .select("legs, outcome")
    .eq("outcome", "WON")
    .order("day", { ascending: false })
    .limit(80);

  let n = 0;
  for (const row of data ?? []) {
    if (deadline && !deadline.ok(800)) break;
    const legs = row.legs as BookableLeg[];
    if (!Array.isArray(legs)) continue;
    for (const leg of legs) {
      const { error } = await sb.from(T.legHistory).upsert(
        {
          event_id: leg.eventId,
          home: leg.home,
          away: leg.away,
          league: leg.league ?? null,
          pick_code: leg.pickCode,
          pick_label: leg.pickLabel ?? null,
          odds: Number(leg.odds) || null,
          won: true,
          settled_at: new Date().toISOString(),
        },
        { onConflict: "event_id,pick_code" },
      );
      if (!error) n++;
    }
  }
  return n;
}

export async function runSureCrawl(): Promise<CrawlResult> {
  const sb = adminClient();
  const day = lagosDay();
  const deadline = makeDeadline();
  const { data: runRow } = await sb
    .from(T.crawlRuns)
    .insert({ summary: "started" })
    .select("id")
    .single();

  let written = 0;
  let plenty = 0;
  let settledTotal = 0;
  let historyLegs = 0;
  let slips: Awaited<ReturnType<typeof buildSureSlipsOfDay>> = [];

  try {
    settledTotal += await settlePendingCodes(sb, deadline, 10, 6);
    if (deadline.ok(1500)) {
      historyLegs += await backfillWonSlips(sb, deadline);
    }

    if (deadline.ok(4000)) {
      const [history, legHistory] = await Promise.all([
        loadPastHistory(sb),
        loadLegHistory(sb),
      ]);
      historyLegs = Math.max(historyLegs, legHistory.length);
      const allowAi = deadline.ok(12_000) && Boolean(process.env.OPENAI_API_KEY);
      slips = await buildSureSlipsOfDay(3, history, { allowAi, legHistory });

      for (const slip of slips) {
        if (!slip.code) continue;
        const payload = {
          day,
          slot: slip.slot,
          code: slip.code,
          share_url: slip.shareUrl ?? null,
          total_odds: Number(slip.totalOdds.toFixed(4)),
          confidence: Number(slip.confidence.toFixed(4)),
          legs: slip.legs,
          rationale: slip.rationale,
          status: "ACTIVE",
          outcome: "PENDING",
        };
        const { error } = await sb.from(T.sureCodes).upsert(payload, {
          onConflict: "day,slot",
          ignoreDuplicates: false,
        });
        if (error) throw new Error(`sure_codes upsert: ${error.message} (${error.code})`);

        const { data: existing } = await sb
          .from(T.pastCodes)
          .select("id")
          .eq("day", day)
          .eq("code", slip.code)
          .maybeSingle();
        if (!existing) {
          const { error: pastErr } = await sb.from(T.pastCodes).insert({
            day,
            code: slip.code,
            share_url: slip.shareUrl ?? null,
            total_odds: payload.total_odds,
            confidence: payload.confidence,
            legs: slip.legs,
            rationale: slip.rationale,
            outcome: "PENDING",
          });
          if (pastErr) throw new Error(`past_codes insert: ${pastErr.message}`);
        }
        written++;
      }
    }

    if (deadline.ok(5000)) {
      try {
        const packs = await buildPlentyCodes(deadline.ok(12_000) ? 6 : 3);
        for (const pack of packs) {
          if (!pack.code) continue;
          const { error } = await sb.from(T.codes).upsert(
            {
              day,
              code: pack.code,
              share_url: pack.shareUrl ?? null,
              total_odds: Number(pack.totalOdds.toFixed(4)),
              confidence: Number(pack.confidence.toFixed(4)),
              legs: pack.legs,
              rationale: pack.rationale,
              code_type: pack.codeType,
              status: "ACTIVE",
            },
            { onConflict: "day,code" },
          );
          if (!error) plenty++;
        }
      } catch (e) {
        console.warn("[crawl] plenty codes:", fmtErr(e));
      }
    }

    if (deadline.ok(4000)) {
      try {
        const types = ["result", "safe", "goals", "btts", "both"] as const;
        const expertRows = await Promise.all(
          types.map(async (gameType) => {
            const expert = await getExpertPicks({ count: 14, days: 5, gameType });
            return { id: `expert-${gameType}`, payload: expert };
          }),
        );
        const [value, preds, combos, board] = await Promise.all([
          getValuePicks({ count: 16, days: 7 }),
          getPredictions(3),
          getCombos(),
          getAnalysisBoard(2),
        ]);
        await sb.from(T.pickPools).upsert([
          ...expertRows,
          { id: "value", payload: value },
          { id: "predictions", payload: { picks: preds } },
          { id: "combos", payload: { combos } },
          { id: "analysis", payload: { board } },
        ]);
      } catch (e) {
        console.warn("[crawl] pick pools:", fmtErr(e));
      }
    }

    if (deadline.ok(2000)) {
      settledTotal += await settlePendingCodes(sb, deadline, 6, 4);
    }

    const aiOn = Boolean(process.env.OPENAI_API_KEY);
    const summary = `day=${day} sure=${written} plenty=${plenty} settled=${settledTotal} hist=${historyLegs} ai=${aiOn ? "on" : "off"} leftMs=${deadline.left()}`;
    if (runRow?.id) {
      await sb
        .from(T.crawlRuns)
        .update({
          finished_at: new Date().toISOString(),
          ok: written > 0 || plenty > 0 || settledTotal > 0,
          summary,
          codes_written: written + plenty,
        })
        .eq("id", runRow.id);
    }

    return {
      ok: written > 0 || plenty > 0 || settledTotal > 0,
      day,
      codesWritten: written + plenty,
      settled: settledTotal,
      historyLegs,
      summary,
      slips: slips.map((s) => ({
        slot: s.slot,
        code: s.code,
        error: s.error,
        totalOdds: s.totalOdds,
      })),
    };
  } catch (e) {
    const msg = fmtErr(e);
    if (runRow?.id) {
      await sb
        .from(T.crawlRuns)
        .update({
          finished_at: new Date().toISOString(),
          ok: false,
          summary: msg,
          codes_written: written + plenty,
        })
        .eq("id", runRow.id);
    }
    return {
      ok: false,
      day,
      codesWritten: written + plenty,
      settled: settledTotal,
      historyLegs,
      summary: msg,
      slips: [],
    };
  }
}

async function settleOneSlipDetailed(
  legs: BookableLeg[],
): Promise<{
  outcome: "WON" | "LOST" | "VOID";
  scores: { home: number; away: number }[];
  results: (boolean | null)[];
} | null> {
  if (!Array.isArray(legs) || !legs.length) return null;
  const results: (boolean | null)[] = [];
  const scores: { home: number; away: number }[] = [];
  for (const leg of legs) {
    const score = await fetchFinalScore(leg.eventId);
    if (!score || !score.ended) return null;
    scores.push({ home: score.home, away: score.away });
    results.push(settlePick(leg.pickCode, score.home, score.away));
  }
  if (results.some((r) => r === null)) {
    return { outcome: "VOID", scores, results };
  }
  return {
    outcome: results.every((r) => r === true) ? "WON" : "LOST",
    scores,
    results,
  };
}

export async function settlePendingCodes(
  sb: ReturnType<typeof adminClient> = adminClient(),
  deadline?: Deadline,
  pastLimit = 40,
  sureLimit = 20,
): Promise<number> {
  let updated = 0;
  const nowIso = new Date().toISOString();

  const { data: pastRows } = await sb
    .from(T.pastCodes)
    .select("id, legs, outcome")
    .or("outcome.is.null,outcome.eq.PENDING")
    .order("day", { ascending: false })
    .limit(pastLimit);

  for (const row of pastRows ?? []) {
    if (deadline && !deadline.ok(1200)) break;
    const detailed = await settleOneSlipDetailed(row.legs as BookableLeg[]);
    if (!detailed) continue;
    const { error } = await sb
      .from(T.pastCodes)
      .update({ outcome: detailed.outcome, settled_at: nowIso })
      .eq("id", row.id);
    if (!error) {
      updated++;
      await upsertLegHistory(
        sb,
        row.legs as BookableLeg[],
        detailed.scores,
        detailed.results,
      );
    }
  }

  const { data: sureRows } = await sb
    .from(T.sureCodes)
    .select("id, day, code, legs, outcome, status")
    .or("outcome.is.null,outcome.eq.PENDING")
    .eq("status", "ACTIVE")
    .order("day", { ascending: false })
    .limit(sureLimit);

  for (const row of sureRows ?? []) {
    if (deadline && !deadline.ok(1200)) break;
    const detailed = await settleOneSlipDetailed(row.legs as BookableLeg[]);
    if (!detailed) continue;
    const { error } = await sb
      .from(T.sureCodes)
      .update({ outcome: detailed.outcome, status: "SETTLED" })
      .eq("id", row.id);
    if (!error) {
      updated++;
      await upsertLegHistory(
        sb,
        row.legs as BookableLeg[],
        detailed.scores,
        detailed.results,
      );
    }

    if (row.code && row.day) {
      await sb
        .from(T.pastCodes)
        .update({ outcome: detailed.outcome, settled_at: nowIso })
        .eq("day", row.day)
        .eq("code", row.code)
        .or("outcome.is.null,outcome.eq.PENDING");
    }
  }

  return updated;
}
