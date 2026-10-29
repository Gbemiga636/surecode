# Evaluation v3 — sharp-line test (Brief v3, Oct 23)

Goal: by early December, know whether picks have a real edge against a sharp
bookmaker's price. Measurement and data only: the Champion, the slip builder
and every user-facing screen are unchanged (`tests/champion-frozen.test.ts`
still passes), no de-vig or sharp odds are backfilled, and shadow / hypothesis
picks and sharp prices are never shown to users.

## Deploy

1. Supabase → SQL editor: run `sql/schema-eval-v3.sql` (after v1). Adds
   `p_fair`, `devig_method`, `sporty_close`, the sharp / map / probe tables,
   the hypothesis registry (H1 and H2 frozen at run time, H3 draft), the shadow
   table, and recreates `v_eval_selections` with `clv_sporty` / `clv_sharp`.
   Don't re-run `schema-eval-v1.sql` afterwards (its view is narrower).
2. Vercel env: `SHARP_ODDS_API_KEY` = a pinnodds.com trial key (free, no card).
   Optional: `SHARP_SPORTS` (default `football,tennis,basketball,hockey`),
   `SHARP_CLOSE_WINDOW_MIN` (default 70; set 10 on a 5-minute schedule),
   `SHARP_PROBE=0` to stop Phase 0 pairs after the test.
3. Supabase: enable `pg_cron` + `pg_net`, store the cron secret in Vault and run
   `sql/schedule-v3.sql` (closing job every 5 min; sharp job hourly on the trial).

Until step 1 runs the app keeps working and skips every v3 write
(`auditSchema().evalV3`).

## Endpoints (read-only, `PREDICTION_LOG_API_KEY`; also MCP tool `get_v3_report`)

`GET /api/prediction-log/v3?section=…`

| section | brief task |
|---|---|
| `weekly` (default) | Monday report: phase progress + acceptance, integrity, hypotheses, selection lift |
| `coverage` | 0.1 candidate volume by sport / market / league |
| `devig` | B1 method comparison |
| `phase0` | 0.4 gap frequency / duration and go/no-go (`threshold`, default 0.03) |
| `sharp` | C1 sharp coverage at creation |
| `mapping-sample` | C2 200-row spot-check sample (`n`) |
| `hypotheses` | D1–D4 frozen hypotheses on shadow rows |
| `patterns` | D5 descriptive scanner (`min_n`, default 400) |

Jobs (Bearer `CRAWL_SECRET`): `/api/cron/closing` (B2), `/api/cron/sharp`
(0.3 / C1 / C2 / H3 shadow rows). Shadow selections are graded by the existing
`/api/cron/audit` pass.

## Phase 0

**0.1 coverage** (unique event + pick, Oct 17 – Oct 29): 16,333 selections on
7,236 events. Football 59.2%, tennis 21.1% (ITF 11.4%, Challenger 3.8%,
ATP/WTA 3.7%, other 2.2%), basketball 10.8%, hockey 8.8%, baseball 0.05%.
Largest markets: tennis Winner, basketball Winner, football Double Chance,
Over/Under, hockey 1X2, Draw No Bet. Live table: `section=coverage`.

**0.2 provider: pinnodds.com (Pinnacle).** Pinnacle closed its public API in
July 2025; pinnodds resells the Pinnacle feed. One request returns a whole
sport's prematch board (money line, totals, team totals, first half), so cost
scales with sports, not events: 4 sports = 4 requests per poll.

| provider | sharp book | ITF / Challenger | cost for our volume |
|---|---|---|---|
| pinnodds trial | Pinnacle | yes | $0 — 100 req/day → 4 sports hourly (96/day) |
| pinnodds Pro | Pinnacle | yes | $99/mo — 10 req/s → 4 sports every 5 min (1,152/day) |
| The Odds API | Pinnacle (eu, delayed) | no | 1 request per league; our football alone spans 100+ leagues; free 500 credits/month |
| odds-api.io | no Pinnacle | — | free tier closed to new keys |

Coverage ceiling: Pinnacle's board has no BTTS, and its hockey money line
includes overtime (our hockey 1X2 is regulation time), so those selections
count as uncovered, roughly 15% of volume. Measured coverage per sport is in
`section=sharp` after the first run; the 80% requirement is judged on that.

**0.3 / 0.4** `/api/cron/sharp` logs, per run, SportyBet's price and the sharp
fair probability for every matched in-scope selection kicking off within 12 h
(`sc_line_probe`, both timestamps). `section=phase0` counts episodes where
`sporty_odds ≥ sharp_fair_odds × 1.03` and brackets each duration by the poll
interval. **Go** = ≥ 5 gaps/day and median duration ≥ 10 min. With hourly
trial polling a gap seen in two consecutive polls proves ≥ 60 min; a gap seen
once is reported as `inconclusive`. In that case, poll two sports every
30 min (`SHARP_SPORTS=football,tennis`, schedule `*/30`) before considering a
paid plan, since the budget allows paid plans only after C2.

## Phase A

- **A1: no scoring change.** The engine files (sure-engine, learning, crawl,
  sporty, picks, sure-mode, openai, pools, candidate-trace) are identical
  across 42340a2 → 28a490a → 1c0a0bf. 1c0a0bf → e028131 adds 35 lines to
  `sporty.ts` (market-price capture) and removes none, so `parseEvent` output is
  unchanged. Everything else that changed is audit-only. The Champion
  fingerprint test confirms it. No rows need tagging.
- **A2: manual grading.** The 50 published legs (all tennis Winner) had two
  causes:
  1. Retirement / walkover (29 rows). SportyBet voids undecided markets, so
     these are now graded `void` automatically.
  2. ITF events fed by Bet Genius (21 rows, ids `sr:match:1111111146…`). The
     feed freezes after the last point, e.g. `setScore 1:0` but game scores
     `6:3, 6:3`. Completed sets are now counted from the game scores, so these
     grade normally.

  Anything still ungradeable 7 days after kickoff is voided with the note
  `void: no gradeable result from SportyBet 7 days after kickoff (…)`. Parked
  rows of every reason are re-checked on each audit run, so the backlog
  (log 53, candidates 975 on Oct 29) drains on the first runs after deploy.
  Acceptance (0 for 7 days) is tracked in the weekly report.
- **A3: late customer slips.** `logPredictions` no longer logs a book /
  builder / sure-combine slip whose first leg had already kicked off; booking
  is unaffected. The existing case is slip `SFKA5Y` (source `book`, origin
  `picks-goals`, 12 legs): logged Oct 13 14:21 UTC with leg kickoffs of
  Sep 26. The client sent picks from a 17-day-old list, and the log trusted
  the client's kickoff times. It was already excluded from customer-slip
  metrics. Since Oct 17, `all_created_before_first_kickoff = true`.
- **A4:** `docs/EVALUATION_LAYER_V1.md`: 51 rows / 4 unique selections /
  0 odds = slip_odds; rebooking duplication; all recovered.
- **A5:** selection lift reports `unique_selected_n` / `unique_control_n`;
  the weekly report quotes them. On Oct 29: +7.2 pp, 95% CI [−0.6, +13.9],
  134 selected vs 311 controls.

## Phase B

**B1** (`section=devig`). 12,593 unique graded candidates since Oct 17 with a
full market snapshot. No candidate was priced at 3.00 or above.

| method | log loss | Brier | ECE | mean p (hit 0.6394) |
|---|---|---|---|---|
| proportional | **0.6098** | **0.2111** | **0.0085** | 0.6379 |
| Shin | 0.6099 | 0.2112 | 0.0109 | 0.6464 |
| power | 0.6105 | 0.2114 | 0.0158 | 0.6513 |

By odds band, Shin is marginally better below 1.30 (0.4879 vs 0.4883) and
proportional wins elsewhere. **Adopted: proportional, frozen 2026-10-29**
(`P_FAIR_METHOD` in `src/lib/devig.ts`). New log and candidate rows store
`p_fair` + `devig_method`. Double chance is de-vigged through the underlying
1X2.

**B2.** `/api/cron/closing` every 5 min prices every published and shadow
selection kicking off in the next 10 min from SportyBet's event API and
overwrites `sporty_close` / `sporty_close_at`, so the stored price is the last
one seen 0–5 min before kickoff. `v_eval_selections.clv_sporty =
odds / sporty_close − 1`. Coverage counts a selection when its price was
captured ≤ 15 min before kickoff; the target is 95%.

## Phase C (scaffolded; runs once Phase 0 says go)

- **C1** `sc_sharp_odds`: one `creation` row the first time a selection is
  matched and a `close` row near kickoff. Sharp prices are internal only:
  check the pinnodds / Pinnacle licence before showing any to users.
- **C2** `sc_event_map`: normalised names (accents, punctuation and club
  suffixes removed; "Surname, First" order-free) with both sides ≥ 0.5
  similarity and kickoff within ±15 min.
- **C3** `clv_sharp = odds × p_fair_sharp_close − 1` in `v_eval_selections`,
  where the close is the latest sharp capture at or before kickoff.

## Phase D

- **D1** `sc_hypotheses`: a trigger makes frozen rows immutable (they can only
  be retired). The evaluator uses only rows created after `frozen_at`.
- **D2** shadow log: candidate logging adds an unpublished
  `sc_shadow_selections` row for every candidate matching a frozen market-band
  hypothesis, with price, `p_fair`, market snapshot and timestamps. The
  sharp job does the same for H3. Shadow rows are graded by the audit cron
  (hourly; settlement starts 105 min after kickoff).
- **D3 H3** is registered as **draft** with a 3% threshold. It is not frozen
  until Avian confirms the threshold and Phase C runs. To freeze it:
  `update sc_hypotheses set status='active', frozen_at=now() where id='H3' and frozen_at is null;`
- **D4 H1 / H2** are frozen when the migration runs; min n is 800 and they
  are not gate-deciding. H2's 2-leg slips pair graded singles in creation
  order within a day, never two legs from one event.
- **D5** `section=patterns`: market × league × odds band, n ≥ 400,
  Benjamini–Hochberg at 10% FDR, every cell labelled "hypothesis". On Oct 29,
  0 of 2,030 cells reach n = 400.

## Open decisions

- H3 threshold (3%): needs Avian's confirmation before freezing.
- Paid sharp plan: only after C2, and only if trial polling is too coarse.
