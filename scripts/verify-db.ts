/**
 * Quick check that prefixed SureCode tables exist.
 * npx tsx scripts/verify-db.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { T } from "../src/lib/db";

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key);

const tables = Object.values(T);

(async () => {
  console.log("Checking SureCode tables on", url);
  for (const table of tables) {
    const { error } = await sb.from(table).select("*", { count: "exact", head: true });
    if (error) {
      console.log(`  FAIL ${table}: ${error.message}`);
    } else {
      console.log(`  OK   ${table}`);
    }
  }
})();
