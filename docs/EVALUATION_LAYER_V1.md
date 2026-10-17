# Evaluation layer v1 — implementation notes

Scope: data and evaluation only. The Sure engine, the slip builder and the
frozen Champion (`sure-engine/2026.10`) are unchanged; the Champion
fingerprint test (`tests/champion-frozen.test.ts`) proves it.

## Deploy steps

1. Deploy this commit (Vercel, automatic on push).
2. Run `sql/schema-eval-v1.sql` once in Supabase → SQL editor. Until then the
   app derives the same unique-selection set in code and reports
   `leg_source: js-fallback`.
3. Once, after the deploy: `GET /api/cron/audit?regrade_stale_cancels=1`
   (Bearer `CRAWL_SECRET`). This puts the rows the old 72h rule marked
   `cancelled` back to pending so the fixed settler grades them.

## Endpoints

| Endpoint | What it returns |
| --- | --- |
| `GET /api/prediction-log/evaluation` | Leg level (view), official slips, customer slips, Champion vs de-vig, recovered breakdown, acceptance checks. Query `from`, `to`, `product`, `tier`, `bootstrap`. |
| `GET /api/gpt/metrics` | Legs from the view only (retired `sc_leg_history`); official slips from `prediction_log`. |
| `GET /api/prediction-log/report?eval=1` | Leg metrics from the view; recovered rows only under `recovered_breakdown`. |
| `GET /api/prediction-log/selection-lift` | Unique selections on both sides, `unique_selected_n` / `unique_control_n`. |
| MCP `get_evaluation` | Same as the evaluation endpoint, for Claude. |

All are read-only and need `PREDICTION_LOG_API_KEY` (MCP: the full-access key).

## Task by task

### 1 + 3. `v_eval_selections`, recovered rows excluded

The view is the brief's SQL on the real table (`public.prediction_log`):
prospective, published, predicted before kickoff, graded win/loss, distinct
on (product, event_id, pick_code), earliest row. Windows filter on
`created_at` after de-duplication. `checks.leg_count_matches_view` compares
the leg count with an independent `count(*)` of the view for the same window.
`checks.recovered_rows_in_eval` is 0 by construction; recovered rows appear
only in `recovered_breakdown`.

`sc_leg_history` is no longer read by any metric endpoint. It stays as the
engine's learning input (changing that would change the Champion).

### 2. product and tier

Generated columns, so every row (old and new) is classified identically, with
check constraints for the enums. TS mirror: `productOf` / `tierOf` in
`src/lib/evaluation.ts`.

- product: sure → `sure-engine`, plenty → `plenty-codes`, predictions →
  `predictions`, builder → `combo-builder`, demo-auto → `demo`,
  book / edit-code / sure-combine → `user`.
- tier: Sure by slot (1–3 safe, 4–6 boost, 7–9 longshot); safe/SAFE → safe;
  VALUE / tip / AI / COMBO / user → none.

### 4. The 30–40% band diagnostic — root cause

Brief's query, run on all graded pre-kickoff rows with 0.30 ≤ 1/odds < 0.40:

| | Rows | Unique selections |
| --- | --- | --- |
| Graded rows in band | 51 | 4 |
| Rows where `odds = slip_odds` | 0 | — |
| Origin | all `recovered`, Sure, BTTS Yes | |
| Result | 42 / 51 won (82%) at 38.3% implied | 2 / 4 won (50%) at ~37.5% implied |

The four selections: Albania v San Marino (24 slips, won), Spain v Czechia
(18, won), Argentina v Benin (6, lost), Argentina v Burkina Faso (3, lost).

**Root cause: re-booking duplication, not wrong odds.** Leg odds multiply to
the stored slip totals, and no row has leg odds equal to slip odds, so neither
the recovery script nor live logging writes leg odds wrongly. Two winning legs
were re-booked into 42 slips, which made the band look ~45 points over
calibrated. On unique selections it is 2/4, which is noise. Affected rows: 51
(all recovered, so all excluded from evaluation by task 3). Across the whole
log the same effect holds: 2,902 graded rows hold 1,019 unique selections.

### 5. Grading

Checked against SportyBet's raw event data:

| Problem | Cause | Fix |
| --- | --- | --- |
| Tennis pending (47) | ITF / Bet Genius feeds stay `status 3, "set 2"` after the match ends (e.g. sets 0:2, games 4-6 4-6) | A decided set score (2 sets, 3 for men's Grand Slam / Davis Cup) is final |
| Hockey pending (7) | Ends in `status 3, "PostMatch"`, which wasn't treated as ended | `PostMatch` = ended |
| Hockey / baseball / football 1X2 after extra time | `setScore` includes overtime / extra innings; 1X2, DC, totals settle on regulation | Regulation score from the first 3 periods / 9 innings / 2 halves; hockey OT or shootout without periods = winner minus one goal; Winner markets (basketball, tennis) keep the final |
| Basketball pending (8) | Match postponed: SportyBet shows `Not start` with a later start | Stays pending against the new start (overdue measured from it); void if moved more than 48h |
| 241 fake cancellations | "No final result 72h after kickoff" became `cancelled` | Never invented again: no final result after 6h → parked for manual grading (and re-checked for 7 days); the 241 are reset by `regrade_stale_cancels=1` |
| ROI | void counted in the stake denominator | void / cancelled excluded from ROI at leg and slip level (never losses) |

**Baseball parser (0/15) — hand-checked on 5 events** from SportyBet's raw
data. In every case the final score equals the sum of the innings and the
grade is correct:

| Event | Final | Pick | Grade |
| --- | --- | --- | --- |
| Dodgers v Brewers (sr:match:75060878) | 2-6 | 1 (Dodgers) | loss ✔ |
| White Sox v Rockies (63303095) | 6-9 | 1 | loss ✔ |
| Rays v Guardians (75060850) | 3-7 | 1 | loss ✔ |
| Rays v Yankees (75065568) | 5-2 | 2 (Yankees) | loss ✔ |
| Yankees v Rays (75065572) | 3-4 | 1 | loss ✔ |

The 0/15 is real: 15 leg rows are only 5 unique selections, all lost. The
latent bug was extra innings: baseball "1X2" on SportyBet is three-way (draw
priced ~7.75), i.e. nine innings, and is now graded that way.

Acceptance: `checks.pending_overdue_6h` should read 0 after the first hourly
audit runs; anything genuinely unresolvable is listed under
`checks.needs_manual_grading` instead of being faked.

### 6. Full market at prediction time

New live rows in `prediction_log` and `prediction_candidates` carry:

- `market_odds` — every outcome price of the predicted market, outcome ids,
  capture time and source (`fixture-feed` = the exact prices the engine just
  fetched; `event-api` = fetched for events not in that feed).
- `overround` = Σ(1/odds) / k − 1.
- `devig_prob` = (1/odds) / Σ(1/odds) × k — proportional de-vig
  (k = 2 for double chance, whose outcomes each cover two results).

No backfill; recovered rows are never filled. Coverage:
`checks.devig_coverage_log` / `devig_coverage_candidates`.

### 7. Champion frozen

Every live log and candidate row carries `model_version` and `app_commit`.
`CHAMPION_FINGERPRINT` (sha256 of `sure-engine.ts`, `learning.ts`,
`crawl.ts`, `PICKS`, `SPORTY_SPORTS`, `settlePick`) is checked by
`npm test`: any engine change fails the test until `ENGINE_VERSION` is bumped.
`checks.one_sure_engine_version` reports the versions in the window (today:
only `sure-engine/2026.10`).

### 8. Selection lift on unique selections

Candidates are de-duplicated per tier on (event_id, pick_code) before
matching — the earliest selected row if the engine ever selected it,
otherwise the earliest rejected one — so the same fixture logged on two days
counts once on either side. Responses carry `unique_selected_n` and
`unique_control_n`.

### 9. Three levels

- **Leg:** `v_eval_selections`.
- **Official slip:** published, prospective, grouped by `slip_code`; only
  slips created before their first kickoff.
- **Customer slip:** `book`, `builder`, `sure-combine` — booked by the server
  at creation. `edit-code` (starts from a code the user pasted) and
  `demo-auto` (no booking code) are excluded. Slips created after their first
  kickoff are excluded and counted.

Void legs drop out of slip payouts; void slips are outside the ROI
denominator.

### 10. Champion vs de-vigged market

On the same unique selections (rows lacking either forecast are excluded from
both): Brier, log loss, ECE, skill = 1 − metric(Champion) / metric(de-vig),
and 95% bootstrap intervals (1,000 resamples of unique selections, fixed seed).
The Champion's forecast is its logged `confidence` (today the
bookmaker-implied 1/odds). This fills up as task 6 rows are graded; quote it
only once the Safe tier reaches about 600 unique selections.

## Baseline at release (before the migration, JS fallback)

| Product / tier | Unique selections | Hit rate (95% CI) | Avg implied |
| --- | --- | --- | --- |
| sure-engine / safe | 94 | 86.2% (77.8–91.7) | 87.0% |
| sure-engine / boost | 43 | 58.1% (43.3–71.6) | 49.5% |
| sure-engine / longshot | 147 | 53.1% (45.0–61.0) | 53.6% |
| plenty-codes / safe | 72 | 91.7% (83.0–96.1) | 93.5% |
| plenty-codes / none | 35 | 71.4% (54.9–83.7) | 69.2% |
| predictions / none | 56 | 75.0% (62.3–84.5) | 76.1% |

Total 447 unique prospective selections; 0 recovered rows; one Sure engine
version. Safe has 94 of the ~600 unique selections needed before rerunning
selection lift and model-vs-market.
