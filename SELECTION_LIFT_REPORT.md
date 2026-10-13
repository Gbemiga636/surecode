# Selection Lift Report

**Question:** Are Sure Code's selected high-confidence picks genuinely better than comparable picks the system rejected?

**Period examined:** every candidate ever stored, 2026-10-08 19:18 UTC → 2026-10-13 21:20 UTC (22,069 candidate rows).
**Interim update:** 2026-10-13 22:10 UTC, after the settlement fix went live. **5,732 candidates are graded so far.** Grading by day: Oct 8 1,237/2,524 · Oct 9 2,338/4,489 · Oct 10 1,914/5,060 · Oct 11 243/3,638 · Oct 12 0/2,833 · Oct 13 0/3,525. Prediction logic was not changed.

## The three answers (interim, on what is graded now)

| | Answer |
|---|---|
| **1. Do selected high-confidence picks outperform comparable rejected picks?** | **No evidence that they do.** Safe selected picks hit **86.4%** (19 of 22). Matched rejected picks at the same odds hit **90.7%** (49 of 54). |
| **2. By how many percentage points?** | **Selection Lift = −4.4 pp** (95% interval −24.8 to +9.5 pp). Both sides averaged the same implied probability (87.2% vs 87.0%), so the match is fair. |
| **3. Is the sample large enough to trust the result?** | **No.** Only 22 selected picks are graded, and the interval spans about 34 pp and includes zero. At this point "selection adds nothing" and "selection adds ~10 pp" are both consistent with the data. About 180 graded picks are needed to detect a 10 pp lift, and about 700 for 5 pp. |

## Interim results

### How often Sure Code Safe has entered (published Safe board, pre-kickoff, since Oct 8)

| Measure | Won | Lost | Hit rate | Still pending | Void/cancelled |
|---|---|---|---|---|---|
| **Safe codes (whole slip)** | 48 | 21 | **69.6%** | 18 | 4 |
| Safe legs (individual games) | 83 | 21 | **79.8%** | 22 | 14 |

Safe codes by day (won / lost / pending): Oct 8 3/5/0 · Oct 9 15/2/0 · Oct 10 11/2/0 · Oct 11 12/6/2 · Oct 12 5/6/4 · Oct 13 2/0/12.
Codes are counted once per distinct booking code that appeared on the Safe board. The board is rebuilt hourly, so a day has more codes than the 3 Safe slots. A code wins only if no leg loses.

### Selection lift, Safe tier (high-confidence: implied ≥ 70%)

| Group | Selected n | Selected wins | Selected hit % | Matched rejected n | Rejected wins | Rejected hit % | Selection Lift | 95% interval |
|---|---|---|---|---|---|---|---|---|
| **Overall (Safe)** | 22 | 19 | 86.4 | 54 | 49 | 90.7 | **−4.4 pp** | −24.8 to +9.5 |
| Basketball | 11 | 11 | 100.0 | 26 | 23 | 88.5 | +11.5 pp | −15.4 to +29.0 |
| Football | 7 | 5 | 71.4 | 19 | 18 | 94.7 | −23.3 pp | −59.1 to +4.8 |
| Tennis | 4 | 3 | 75.0 | 9 | 8 | 88.9 | −13.9 pp | −59.7 to +24.4 |
| Market: Winner (basketball + tennis) | 15 | 14 | 93.3 | 35 | 31 | 88.6 | +4.8 pp | −19.4 to +20.3 |
| Market: Over/Under (football) | 7 | 5 | 71.4 | 19 | 18 | 94.7 | −23.3 pp | −59.1 to +4.8 |

- Same-league controls were found for 27% of the Safe picks; the rest matched on sport, market, day, lead time and odds.
- Every interval includes zero. No subgroup reaches the 30-pick minimum.

### Boost and Longshot, analysed separately (selected legs with implied ≥ 30%)

These tiers have no legs at 70% or above, so they use a lower threshold and are never pooled with Safe.

| Tier | Selected n | Selected hit % | Matched rejected n | Rejected hit % | Selection Lift | 95% interval |
|---|---|---|---|---|---|---|
| Longshot | 28 | 57.1 | 70 | 51.4 | +5.7 pp | −15.6 to +25.7 |
| Boost | 13 | 61.5 | 22 | 63.6 | −2.1 pp | −33.0 to +27.2 |

### What this means right now

- On graded data so far, the Safe engine is not picking better legs than the ones it rejects at the same price. Rejected high-confidence legs won about as often, or slightly more often.
- The graded high-confidence Safe picks won 86.4% against an average implied probability of 87.2%. That is in line with the bookmaker's price, so the selection step has added nothing measurable on top of the odds so far.
- Football Over/Under is the weakest early signal (5 of 7 against 18 of 19 rejected). Basketball Winner is the strongest (11 of 11). Neither is close to trustworthy yet.
- **Do not change the engine on these numbers.** Re-run once Oct 11–13 are graded (about 100 Safe picks), and again around Oct 25 (about 180).

## Why the full answer took this long

1. **No rejected candidates exist before 2026-10-08.** Before the Oct 8 audit deploy, the system stored only the legs it booked (`sc_leg_history`, `sc_sure_codes`). Rejected picks were never written anywhere, so there is nothing historical to compare against. Reconstructing them would mean re-running the engine with odds that are no longer available, so per the brief they were not invented.
2. **The stored candidates were never graded, because of a bug, now fixed.** Candidates have been logged since Oct 8, and settlement was meant to grade them after each audit run. But every final grading update also wrote a `result_source` column, which exists on `prediction_log` and not on `prediction_candidates`. Supabase rejected every update ("Could not find the 'result_source' column of 'prediction_candidates'"). Rows that failed never recorded the check, so the same oldest batch was retried on every run. Before the fix, all 22,069 rows were `pending`, and 17,207 past-kickoff rows had never recorded a check.
   - **Fix (this change):** settlement now drops columns the candidate table lacks (`settlePatchFor` in `src/lib/prediction-settle.ts`, with a test). Published predictions in `prediction_log` were never affected.
   - Deployed 2026-10-13. Manual backlog passes (`/api/cron/audit?candidates_only=1`) graded 5,732 rows before stopping. SportyBet throttles rapid bursts, so passes need about 30 seconds between them. The scheduled audit cron (20 runs a day) keeps grading the rest automatically.

## Coverage (all stored candidates, graded or not)

| Tier | Selected picks | Of which high-confidence (implied ≥ 70%) | Rejected candidates |
|---|---|---|---|
| Safe | 103 | **103** | 5,253 |
| Boost | 54 | 0 | 5,042 |
| Longshot | 173 | 0 | 11,444 |

- **High-confidence selections occur only in Safe.** No Boost or Longshot selection had an implied probability of 70% or more. Their selected legs all sit below 70% (Boost: 28 legs at 50–70%, 26 below 50%; Longshot: 104 at 50–70%, 69 below 50%). They can be analysed separately at their own level (`min_implied=0.3`), never pooled with Safe.
- High-confidence Safe selections by sport and market: basketball Winner 45, tennis Winner 40, football Over/Under 16, football Team Goals 1, hockey 1X2 1. Roughly 17 per day (9, 20, 18, 23, 17, 16 for Oct 8–13).
- **Matchability (dry run with results ignored):** 102 of 103 selected picks have at least one comparable rejected control, for 247 controls in total (average 2.4 per pick). Controls are from the same league for 35 of the 102 picks (34%); the rest fall back to the same sport, market, day and lead time.
- Leakage check: 0 candidates were evaluated at or after kickoff.

Expected readout once the whole backlog is graded, by group (n = selected picks):

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
