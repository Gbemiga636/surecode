# Final test rules (pre-registered 2026-11-03)

Written before the gate sample is complete. Nothing below may change after
the first look at the gate result. Status: **draft until Avian signs off**
(items marked *confirm*).

## 1. Question

Does the frozen Champion (`sure-engine/2026.10`) pick Safe-tier selections
that win more often than comparable selections it rejected?

## 2. Primary test (the only gate-deciding test)

| Item | Rule |
| --- | --- |
| Endpoint | `GET /api/prediction-log/selection-lift?from=2026-10-17` |
| Population | Champion candidates (`prediction_candidates`), tier `safe`, unique (event, pick), graded win/loss, evaluated before kickoff |
| Matching | `DEFAULT_LIFT_OPTIONS` as committed: implied ≥ 0.70, ±0.05 implied, 3 controls per pick, same tier / sport / market / day / lead bucket, same league when available |
| Metric | `selection_lift_pp` for the Safe tier, Newcombe 95% interval (`lift_ci95_pp`) |
| When to read | The first daily run where Safe-tier `unique_selected_n` ≥ **600** graded. One look only; no interim decisions. Expected ~Nov 30 to mid-December |
| Pass | Lower bound of the 95% interval > 0 |
| Fail | Interval includes 0 or is entirely below 0. The sample is **not** extended to chase significance (*confirm*) |

Sizing: at a ~80% hit rate with 3 controls, 600 selected picks give ~80%
power to detect a +5 pp lift (two-sided 5%).

## 3. Secondary (descriptive, not gate-deciding)

- Champion vs market Brier / log-loss skill with bootstrap CIs, **filtered to
  `product=sure-engine`**. Since 2026-10-30 the unfiltered numbers also contain
  `safe-combo` rows (published, classified `user` / `none`), so unfiltered
  overall or recent-window figures are not the Champion.
- Tier and slip-size ROI (SE Safe, Boost, Longshot; 1, 2, 3+ legs).
- H1 / H2 from `sc_hypotheses` (min n 800). H3 stays draft until its 3%
  threshold is confirmed (*confirm*).

## 4. Validity conditions (all must hold on the day of the read)

1. One Sure engine version in the window (`one_sure_engine_version = true`).
2. `tests/champion-frozen.test.ts` passes on the deployed commit: no change to
   `sure-engine.ts`, `learning.ts`, `crawl.ts`, `PICKS`, `SPORTY_SPORTS` or
   `settlePick`. Every commit in the window is listed with its row count.
3. Recovered rows excluded; only rows predicted before kickoff.
4. Customer slips created after kickoff are not logged (blocked since 53fc379)
   and the older ones stay excluded.
5. No rows left in `needs manual grading`: retirements/walkovers voided,
   stalled ITF matches graded from completed sets, the rest voided 7 days
   after kickoff.
6. No change to the slip builder, the matching options above, or this file.

If any condition fails, the result is reported as **invalid**, not as pass or
fail.

## 5. Until the read

Change nothing that affects Champion picks, candidate logging or grading.
New products (e.g. Safe combo, 4ed962b) may run but are reported separately
and never pooled with the Champion.
