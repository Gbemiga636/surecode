/**
 * Local / CI crawl: npx tsx scripts/crawl.ts
 * Loads .env.local manually.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { runSureCrawl } from "../src/lib/crawl";

function loadEnvFile(name: string) {
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

loadEnvFile(".env.local");
loadEnvFile(".env");

runSureCrawl()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
