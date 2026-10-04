import { after } from "next/server";
import { logPredictions, type LogSlip } from "./prediction-log";

/**
 * Queue prediction logging to run after the response has been sent.
 * `build` runs lazily inside the guard, so even a bug while shaping the log
 * rows cannot reach the route that called this. Never throws.
 */
export function logPredictionsAfterResponse(build: () => LogSlip[] | null | undefined): void {
  try {
    if (process.env.PREDICTION_LOG_DISABLED === "1") return;
    after(async () => {
      try {
        const slips = build();
        if (slips?.length) await logPredictions(slips, { timeoutMs: 6_000 });
      } catch (e) {
        console.warn("[prediction-log] after:", e instanceof Error ? e.message : e);
      }
    });
  } catch (e) {
    console.warn("[prediction-log] schedule:", e instanceof Error ? e.message : e);
  }
}
