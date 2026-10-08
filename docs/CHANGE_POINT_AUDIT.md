# Change-point audit — engine changes vs. results (13 Sep – 8 Oct 2026)

**Question:** did any engine change measurably improve or hurt results?

**Answer:** the stored history cannot show it. No era differs from another
beyond noise, and the history that was settled is a biased subset. Treat every
past "the new version is better" claim as unproven. From now on, use the
prediction log, which records the logic version per row.

## Engine timeline (commits that touched the Sure logic)

| Commit | Time (UTC) | Change |
| --- | --- | --- |
| 273aa6f / 2fc1ea9 | 13 Sep 09:18 / 09:53 | Launch; Vercel budgets |
| 3cd9893 | 17 Sep 13:42 | Fewer/stronger slips, leg-history learning |
| ccc26b0 | 17 Sep 15:21 | "High-hit" mode: singles and rare 2-folds |
| ea01821 | 19 Sep 17:33 | High-hit tuning, condition combo builder |
| 8086bbf | 22 Sep 23:59 | Multi-sport singles |
| 1d39bfa / 6b1148c | 23 Sep 00:15 / 00:33 | Safe vs Larger modes; higher Boost odds band (board goes 3 → 6 slots) |
| 3fadd51 | 26 Sep 00:25 | "Train Sure AI harder" |
| 9f9f21c | 26 Sep 05:44 | Longshot lane, AI play-out veto, settlePick changes |
| 7ccb4d1 | 29 Sep 10:28 | Liked codes, GPT API v2 |
| 36e7480 | 30 Sep 09:16 | Longshot generation fix (board goes 6 → 9 slots from 1 Oct) |
| 0c64f6d | 4 Oct 16:40 | Prediction log (no logic change) |

The board size changes are visible in the data: `sc_sure_codes` has 3 slots a
day until 22 Sep, 6 from 23 Sep and 9 from 1 Oct.

## Results by era (settled Sure codes in `sc_past_codes`, by code day)

Slip win rate among codes that were settled WON or LOST, with Wilson 95%
intervals:

| Era (code days) | Live logic | Won / settled | Win rate [95% CI] |
| --- | --- | --- | --- |
| 13–16 Sep | launch | 38 / 61 | 62% [50–73] |
| 17–19 Sep | high-hit | 23 / 40 | 57% [42–71] |
| 20–22 Sep | high-hit tuned | 16 / 37 | 43% [29–59] |
| 23–25 Sep | multi-sport, Safe/Larger | 19 / 35 | 54% [38–70] |
| 26–29 Sep | AI veto, Longshot | 35 / 52 | 67% [54–78] |
| 30 Sep–7 Oct | current champion | 15 / 28 | 54% [36–70] |
| **All** | | 146 / 252 | 58% [52–64] |

Every interval overlaps every other. The largest gap (20–22 Sep vs 26–29 Sep)
is still inside the noise once you allow for the selection bias below.

## Why these numbers cannot settle the question

1. **Only 18% of codes were ever settled.** 1,143 of 1,396 past codes are
   still `PENDING`. The settler takes the newest pending codes first (8 past
   and 5 Sure codes per pass, twice per crawl). Those are almost always
   today's unplayed codes, so older finished codes are rarely reached. Which
   codes got settled depends on timing, not on the codes themselves. Since
   1 Oct, almost nothing settles (`settled=0` in nearly every crawl run).
2. **The mix changed with every era.** The tiers went 3 → 6 → 9, singles
   became multi-leg packs, and the odds bands moved. A different product mix
   gives a different win rate even with identical skill. Compare like with
   like (tier × legs × odds band), which needs far more settled data than
   exists.
3. **Win rate is the wrong yardstick.** A 1.20 single winning 80% of the time
   loses money; a 3.0 treble winning 40% makes money. These eras don't record
   flat-stake ROI or closing-line value at all.
4. **The leg ledger is not a time series.** `sc_leg_history.settled_at` is
   overwritten on every re-upsert (including the winners-only backfill). That
   moves winning legs to later dates. The apparent jump from a 24% leg hit
   rate before 29 Sep to 91% after is this artefact, not an engine effect.

## Calibration check (all eras together, settled codes)

Slip "confidence" is the product of bookmaker-implied leg probabilities:

| Confidence bucket | Won / settled | Observed [95% CI] |
| --- | --- | --- |
| 80–90% | 70 / 90 | 78% [68–85] |
| 70–80% | 27 / 41 | 66% [51–78] |
| 60–70% | 15 / 36 | 42% [27–58] |
| 50–60% | 20 / 37 | 54% [38–69] |
| 40–50% | 9 / 28 | 32% [18–51] |
| 30–40% | 5 / 17 | 29% [13–53] |

Observed rates sit at or below the stated probability in every bucket. That
is what you expect when the "probability" still contains the bookmaker's
margin. There is no sign of an edge over the market in this sample (subject
to the selection bias above).

By slip size: singles 64% [55–72] (n = 117), doubles 51% [40–62] (n = 77),
trebles 55% [42–67] (n = 58).

## What is now in place so the next change *can* be judged

- Every prediction row carries `model_version`; the deployed commit is stored
  in `app_commit`.
- Settlement takes the oldest-checked rows first, so nothing starves.
- Stored history since launch can be recovered into the log, stamped with the
  logic era that produced it (`data_origin = 'recovered'`).
- The report shows unique selections, flat-stake ROI, CLV, Brier, log loss
  and ECE per version, tier and market.
- The candidate log records rejected picks, so selection lift (did the engine
  pick better than what it passed on?) can be measured per version.

**Recommendation:** freeze the champion (see `CHAMPION_SNAPSHOT.md`). Recover
the history once. Collect at least 2–3 weeks of settled, unique selections per
tier. Then evaluate any change against the champion on the same days, never
against an older era.
