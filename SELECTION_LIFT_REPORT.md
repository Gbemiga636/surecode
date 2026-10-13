# Selection Lift Report

**Question:** Are Sure Code's selected high-confidence picks genuinely better than comparable picks the system rejected?

**Period examined:** every candidate ever stored, 2026-10-08 19:18 UTC → 2026-10-13 21:20 UTC (22,069 candidate rows).
**Generated:** 2026-10-13. Prediction logic was not changed.

## The three answers

| | Answer |
|---|---|
| **1. Do selected high-confidence picks outperform comparable rejected picks?** | **Unknown — it cannot be measured yet.** Not one selected or rejected candidate has a graded result. |
| **2. By how many percentage points?** | **No measurement.** Selection Lift is undefined (0 graded matched pairs). No number is reported because any number would be invented. |
| **3. Is the sample large enough to trust the result?** | **No.** Graded sample = 0. Once the backlog is graded (expected within ~1–2 days of this deploy) the first read will have ~100 selected picks, which can only detect a lift of about ±13 pp. Detecting a 5 pp lift needs ~700 selected picks (~6 weeks). |

## Why there is no answer yet

1. **No rejected candidates exist before 2026-10-08.** Before the Oct 8 audit deploy, the system stored only the legs it booked (`sc_leg_history`, `sc_sure_codes`). Rejected picks were never written anywhere, so there is nothing historical to compare against. Reconstructing them would mean re-running the engine with odds that are no longer available, so per the brief they were not invented.
2. **The stored candidates were never graded, because of a bug, now fixed.** Candidates have been logged since Oct 8, and settlement was meant to grade them after each audit run. But every final grading update also wrote a `result_source` column, which exists on `prediction_log` and not on `prediction_candidates`. Supabase rejected every update ("Could not find the 'result_source' column of 'prediction_candidates'"). Rows that failed never recorded the check, so the same oldest batch was retried on every run. All 22,069 rows are still `pending`, and 17,207 past-kickoff rows have never recorded a check.
   - **Fix (this change):** settlement now drops columns the candidate table lacks (`settlePatchFor` in `src/lib/prediction-settle.ts`, with a test). Published predictions in `prediction_log` were never affected.
   - After deploy, the existing audit cron (20 runs a day) grades up to 1,500 candidates per run, so the backlog should clear in about 1–2 days.

## What is ready once results exist

Data coverage today, with results not yet used:

| Tier | Selected picks | Of which high-confidence (implied ≥ 70%) | Rejected candidates |
|---|---|---|---|
| Safe | 103 | **103** | 5,253 |
| Boost | 54 | 0 | 5,042 |
| Longshot | 173 | 0 | 11,444 |

- **High-confidence selections occur only in Safe.** No Boost or Longshot selection had an implied probability of 70% or more. Their selected legs all sit below 70% (Boost: 28 legs at 50–70%, 26 below 50%; Longshot: 104 at 50–70%, 69 below 50%). They can be analysed separately at their own level (`min_implied=0.3`), never pooled with Safe.
- High-confidence Safe selections by sport and market: basketball Winner 45, tennis Winner 40, football Over/Under 16, football Team Goals 1, hockey 1X2 1. Roughly 17 per day (9, 20, 18, 23, 17, 16 for Oct 8–13).
- **Matchability (dry run with results ignored):** 102 of 103 selected picks have at least one comparable rejected control, for 247 controls in total (average 2.4 per pick). Controls are from the same league for 35 of the 102 picks (34%); the rest fall back to the same sport, market, day and lead time.
- Leakage check: 0 candidates were evaluated at or after kickoff.

Expected first readout once the backlog is graded, by group (n = selected picks):

| Group | Selected n (approx.) | Trustworthy? |
|---|---|---|
| Overall (Safe) | ~102 | No: detects only about ±13 pp |
| Basketball (Safe, Winner) | ~44 | No |
| Tennis (Safe, Winner) | ~40 | No |
| Football (Safe; Over/Under + Team Goals) | ~17 | No |
| Markets with n ≥ 30 | basketball Winner, tennis Winner | No |

## How the matched control works (fixed now, before seeing results)

Implemented in `src/lib/selection-lift.ts` (with tests) and served read-only at `GET /api/prediction-log/selection-lift`. The same report is available to Claude as the `get_selection_lift` tool.

**Population:** `prediction_candidates` only. These are the Sure engine's own board picks; `status = selected` means the leg went into a published Sure board slip.
- Excluded: sure-combine or user-built codes, `sc_leg_history` (including the winner-only backfill rows) and any internal or generated slips.
- Only `result in (win, loss)` is counted; void and cancelled rows are dropped.

**Treated:** selected candidates with raw implied probability (1/odds) of at least 0.70.

**Controls:** rejected candidates that match on all of the following:
- the same **tier** (Safe, Boost and Longshot are never mixed; every pair is matched inside one tier)
- the same **sport**
- the same **market**
- the same **candidate day**
- the same **lead-time bucket** (evaluation → kickoff: 0–3h, 3–12h, 12–24h, 24–72h, 72h+)
- **implied probability** within ±0.05 of the selected pick
- the same **league** when such a control exists (fallback is flagged as `league_matched_share_pct`)
- a different event from the selected pick

**Matching:**
- Up to 3 nearest controls per pick by implied-probability distance, without replacement.
- Processed in evaluation-time order.
- Matching uses only fields known before kickoff (odds, evaluation time, kickoff, sport, league, market, day). Results are read only after the groups are formed. A row evaluated at or after kickoff is excluded.

**Outputs per group:**
- selected n, wins and hit rate
- matched rejected n, wins and hit rate
- **Selection Lift = selected hit rate − matched rejected hit rate**, in percentage points, with a 95% Newcombe interval
- average implied probability on both sides, to check the match is balanced
- a sufficiency flag (selected n ≥ 30)

**Breakdowns:**
- overall (pooled pairs, matched within tier)
- per tier
- per tier × sport (football, basketball, tennis, …)
- per tier × market

**How to read it:** if the 95% interval includes 0, the system has not shown it beats comparable rejected picks.

**Sample-size guide** (two-sided 5%, 80% power, hit rate ≈ 80%, ~2.4 controls per pick):

| Lift you want to be able to detect | Selected picks needed | At ~17 high-confidence picks/day |
|---|---|---|
| 13 pp | ~100 | available after backlog grading |
| 10 pp | ~180 | ~11 days |
| 5 pp | ~710 | ~6 weeks |
| 3 pp | ~2,000 | ~4 months |

## Prospective logging: exactly what is stored from now on

Every hourly crawl writes every candidate the Sure engine evaluated, selected or rejected, to `public.prediction_candidates`. One row per day × tier × event × pick. The first evaluation of the day is kept; a pick that later enters a published slip is re-marked `selected`.

| Field | What it holds | Known before kickoff? |
|---|---|---|
| `id` | row uuid | — |
| `dedupe_key` | `day\|tier\|event_id\|pick_code` | — |
| `run_id` | crawl run that produced the row; **for selected rows, now the run that selected it** | yes |
| `day` | Africa/Lagos board day | yes |
| `product_tier` | safe / boost / longshot | yes |
| `event_id`, `fixture`, `sport`, `league`, `kickoff` | match identity | yes |
| `market`, `pick_code`, `selection` | the pick | yes |
| `odds` | SportyBet price at evaluation; for selected rows, the price in the booked slip | yes |
| `raw_implied_probability` | 1/odds (generated column) | yes |
| `fair_market_probability` | de-vigged market probability when the full market is known | yes |
| `engine_score` | engine score at evaluation | yes |
| `status` | selected / rejected | yes |
| `stage` | analysis / pool / slip, i.e. how far the pick got | yes |
| `rejection_reason` | why it was rejected (e.g. "pool: sport cap reached", "learned hit rate for this market below floor") | yes |
| `slip_code` | booking code, if selected | yes |
| `model_version` | engine version (`sure-engine/2026.10`) | yes |
| `evaluated_at` | evaluation time; **for selected rows, now the time of the selecting evaluation**, so odds and lead time describe the same moment | yes |
| `created_at` | insert time | yes |
| `result` | pending / win / loss / void / cancelled (now actually filled) | **no, outcome only** |
| `final_score`, `ht_score`, `settled_at`, `settle_note`, `settle_attempts`, `last_checked_at` | settlement bookkeeping | **no, outcome only** |

**Logging changes in this update:**
- Candidate settlement is fixed, so results now get written.
- When a candidate is marked selected, `run_id` and `evaluated_at` are updated together with `odds`. Before this, selected rows kept the first evaluation's time but the slip's odds.

Logging remains fail-safe and separate from the engine: a logging failure cannot stop predictions.

## Re-running this report

- **Claude:** ask "run get_selection_lift". Add `from` and `to` to limit the window, or `min_implied=0.3` to look at Boost and Longshot.
- **HTTP:** `GET /api/prediction-log/selection-lift?from=2026-10-08` with `Authorization: Bearer <PREDICTION_LOG_API_KEY>`.
- Recommended checkpoints:
  - **~Oct 16:** backlog graded. First read, directional only (±13 pp).
  - **~Oct 25:** about 10 pp resolution.
  - **~late November:** about 5 pp resolution, the first result worth acting on.
