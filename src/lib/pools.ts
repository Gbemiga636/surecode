/**
 * Read crawler-published pick pools so app pages don't hit SportyBet on every SSR.
 */
import { createClient } from "@/lib/supabase/server";
import { T } from "./db";
import type { AppPick, ComboSlip } from "./picks";
import {
  getAnalysisBoard,
  getCombos,
  getExpertPicks,
  getPredictions,
  getValuePicks,
} from "./picks";

async function readPool<T>(id: string): Promise<T | null> {
  try {
    const sb = await createClient();
    const { data } = await sb.from(T.pickPools).select("payload").eq("id", id).maybeSingle();
    if (!data?.payload) return null;
    return data.payload as T;
  } catch {
    return null;
  }
}

export async function loadExpertPicks(opts: {
  count?: number;
  days?: number;
  gameType?: "result" | "goals" | "safe" | "btts" | "both";
  minConfidence?: number;
}): Promise<{ picks: AppPick[]; poolSize: number; source: "cache" | "live" | "empty" }> {
  const gameType = opts.gameType || "result";
  const cached = await readPool<{ picks?: AppPick[]; poolSize?: number }>(`expert-${gameType}`);
  if (cached?.picks?.length) {
    return {
      picks: cached.picks.slice(0, opts.count ?? 12),
      poolSize: cached.poolSize ?? cached.picks.length,
      source: "cache",
    };
  }
  try {
    const live = await getExpertPicks({
      count: opts.count ?? 12,
      days: opts.days ?? 5,
      gameType,
      minConfidence: opts.minConfidence ?? 0.5,
    });
    if (live.picks.length) return { ...live, source: "live" };
  } catch {
    /* SportyBet unavailable */
  }
  return { picks: [], poolSize: 0, source: "empty" };
}

export async function loadValuePicks(): Promise<{
  picks: AppPick[];
  scanned: number;
  source: "cache" | "live" | "empty";
}> {
  const cached = await readPool<{ picks?: AppPick[]; scanned?: number }>("value");
  if (cached?.picks?.length) {
    return {
      picks: cached.picks,
      scanned: cached.scanned ?? cached.picks.length,
      source: "cache",
    };
  }
  try {
    const live = await getValuePicks({ count: 18, days: 7, minOdds: 1.6 });
    if (live.picks.length) return { ...live, source: "live" };
  } catch {
    /* ignore */
  }
  return { picks: [], scanned: 0, source: "empty" };
}

export async function loadPredictions(): Promise<{ picks: AppPick[]; source: "cache" | "live" | "empty" }> {
  const cached = await readPool<{ picks?: AppPick[] }>("predictions");
  if (cached?.picks?.length) return { picks: cached.picks, source: "cache" };
  try {
    const picks = await getPredictions(3);
    if (picks.length) return { picks, source: "live" };
  } catch {
    /* ignore */
  }
  return { picks: [], source: "empty" };
}

export async function loadCombos(): Promise<{ combos: ComboSlip[]; source: "cache" | "live" | "empty" }> {
  const cached = await readPool<{ combos?: ComboSlip[] }>("combos");
  if (cached?.combos?.length) return { combos: cached.combos, source: "cache" };
  try {
    const combos = await getCombos();
    if (combos.length) return { combos, source: "live" };
  } catch {
    /* ignore */
  }
  return { combos: [], source: "empty" };
}

export async function loadAnalysis(): Promise<{
  board: Awaited<ReturnType<typeof getAnalysisBoard>>;
  source: "cache" | "live" | "empty";
}> {
  const cached = await readPool<{ board?: Awaited<ReturnType<typeof getAnalysisBoard>> }>("analysis");
  if (cached?.board?.length) return { board: cached.board, source: "cache" };
  try {
    const board = await getAnalysisBoard(2);
    if (board.length) return { board, source: "live" };
  } catch {
    /* ignore */
  }
  return { board: [], source: "empty" };
}
