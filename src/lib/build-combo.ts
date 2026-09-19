/**
 * Condition-based combo builder: user picks markets (O0.5, BTTS, DC…)
 * → AI/analysis ranks best fixtures → SportyBet booking codes.
 */
import {
  BUILDER_MARKETS,
  type BuilderCondition,
} from "./builder-markets";
import { createClient } from "@supabase/supabase-js";
import { T } from "./db";
import {
  buildLearningSnapshot,
  scoreLeg,
  type LegHistoryRow,
} from "./learning";
import { chatPlain } from "./openai";
import {
  createBookingCode,
  getSportyFixtures,
  impliedProb,
  PICKS,
  sportyOpenUrl,
  type BookableLeg,
  type SbEvent,
} from "./sporty";

export type { BuilderCondition };
export { BUILDER_MARKETS };

export type BuilderRequest = {
  conditions: BuilderCondition[];
  legs?: number;
  maxOdds?: number;
  minOdds?: number;
  slips?: number;
};

export type BuilderSlip = {
  label: string;
  rationale: string;
  legs: BookableLeg[];
  totalOdds: number;
  confidence: number;
  code?: string;
  shareUrl?: string;
  error?: string;
};

export type BuilderResult = {
  ok: boolean;
  scanned: number;
  matched: number;
  slips: BuilderSlip[];
  error?: string;
};

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadSnap() {
  const sb = admin();
  if (!sb) return buildLearningSnapshot([]);
  const { data } = await sb
    .from(T.legHistory)
    .select(
      "event_id, home, away, league, pick_code, pick_label, odds, home_score, away_score, won",
    )
    .order("settled_at", { ascending: false })
    .limit(1200);
  return buildLearningSnapshot((data ?? []) as LegHistoryRow[]);
}

type Ranked = BookableLeg & { score: number; why: string };

function deVig(ev: SbEvent) {
  const h = ev.outcomes["1"];
  const d = ev.outcomes.X;
  const a = ev.outcomes["2"];
  if (!h || !d || !a) return null;
  const s = 1 / h + 1 / d + 1 / a;
  return { home: 1 / h / s, draw: 1 / d / s, away: 1 / a / s };
}

function scoreKnown(
  ev: SbEvent,
  code: string,
  minOdds: number,
  maxOdds: number,
  snap: ReturnType<typeof buildLearningSnapshot>,
): Ranked | null {
  const meta = PICKS[code];
  const odds = ev.outcomes[code];
  if (!meta || !odds || odds < minOdds || odds > maxOdds) return null;

  const leg: BookableLeg = {
    eventId: ev.eventId,
    marketId: meta.marketId,
    specifier: meta.specifier,
    outcomeId: meta.outcomeId,
    home: ev.home,
    away: ev.away,
    league: ev.league,
    kickoff: ev.kickoff,
    pickCode: code,
    pickLabel: meta.label.replace("Home", ev.home).replace("Away", ev.away),
    odds,
    implied: impliedProb(odds),
  };

  let score = scoreLeg(leg, snap);
  const probs = deVig(ev);
  const why: string[] = [`@${odds.toFixed(2)} (~${Math.round(leg.implied * 100)}%)`];

  if (probs) {
    if (code === "1" || code === "DC1X" || code === "DNBH" || code === "HO05") {
      if (probs.home < 0.38) return null;
      score += probs.home;
      why.push(`home fav ${Math.round(probs.home * 100)}%`);
    }
    if (code === "2" || code === "DCX2" || code === "DNBA" || code === "AO05") {
      if (probs.away < 0.38) return null;
      score += probs.away;
      why.push(`away fav ${Math.round(probs.away * 100)}%`);
    }
    if (code === "O05" || code === "O15" || code === "O25") {
      if (probs.draw > 0.36 && code !== "O05") score -= 0.3;
      score += leg.implied * 0.8;
    }
  }

  // Prefer shorter prices for hit rate on user-selected markets
  if (odds <= 1.4) score += 0.35;
  else if (odds <= 1.7) score += 0.15;

  return { ...leg, score, why: why.join(" · ") };
}

const EVENT_API = "https://www.sportybet.com/api/ng/factsCenter/event?eventId=";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function findCornerLeg(
  ev: SbEvent,
  line: 8.5 | 9.5,
  minOdds: number,
  maxOdds: number,
): Promise<Ranked | null> {
  try {
    const res = await fetch(EVENT_API + encodeURIComponent(ev.eventId), {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        Referer: "https://www.sportybet.com/",
        ClientId: "web",
      },
      signal: AbortSignal.timeout(Number(process.env.SPORTY_FETCH_MS) || 8_000),
    });
    const json = (await res.json()) as {
      data?: {
        markets?: {
          id?: string | number;
          name?: string;
          desc?: string;
          specifier?: string;
          outcomes?: { id?: string | number; odds?: string; desc?: string; name?: string }[];
        }[];
      };
    };
    const markets = json?.data?.markets ?? [];
    const wanted = `total=${line}`;
    for (const m of markets) {
      const name = `${m.name ?? ""} ${m.desc ?? ""}`.toLowerCase();
      if (!name.includes("corner")) continue;
      const spec = String(m.specifier ?? "");
      if (spec !== wanted && !spec.includes(String(line))) continue;
      const over = (m.outcomes ?? []).find((o) => {
        const d = `${o.desc ?? ""} ${o.name ?? ""}`.toLowerCase();
        return d.includes("over") || String(o.id) === "12";
      });
      const odds = over ? Number(over.odds) : NaN;
      if (!Number.isFinite(odds) || odds < minOdds || odds > maxOdds) continue;
      const marketId = String(m.id ?? "");
      const outcomeId = String(over!.id ?? "12");
      if (!marketId || !outcomeId) continue;
      const implied = impliedProb(odds);
      return {
        eventId: ev.eventId,
        marketId,
        specifier: spec || wanted,
        outcomeId,
        home: ev.home,
        away: ev.away,
        league: ev.league,
        kickoff: ev.kickoff,
        pickCode: line === 8.5 ? "CORNERS_O85" : "CORNERS_O95",
        pickLabel: `Over ${line} Corners`,
        odds,
        implied,
        score: implied * 2.2 + (odds <= 1.55 ? 0.4 : 0),
        why: `corner market @${odds.toFixed(2)}`,
      };
    }
  } catch {
    /* no corners on this event */
  }
  return null;
}

function packSlips(
  ranked: Ranked[],
  legsWanted: number,
  maxComboOdds: number,
  slipCount: number,
): Ranked[][] {
  const packs: Ranked[][] = [];
  const used = new Set<string>();
  const sorted = [...ranked].sort((a, b) => b.score - a.score);

  for (let s = 0; s < slipCount; s++) {
    const pack: Ranked[] = [];
    let combo = 1;
    for (const leg of sorted) {
      if (pack.length >= legsWanted) break;
      if (used.has(leg.eventId)) continue;
      if (combo * leg.odds > maxComboOdds && pack.length > 0) continue;
      pack.push(leg);
      combo *= leg.odds;
    }
    if (!pack.length) break;
    for (const l of pack) used.add(l.eventId);
    packs.push(pack);
  }
  return packs;
}

async function explain(
  conditions: string[],
  legs: Ranked[],
  totalOdds: number,
): Promise<string> {
  const block = legs.map((l) => `${l.home} vs ${l.away}: ${l.pickLabel} ${l.why}`).join("\n");
  const text = await chatPlain({
    system:
      "You are a football betting analyst. Explain briefly why these legs fit the user's selected markets. 2–3 sentences. No guarantees.",
    user: `User conditions: ${conditions.join(", ")}\nCombined odds ${totalOdds.toFixed(2)}\nLegs:\n${block}`,
    temperature: 0.3,
    maxTokens: 180,
  });
  if (text) return text;
  return (
    `Best ${legs.length}-leg combo for ${conditions.join(" + ")} after live odds analysis. ` +
    `Odds ~${totalOdds.toFixed(2)}. Not a guarantee.`
  );
}

export async function buildConditionCombos(req: BuilderRequest): Promise<BuilderResult> {
  const conditions = [...new Set(req.conditions || [])];
  if (!conditions.length) {
    return { ok: false, scanned: 0, matched: 0, slips: [], error: "Select at least one market" };
  }

  const legsWanted = Math.min(6, Math.max(1, req.legs ?? 2));
  const minOdds = Math.max(1.05, req.minOdds ?? 1.15);
  const maxOdds = Math.min(4.5, req.maxOdds ?? (legsWanted <= 2 ? 1.85 : 2.2));
  const slipCount = Math.min(4, Math.max(1, req.slips ?? 3));
  const maxComboOdds = legsWanted === 1 ? maxOdds : Math.min(12, maxOdds ** legsWanted * 1.15);

  const now = Date.now();
  const fixtures = (await getSportyFixtures(8)).filter(
    (e) => e.kickoff > now + 30 * 60_000 && e.kickoff < now + 48 * 3600_000,
  );
  const snap = await loadSnap();
  const ranked: Ranked[] = [];
  const needsCorners = conditions.some((c) => c.startsWith("CORNERS_"));

  for (const ev of fixtures) {
    for (const cond of conditions) {
      const meta = BUILDER_MARKETS.find((m) => m.id === cond);
      if (!meta) continue;

      if (meta.dynamic === "corners") {
        continue; // handled in second pass on top fixtures
      }

      for (const code of meta.codes) {
        const hit = scoreKnown(ev, code, minOdds, maxOdds, snap);
        if (hit) ranked.push(hit);
      }
    }
  }

  if (needsCorners) {
    const top = [...fixtures]
      .sort((a, b) => {
        const pa = deVig(a);
        const pb = deVig(b);
        const sa = pa ? Math.max(pa.home, pa.away) : 0;
        const sb = pb ? Math.max(pb.home, pb.away) : 0;
        return sb - sa;
      })
      .slice(0, 18);

    for (const ev of top) {
      if (conditions.includes("CORNERS_O85")) {
        const c = await findCornerLeg(ev, 8.5, minOdds, Math.max(maxOdds, 2.4));
        if (c) ranked.push(c);
      }
      if (conditions.includes("CORNERS_O95")) {
        const c = await findCornerLeg(ev, 9.5, minOdds, Math.max(maxOdds, 2.6));
        if (c) ranked.push(c);
      }
    }
  }

  // One best leg per event
  const byEvent = new Map<string, Ranked>();
  for (const r of ranked.sort((a, b) => b.score - a.score)) {
    if (!byEvent.has(r.eventId)) byEvent.set(r.eventId, r);
  }
  const unique = [...byEvent.values()].sort((a, b) => b.score - a.score);

  if (!unique.length) {
    return {
      ok: false,
      scanned: fixtures.length,
      matched: 0,
      slips: [],
      error: "No fixtures matched those markets today. Try Over 0.5 / Double Chance or widen odds.",
    };
  }

  const packs = packSlips(unique, legsWanted, maxComboOdds, slipCount);
  const labels = conditions.map(
    (c) => BUILDER_MARKETS.find((m) => m.id === c)?.label ?? c,
  );

  const slips: BuilderSlip[] = [];
  for (let i = 0; i < packs.length; i++) {
    const pack = packs[i];
    const totalOdds = pack.reduce((a, l) => a * l.odds, 1);
    const confidence = pack.reduce((a, l) => a * l.implied, 1);
    const rationale = await explain(labels, pack, totalOdds);
    const booked = await createBookingCode(pack);
    slips.push({
      label: `${labels.slice(0, 2).join(" · ")}${labels.length > 2 ? "…" : ""} · ${pack.length}-fold`,
      rationale,
      legs: pack,
      totalOdds,
      confidence,
      code: booked.code,
      shareUrl: booked.code ? booked.url || sportyOpenUrl(booked.code) : undefined,
      error: booked.error,
    });
  }

  return {
    ok: slips.some((s) => Boolean(s.code)),
    scanned: fixtures.length,
    matched: unique.length,
    slips,
    error: slips.every((s) => !s.code)
      ? "Analysis found legs but SportyBet booking failed — try again shortly"
      : undefined,
  };
}
