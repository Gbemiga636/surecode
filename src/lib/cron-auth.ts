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
