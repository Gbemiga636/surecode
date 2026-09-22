import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function load(name: string) {
  const p = resolve(process.cwd(), name);
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

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function probe(sportId: string, markets: string) {
  const url = `https://www.sportybet.com/api/ng/factsCenter/pcUpcomingEvents?sportId=${encodeURIComponent(sportId)}&marketId=${encodeURIComponent(markets)}&pageSize=3&option=1&pageNum=1`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      Referer: "https://www.sportybet.com/",
      ClientId: "web",
    },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    console.log(sportId, "NOT_JSON", text.slice(0, 120));
    return;
  }
  const tours = json?.data?.tournaments ?? [];
  console.log(sportId, "tours", tours.length, "biz", json?.bizCode);
  const ev = tours[0]?.events?.[0];
  if (!ev) return;
  console.log(" sample", ev.homeTeamName, "vs", ev.awayTeamName);
  for (const m of (ev.markets || []).slice(0, 8)) {
    console.log(
      "  m",
      m.id,
      m.name || m.desc || m.product,
      "spec",
      m.specifier,
      "outs",
      (m.outcomes || []).slice(0, 4).map((o: any) => `${o.id}:${o.desc || o.name}@${o.odds}`),
    );
  }
}

async function main() {
  await probe("sr:sport:1", "1,10,18");
  await probe("sr:sport:2", "219,225,223,1");
  await probe("sr:sport:5", "186,219,225,1");
  await probe("sr:sport:3", "1,18,219");
  await probe("sr:sport:4", "1,18,219");
  await probe("sr:sport:20", "1,18,219");
}
main().catch(console.error);
