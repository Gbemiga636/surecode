/**
 * Past weeks Sure-code win/loss report.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function load(name: string) {
  const p = resolve(process.cwd(), name);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

load(".env.local");

type Row = {
  day: string;
  code: string;
  outcome?: string | null;
  total_odds?: number | null;
  confidence?: number | null;
  legs?: unknown[];
  slot?: number;
};

function tally(rows: Row[]) {
  const t = { WIN: 0, LOSS: 0, PENDING: 0, VOID: 0, other: 0, total: 0 };
  for (const r of rows) {
    t.total++;
    const o = String(r.outcome || "PENDING").toUpperCase();
    if (o === "WON" || o === "WIN") t.WIN++;
    else if (o === "LOST" || o === "LOSS") t.LOSS++;
    else if (o === "PENDING") t.PENDING++;
    else if (o === "VOID") t.VOID++;
    else t.other++;
  }
  const settled = t.WIN + t.LOSS;
  return {
    ...t,
    settled,
    winRate: settled ? Math.round((t.WIN / settled) * 1000) / 10 : null,
  };
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const since = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);

  const { data: past, error: e1 } = await sb
    .from("sc_past_codes")
    .select("day,code,outcome,total_odds,confidence,legs,created_at")
    .gte("day", since)
    .order("day", { ascending: false });
  if (e1) throw e1;

  const { data: sure, error: e2 } = await sb
    .from("sc_sure_codes")
    .select("day,slot,code,outcome,total_odds,confidence,status")
    .gte("day", since)
    .order("day", { ascending: false });
  if (e2) throw e2;

  const pastRows = (past || []) as Row[];
  const sureRows = (sure || []) as Row[];
  const sureCodes = new Set(sureRows.map((r) => r.code));

  // Past rows that are Sure-page codes (matched by code in sc_sure_codes)
  const pastFromSure = pastRows.filter((r) => sureCodes.has(r.code));
  // Heuristic: short slips that look like sure mode
  const pastSureLike = pastRows.filter(
    (r) =>
      sureCodes.has(r.code) ||
      (Array.isArray(r.legs) &&
        r.legs.length <= 2 &&
        Number(r.total_odds || 0) > 0 &&
        Number(r.total_odds || 0) <= 3.2),
  );

  const byWeek: Record<string, ReturnType<typeof tally>> = {};
  for (const r of pastFromSure) {
    const d = new Date(r.day + "T12:00:00Z");
    const weekStart = new Date(d);
    weekStart.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const key = weekStart.toISOString().slice(0, 10);
    byWeek[key] = byWeek[key] || tally([]);
  }
  for (const key of Object.keys(byWeek)) {
    byWeek[key] = tally(pastFromSure.filter((r) => {
      const d = new Date(r.day + "T12:00:00Z");
      const weekStart = new Date(d);
      weekStart.setUTCDate(d.getUTCDate() - d.getUTCDay());
      return weekStart.toISOString().slice(0, 10) === key;
    }));
  }

  console.log(
    JSON.stringify(
      {
        windowFrom: since,
        allPastArchive: tally(pastRows),
        sureTableDirect: tally(sureRows),
        pastMatchedToSurePage: tally(pastFromSure),
        pastSureLikeHeuristic: tally(pastSureLike),
        pastNotSure: tally(pastRows.filter((r) => !sureCodes.has(r.code))),
        surePageByWeek: byWeek,
        recentSureRows: sureRows.slice(0, 20),
        sureLosses: pastFromSure
          .filter((r) => String(r.outcome).toUpperCase() === "LOSS")
          .map((r) => ({
            day: r.day,
            code: r.code,
            odds: r.total_odds,
            legs: Array.isArray(r.legs) ? r.legs.length : 0,
          })),
        allRecentLosses: pastRows
          .filter((r) => String(r.outcome).toUpperCase() === "LOSS")
          .slice(0, 25)
          .map((r) => ({
            day: r.day,
            code: r.code,
            odds: r.total_odds,
            legs: Array.isArray(r.legs) ? r.legs.length : 0,
            fromSurePage: sureCodes.has(r.code),
          })),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
