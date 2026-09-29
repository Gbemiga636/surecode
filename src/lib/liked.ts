import type { SupabaseClient } from "@supabase/supabase-js";
import { T } from "./db";
import type { Deadline } from "./budget";
import { fetchFinalScore, fetchShareCode, settlePick } from "./sporty";
import { modeForSlot } from "./sure-mode";

export type LikedLeg = {
  eventId?: string;
  home: string;
  away: string;
  league?: string;
  pickCode?: string;
  pickLabel: string;
  odds: number;
  kickoff?: number;
  sport?: string;
  sportLabel?: string;
};

export type LegStatus = "won" | "lost" | "void" | "pending" | "unknown";

export type LegResult = {
  eventId?: string;
  status: LegStatus;
  homeScore?: number;
  awayScore?: number;
  reason: string;
};

export type LikedOutcome = "PENDING" | "WON" | "LOST" | "VOID";

export type LikedRow = {
  id: string;
  user_id: string;
  code: string;
  source: string;
  lane: string | null;
  day: string | null;
  share_url: string | null;
  total_odds: number | null;
  confidence: number | null;
  legs: LikedLeg[];
  leg_results: LegResult[];
  outcome: LikedOutcome;
  loss_summary: string | null;
  note: string | null;
  checked_at: string | null;
  settled_at: string | null;
  created_at: string;
};

export type LikePayload = {
  code: string;
  source?: string;
  lane?: string | null;
  day?: string | null;
  shareUrl?: string | null;
  totalOdds?: number | null;
  confidence?: number | null;
  legs?: LikedLeg[];
};

type Sb = SupabaseClient;

/** A leg is not worth checking until roughly a full match has elapsed after kickoff. */
const MATCH_WINDOW_MS = 105 * 60_000;
const RECHECK_MS = 10 * 60_000;

export function normalizeCode(raw: string): string {
  const fromUrl = raw.match(/shareCode=([A-Za-z0-9]+)/i);
  return (fromUrl ? fromUrl[1] : raw).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function cleanLegs(raw: unknown): LikedLeg[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l) => l as Record<string, unknown>)
    .filter((l) => l && typeof l.home === "string" && typeof l.away === "string")
    .slice(0, 60)
    .map((l) => ({
      eventId: l.eventId != null ? String(l.eventId) : undefined,
      home: String(l.home),
      away: String(l.away),
      league: l.league != null ? String(l.league) : undefined,
      pickCode: l.pickCode != null ? String(l.pickCode) : undefined,
      pickLabel: String(l.pickLabel ?? l.pickCode ?? "Pick"),
      odds: Number(l.odds) || 0,
      kickoff: Number(l.kickoff) || undefined,
      sport: l.sport != null ? String(l.sport) : undefined,
      sportLabel: l.sportLabel != null ? String(l.sportLabel) : undefined,
    }));
}

/**
 * Prefer the server-side copy of a code (sure / plenty / past / generated) over whatever
 * the client sent, so the saved legs match what was actually booked.
 */
export async function resolveCode(sb: Sb, payload: LikePayload) {
  const code = normalizeCode(payload.code);
  const base = {
    code,
    source: payload.source ?? "manual",
    lane: payload.lane ?? null,
    day: payload.day ?? null,
    share_url: payload.shareUrl ?? null,
    total_odds: payload.totalOdds ?? null,
    confidence: payload.confidence ?? null,
    legs: cleanLegs(payload.legs),
  };

  const { data: sure } = await sb
    .from(T.sureCodes)
    .select("day, slot, share_url, total_odds, confidence, legs")
    .eq("code", code)
    .order("day", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sure) {
    return {
      ...base,
      source: "sure",
      lane: modeForSlot(Number(sure.slot)),
      day: sure.day,
      share_url: sure.share_url,
      total_odds: sure.total_odds,
      confidence: sure.confidence,
      legs: cleanLegs(sure.legs),
    };
  }

  const { data: plenty } = await sb
    .from(T.codes)
    .select("day, code_type, share_url, total_odds, confidence, legs")
    .eq("code", code)
    .order("day", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (plenty) {
    return {
      ...base,
      source: "codes",
      lane: String(plenty.code_type ?? "custom").toLowerCase(),
      day: plenty.day,
      share_url: plenty.share_url,
      total_odds: plenty.total_odds,
      confidence: plenty.confidence,
      legs: cleanLegs(plenty.legs),
    };
  }

  const { data: past } = await sb
    .from(T.pastCodes)
    .select("day, share_url, total_odds, confidence, legs")
    .eq("code", code)
    .order("day", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (past) {
    return {
      ...base,
      source: "past",
      day: past.day,
      share_url: past.share_url,
      total_odds: past.total_odds,
      confidence: past.confidence,
      legs: cleanLegs(past.legs),
    };
  }

  const { data: gen } = await sb
    .from(T.generatedCodes)
    .select("origin, share_url, total_odds, legs, created_at")
    .eq("code", code)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (gen) {
    return {
      ...base,
      source: "generated",
      lane: base.lane ?? String(gen.origin ?? "custom"),
      day: base.day ?? String(gen.created_at).slice(0, 10),
      share_url: gen.share_url,
      total_odds: gen.total_odds,
      legs: cleanLegs(gen.legs).length ? cleanLegs(gen.legs) : base.legs,
    };
  }

  if (!base.legs.length) {
    const share = await fetchShareCode(code);
    if (share.selections.length) {
      return {
        ...base,
        source: "manual",
        lane: base.lane ?? "custom",
        total_odds: share.totalOdds ?? null,
        legs: cleanLegs(
          share.selections.map((s) => ({
            ...s,
            pickCode: s.pickCode ?? undefined,
            kickoff: s.kickoff > 0 && s.kickoff < 1e12 ? s.kickoff * 1000 : s.kickoff,
          })),
        ),
      };
    }
  }

  return base;
}

function unit(sport?: string): string {
  switch ((sport ?? "football").toLowerCase()) {
    case "basketball":
      return "points";
    case "tennis":
      return "sets";
    case "baseball":
      return "runs";
    default:
      return "goals";
  }
}

function needed(leg: LikedLeg): string {
  const { home, away } = leg;
  const u = unit(leg.sport);
  switch (leg.pickCode) {
    case "1":
    case "BBH":
    case "TNH":
      return `${home} to win`;
    case "2":
    case "BBA":
    case "TNA":
      return `${away} to win`;
    case "X":
      return "a draw";
    case "DC1X":
      return `${home} to win or draw`;
    case "DCX2":
      return `${away} to win or draw`;
    case "DC12":
      return "either side to win (no draw)";
    case "DNBH":
      return `${home} to win (draw refunds)`;
    case "DNBA":
      return `${away} to win (draw refunds)`;
    case "O05":
      return `at least 1 ${u.replace(/s$/, "")}`;
    case "O15":
      return `2+ ${u}`;
    case "O25":
      return `3+ ${u}`;
    case "U15":
      return `1 or fewer ${u}`;
    case "U25":
      return `2 or fewer ${u}`;
    case "BTTSY":
      return "both teams to score";
    case "BTTSN":
      return "at least one team to blank";
    case "HO05":
      return `${home} to score`;
    case "AO05":
      return `${away} to score`;
    default:
      return leg.pickLabel;
  }
}

function lossCause(leg: LikedLeg, hs: number, as: number): string {
  const { home, away } = leg;
  const total = hs + as;
  const margin = Math.abs(hs - as);
  const winner = hs > as ? home : away;
  const u = unit(leg.sport);
  switch (leg.pickCode) {
    case "1":
    case "2":
    case "BBH":
    case "BBA":
    case "TNH":
    case "TNA":
      if (hs === as) return "It ended level, so a draw beat the pick. Double chance would have covered it.";
      return `${winner} won by ${margin} ${margin === 1 ? u.replace(/s$/, "") : u} instead.`;
    case "X":
    case "DC1X":
    case "DCX2":
      return `${winner} won outright by ${margin}.`;
    case "DC12":
      return "It finished level, the one result this pick excluded.";
    case "O05":
    case "O15":
    case "O25":
      return total === 0
        ? `No ${u} were scored.`
        : `Only ${total} ${total === 1 ? `${u.replace(/s$/, "")} was` : `${u} were`} scored.`;
    case "U15":
    case "U25":
      return `${total} ${u} went over the line.`;
    case "BTTSY":
      return hs === 0 && as === 0
        ? "Neither side scored."
        : `${hs === 0 ? home : away} failed to score.`;
    case "BTTSN":
      return "Both sides found the net.";
    case "HO05":
      return `${home} were kept out.`;
    case "AO05":
      return `${away} were kept out.`;
    default:
      return "The selection did not land on the final score.";
  }
}

export function explainLeg(leg: LikedLeg, hs: number, as: number, won: boolean | null): LegResult {
  const score = `${leg.home} ${hs}–${as} ${leg.away}`;
  const base = { eventId: leg.eventId, homeScore: hs, awayScore: as };
  if (won === true) {
    return { ...base, status: "won", reason: `${score}. ${leg.pickLabel} landed.` };
  }
  if (won === null) {
    if ((leg.pickCode === "DNBH" || leg.pickCode === "DNBA") && hs === as) {
      return { ...base, status: "void", reason: `${score}. Ended level, so draw-no-bet was refunded.` };
    }
    return {
      ...base,
      status: "unknown",
      reason: `${score}. This market can't be settled from the full-time score automatically. Check SportyBet.`,
    };
  }
  let reason = `${score}. Needed ${needed(leg)}. ${lossCause(leg, hs, as)}`;
  if (leg.odds > 1 && leg.odds <= 1.45) {
    reason += ` Upset: a ${leg.odds.toFixed(2)} favourite (~${Math.round(100 / leg.odds)}% implied) lost.`;
  }
  return { ...base, status: "lost", reason };
}

type HistoryHit = { home_score: number | null; away_score: number | null; won: boolean };

async function loadHistory(sb: Sb, legs: LikedLeg[]): Promise<Map<string, HistoryHit>> {
  const ids = [...new Set(legs.map((l) => l.eventId).filter(Boolean))] as string[];
  const map = new Map<string, HistoryHit>();
  if (!ids.length) return map;
  const { data } = await sb
    .from(T.legHistory)
    .select("event_id, pick_code, home_score, away_score, won")
    .in("event_id", ids)
    .not("home_score", "is", null);
  for (const r of data ?? []) {
    map.set(`${r.event_id}|${r.pick_code}`, r as HistoryHit);
  }
  return map;
}

export async function settleLegs(
  sb: Sb,
  legs: LikedLeg[],
  previous: LegResult[],
  deadline?: Pick<Deadline, "ok">,
): Promise<LegResult[]> {
  const history = await loadHistory(sb, legs);
  const now = Date.now();
  const out: LegResult[] = [];

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const prev = previous[i];
    if (prev && (prev.status === "won" || prev.status === "lost" || prev.status === "void")) {
      out.push(prev);
      continue;
    }
    if (!leg.eventId || !leg.pickCode) {
      out.push({
        eventId: leg.eventId,
        status: "unknown",
        reason: "This leg has no SportyBet event reference, so it can't be checked automatically.",
      });
      continue;
    }

    const hit = history.get(`${leg.eventId}|${leg.pickCode}`);
    if (hit && hit.home_score != null && hit.away_score != null) {
      out.push(explainLeg(leg, hit.home_score, hit.away_score, hit.won));
      continue;
    }

    if (leg.kickoff && now < leg.kickoff + MATCH_WINDOW_MS) {
      const started = now >= leg.kickoff;
      out.push({
        eventId: leg.eventId,
        status: "pending",
        reason: started ? "In play or just finished. Check again shortly." : "Not started yet.",
      });
      continue;
    }

    if (deadline && !deadline.ok(2500)) {
      out.push(prev ?? { eventId: leg.eventId, status: "pending", reason: "Waiting for result." });
      continue;
    }

    const score = await fetchFinalScore(leg.eventId);
    if (!score) {
      out.push({ eventId: leg.eventId, status: "pending", reason: "Result not published yet." });
      continue;
    }
    if (!score.ended) {
      out.push({
        eventId: leg.eventId,
        status: "pending",
        homeScore: score.home,
        awayScore: score.away,
        reason: `Not final yet (${score.home}–${score.away}).`,
      });
      continue;
    }
    out.push(explainLeg(leg, score.home, score.away, settlePick(leg.pickCode, score.home, score.away)));
  }
  return out;
}

export function summarize(
  legs: LikedLeg[],
  results: LegResult[],
): { outcome: LikedOutcome; lossSummary: string | null } {
  const lost = results
    .map((r, i) => ({ r, leg: legs[i] }))
    .filter((x) => x.r.status === "lost");
  if (lost.length) {
    const names = lost.map((x) => `${x.leg.home} v ${x.leg.away}`).join(", ");
    const lead = `${lost.length} of ${legs.length} leg${legs.length === 1 ? "" : "s"} failed: ${names}.`;
    const favourite = lost.find((x) => x.leg.odds > 1 && x.leg.odds <= 1.45);
    const extra = favourite
      ? ` The ${favourite.leg.odds.toFixed(2)} favourite losing was the biggest surprise.`
      : lost.length === 1 && legs.length >= 4
        ? " One leg short. Longer slips multiply risk even when each leg looks safe."
        : "";
    return { outcome: "LOST", lossSummary: lead + extra };
  }
  if (!results.length || results.some((r) => r.status === "pending" || r.status === "unknown")) {
    return { outcome: "PENDING", lossSummary: null };
  }
  if (results.every((r) => r.status === "void")) return { outcome: "VOID", lossSummary: null };
  return { outcome: "WON", lossSummary: null };
}

export async function settleLikedRow(
  sb: Sb,
  row: Pick<LikedRow, "id" | "legs" | "leg_results">,
  deadline?: Pick<Deadline, "ok">,
) {
  const legs = cleanLegs(row.legs);
  const results = await settleLegs(sb, legs, Array.isArray(row.leg_results) ? row.leg_results : [], deadline);
  const { outcome, lossSummary } = summarize(legs, results);
  const nowIso = new Date().toISOString();
  await sb
    .from(T.likedCodes)
    .update({
      leg_results: results,
      outcome,
      loss_summary: lossSummary,
      checked_at: nowIso,
      settled_at: outcome === "PENDING" ? null : nowIso,
    })
    .eq("id", row.id);
  return outcome;
}

/** Settle pending liked codes. Pass userId to limit to one account. */
export async function settleLikedCodes(
  sb: Sb,
  opts: { userId?: string; limit?: number; force?: boolean; deadline?: Pick<Deadline, "ok"> } = {},
): Promise<number> {
  let q = sb
    .from(T.likedCodes)
    .select("id, legs, leg_results, checked_at")
    .eq("outcome", "PENDING")
    .order("checked_at", { ascending: true, nullsFirst: true })
    .limit(opts.limit ?? 25);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data, error } = await q;
  if (error) return 0;

  let n = 0;
  const cutoff = Date.now() - RECHECK_MS;
  for (const row of data ?? []) {
    if (opts.deadline && !opts.deadline.ok(3000)) break;
    if (!opts.force && row.checked_at && new Date(row.checked_at).getTime() > cutoff) continue;
    const outcome = await settleLikedRow(sb, row as LikedRow, opts.deadline);
    if (outcome !== "PENDING") n++;
  }
  return n;
}
