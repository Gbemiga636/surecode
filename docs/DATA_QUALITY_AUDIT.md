# Data quality audit — 8 Oct 2026

Scope: `sc_past_codes` (1,396 codes), `sc_sure_codes` (150 rows),
`sc_leg_history` (242 rows), `sc_crawl_runs` (656 runs) and `prediction_log`.
Every finding below was measured on production data. Severity reflects how
much the issue distorts any performance claim.

## Critical

### 1. `prediction_log` stayed empty from 4 to 8 Oct (fixed)

The v1 logger ran at the end of each crawl with the crawl's *leftover* time.
Every crawl spends its full 100 s budget (`leftMs` is 0–1,137 ms in every
run), so the logger always skipped itself.

**Fix:**
- Crawl-time logging now has its own reserve (up to 14 s), measured against
  the function's hard 120 s limit.
- The hourly `/api/cron/audit` recovers any stored Sure code that wasn't
  logged, keeping its original creation time.
- A test insert through the app's own path confirmed writes work, and
  recovery of the last day produced 213 rows, all made before kickoff.

### 2. Legacy settlement starves; most results are never recorded

- 1,143 of 1,396 past codes (82%) are still `PENDING`.
- Every `sc_sure_codes` row from 22 Sep onward is `PENDING`.
- `settlePendingCodes` reads the newest pending codes first (8 past and
  5 Sure codes per pass). Today's unplayed codes always fill that window, so
  older, finished codes are never reached.
- The Sure-code stall begins exactly when the board grew from 3 to 6 slots a
  day (23 Sep), which is more than the 5-row window.
- On top of that, the crawl rarely has time left for it: `settled=0` in
  nearly every run since 1 Oct.

**Status:**
- The audit log no longer depends on this. It has its own settler that takes
  the oldest-checked rows first, with retries and attempt counters, on a
  dedicated hourly cron.
- The legacy settler was **not** changed, because it feeds `sc_leg_history`,
  which the engine learns from. Fixing it would immediately change today's
  picks. This needs a decision (see the end of this document).

### 3. The learning sample contains winners-only rows

- 61 of 242 `sc_leg_history` rows (25%) have no score and are all wins. They
  were written by `backfillWonSlips` on 23–27 Sep, which copies the legs of
  WON slips without any matching losses.
- `loadLegHistory` feeds them into the learning snapshot, so learned hit rates
  and the elite/avoid lists are biased upward.
- **Status:** documented, not changed (changing it changes picks).

### 4. Leg confidence is the bookmaker's price, not a model probability

- Per-leg `confidence` equals 1/odds exactly (confirmed on recovered rows,
  e.g. 2.01 → 0.4975).
- Calibration tables of "confidence" therefore measure the market, margin
  included. The report scores logged confidence and bookmaker-implied
  probability side by side, and the candidate log stores the de-vigged
  market probability where the full market is known.

## High

### 5. `sc_leg_history.settled_at` is a last-touch time

Every upsert rewrites it, including the backfill, which re-touches winning
legs. Daily views of the ledger are therefore meaningless: it shows a 24% leg
hit rate before 29 Sep and 91% after, purely from rewriting. Do not use this
table for time series.

### 6. The same leg is counted in many slips

The board is rebuilt and re-booked every hour (61–91 new Sure codes a day), so
one selection can sit in up to roughly 24 published slips. Per-row leg stats
weight it accordingly. The report now adds `unique_selections` (one row per
source, tier, event and market, first publication kept).

### 7. Settled history is a non-random subset

Which codes got settled depended on their timing relative to crawl runs (see
item 2), not on chance. Treat any historic win rate as indicative only. Era
comparisons are in `CHANGE_POINT_AUDIT.md`.

### 8. LOST slips without a recorded losing leg

18 of 106 LOST past codes have no leg marked lost in `sc_leg_history`. Causes
include leg rows that were never written (legs graded `null` are skipped), or
legs later re-touched by the backfill. The leg ledger and slip outcomes are
not fully consistent.

## Medium

### 9. A whole slip turns VOID when any leg can't be graded

`settleOneSlipDetailed` returns VOID whenever any leg grades `null`:
first-half markets (no half-time score), a Draw No Bet that ends level, or an
unknown market code. That happens even if another leg lost or the rest won.

Bookmakers void only the affected leg. Observed impact so far: 1 VOID slip,
containing a Draw No Bet leg. No first-half market has ever been selected in
1,396 codes, so that path hasn't fired yet. The audit settler grades per leg:
a level DNB is `void`, and a first-half leg without a half-time score is
flagged `needs manual grading`.

### 10. The crawl budget is fully consumed by Sure building

`plenty=0` in every recent run, and pick pools only refresh when time is
left. Plenty codes and tips are mostly not regenerated, and legacy settlement
has no time (item 2). The audit work now runs outside that budget.

### 11. No sport column in the leg ledger

`sc_leg_history` has no sport. The audit log derives sport from the market
code and fixture metadata (`sport` column).

## Checked and clean

- No slip was created after its first kickoff (0 late codes).
- No duplicate (day, code) pairs in `sc_past_codes`.
- No WON slip contains a leg recorded as lost.
- Crawl reliability: 646 of 656 runs succeeded (98.5%). Failures: 13 Sep (1),
  14 Sep (1), 18 Sep (3), 26 Sep (4), plus one run still in progress at audit
  time.

## Audit log guarantees now in place

| Requirement | How |
| --- | --- |
| Every completed match settles | Hourly cron, oldest-checked first, retries with attempt counters. Cancelled only when SportyBet itself says so, or answers "no result" 3+ times more than 72 h after kickoff. A failed lookup never cancels; after 12 failures the row is parked for manual grading. Updates touch `pending` rows only. |
| Stable ids | `prediction_id` (`pl_` + sha256 of the dedupe key) and `event_id` on every row. Legs without an event id are not logged. |
| Model version | `model_version` = logic version; `app_commit` = deployed commit. |
| Closing odds | Last pre-kickoff price from the SportyBet pre-match feed, refreshed hourly (`closing_odds`, `closing_odds_at`, `closing_odds_source`). |
| History | `data_origin` = `prospective` (logged live) or `recovered` (rebuilt from a stored code, original time kept). Both are pre-kickoff predictions. |
| Fail-safe | Every audit function catches its own errors and runs under a timeout. Crawl logging runs after the codes are saved; user routes log after the response is sent. |

## Decision needed

Fixing items 2, 3 and 9 in the legacy tables would make the user-facing
"past codes" results complete. It would also immediately change what the
learning layer sees, and with it today's picks. Per the instruction not to
change prediction logic yet, these are left for an explicit go-ahead. The
audit log is complete and reliable without them.
