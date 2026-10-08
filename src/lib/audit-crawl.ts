import { auditDisabled, auditWarn } from "./audit-db";
import { crawlBudgetMs, type Deadline } from "./budget";
import type { CandidateStore } from "./candidate-trace";
import { logCandidates } from "./candidate-log";
import { logPredictions, type LogSlip } from "./prediction-log";
import { runAuditMaintenance } from "./prediction-settle";

/** Most the audit may add to a crawl. */
const AUDIT_RESERVE_MS = 14_000;
/** /api/crawl's maxDuration (120s) minus a safety margin. */
const VERCEL_FUNCTION_MS = 114_000;

/**
 * Time the audit may use after a crawl. The crawl's own soft budget is
 * normally spent to the last millisecond, so this is measured against the
 * function's hard limit instead (the headroom maxDuration leaves after the
 * crawl budget), never the crawl's leftovers.
 */
export function auditBudgetAfterCrawl(deadline: Deadline): number {
  const started = deadline.end - crawlBudgetMs();
  const hardEnd = started + (process.env.VERCEL === "1" ? VERCEL_FUNCTION_MS : crawlBudgetMs() + 4_000);
  return Math.max(0, Math.min(AUDIT_RESERVE_MS + deadline.left(), hardEnd - Date.now()));
}

/**
 * Everything the audit does after a crawl: log published predictions, log the
 * candidate universe, and — only if plenty of time is left — run a settlement
 * pass (the hourly /api/cron/audit does that job otherwise). `build` runs
 * inside the guard. Never throws.
 */
export async function auditAfterCrawl(input: {
  day: string;
  build: () => LogSlip[];
  candidates: CandidateStore;
  budgetMs: number;
}): Promise<void> {
  try {
    if (auditDisabled() || input.budgetMs < 1_500) return;
    const started = Date.now();
    const left = () => input.budgetMs - (Date.now() - started);

    await logPredictions(input.build(), { timeoutMs: Math.min(6_000, left() - 500) });
    if (left() > 2_500) {
      await logCandidates(
        input.candidates,
        { day: input.day, runId: new Date(started).toISOString() },
        Math.min(10_000, left() - 500),
      );
    }
    if (left() > 20_000) await runAuditMaintenance({ budgetMs: left() - 2_000, closing: false });
  } catch (e) {
    auditWarn("after crawl", e);
  }
}
