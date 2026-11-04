import { runtimeConfig } from "./runtime-config";

/** Same secrets as /api/crawl: Vercel Cron's CRON_SECRET, or CRAWL_SECRET for manual / pg_cron runs. */
export function isCronAuthorized(request: Request): boolean {
  const crawlSecret = process.env.CRAWL_SECRET || "";
  const cronSecret = process.env.CRON_SECRET || "";
  const hdr = request.headers.get("x-crawl-secret") || "";
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (crawlSecret && (hdr === crawlSecret || bearer === crawlSecret)) return true;
  if (cronSecret && bearer === cronSecret) return true;
  return false;
}

/** isCronAuthorized, or the pg_cron token generated in the database (sc_runtime_config.cron_token). */
export async function isScheduledCronAuthorized(request: Request): Promise<boolean> {
  if (isCronAuthorized(request)) return true;
  const token = (request.headers.get("x-surecode-cron") || "").trim();
  if (token.length < 32) return false;
  const cfg = await runtimeConfig();
  return Boolean(cfg?.cron_token) && token === cfg!.cron_token;
}
