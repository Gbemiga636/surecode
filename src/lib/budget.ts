/**
 * Soft time budget for Netlify scheduled / serverless crawls.
 * Free tier ~10s, Pro ~26s — keep a safety margin.
 */
export function crawlBudgetMs(): number {
  const fromEnv = Number(process.env.CRAWL_BUDGET_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
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
