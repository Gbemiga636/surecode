/**
 * Soft time budget for serverless crawls (Vercel / Netlify).
 * Vercel Hobby Fluid Compute allows long runs, but we keep a tight
 * budget so SportyBet / OpenAI hangs never crash the deploy.
 */
export function crawlBudgetMs(): number {
  const fromEnv = Number(process.env.CRAWL_BUDGET_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;

  // Vercel sets VERCEL=1
  if (process.env.VERCEL === "1") return 45_000;
  if (process.env.NETLIFY === "true" || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return 20_000;
  }
  return 90_000;
}

export function makeDeadline(ms = crawlBudgetMs()) {
  const end = Date.now() + ms;
  return {
    end,
    left: () => Math.max(0, end - Date.now()),
    ok: (needMs = 1500) => end - Date.now() > needMs,
  };
}

export type Deadline = ReturnType<typeof makeDeadline>;

/** Prefer fewer SportyBet pages under serverless pressure. */
export function fixturePageBudget(): number {
  const fromEnv = Number(process.env.SPORTY_PAGES);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.min(10, fromEnv);
  if (process.env.VERCEL === "1" || process.env.NETLIFY === "true") return 4;
  return 8;
}
