import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
function load(n: string) {
  const p = resolve(process.cwd(), n);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
load(".env.local");
async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data } = await sb
    .from("sc_sure_codes")
    .select("day,slot,code,outcome,total_odds")
    .gte("day", "2026-09-01");
  const rows = data || [];
  const settled = rows.filter((r) => ["WON", "LOST"].includes(String(r.outcome).toUpperCase()));
  const won = settled.filter((r) => String(r.outcome).toUpperCase() === "WON");
  const lost = settled.filter((r) => String(r.outcome).toUpperCase() === "LOST");
  const singles = settled.filter((r) => Number(r.total_odds) <= 1.35);
  const doubles = settled.filter((r) => Number(r.total_odds) > 1.35);
  const wr = (a: typeof settled) => {
    const w = a.filter((r) => String(r.outcome).toUpperCase() === "WON").length;
    return a.length ? `${((100 * w) / a.length).toFixed(1)}% (${w}/${a.length})` : "n/a";
  };
  console.log(
    JSON.stringify(
      {
        settled: settled.length,
        won: won.length,
        lost: lost.length,
        overall: wr(settled),
        singles: wr(singles),
        doublesOrLonger: wr(doubles),
        losses: lost.map((r) => ({
          day: r.day,
          slot: r.slot,
          code: r.code,
          odds: r.total_odds,
        })),
      },
      null,
      2,
    ),
  );
}
main();
