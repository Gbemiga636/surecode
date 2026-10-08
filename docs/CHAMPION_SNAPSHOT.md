# Champion snapshot — Sure engine as of 8 Oct 2026

This freezes the prediction logic that is live today (the "champion") so any
future model can be compared against it on identical terms. Nothing in this
document changes behaviour; it records what the code does.

## Identity

| Item | Value |
| --- | --- |
| Logic version (`model_version`) | `sure-engine/2026.10` |
| Last commit that changed Sure picks | `36e7480` (30 Sep 2026, Longshot generation fix) |
| Deployed commit when frozen | `0c64f6d` + the audit commit that adds this file (logic unchanged) |
| Code | `src/lib/sure-engine.ts`, `src/lib/learning.ts`, `src/lib/sporty.ts` (`PICKS`, `settlePick`), `src/lib/crawl.ts` |
| Earlier logic eras | listed in `SURE_ENGINE_ERAS` (`src/lib/prediction-log.ts`); recovered rows are stamped `sure-engine/2026.09-<commit>` |

### Versioning rule

- `model_version` = `<model>/<ENGINE_VERSION>`. Bump `ENGINE_VERSION` in
  `src/lib/prediction-log.ts` **in the same commit** as any change that can
  alter which picks are produced (limits, markets, scoring, learning, AI veto,
  slot plans, fixture windows).
- UI-only deploys keep the version. The deployed commit is stored separately in
  `prediction_log.app_commit`.
- When bumping, append the previous version to `SURE_ENGINE_ERAS` so recovered
  history keeps the right label.

## Runtime environment that affects picks

| Setting | Effect |
| --- | --- |
| `OPENAI_API_KEY` | Enables the AI play-out veto on multi-leg slips and the AI rationale. Without it, no veto. Live: on (`ai=on` in every crawl run). |
| `OPENAI_MODEL` | Defaults to `gpt-4o-mini`, temperature 0.3. The veto is therefore **not deterministic**. |
| `CRAWL_BUDGET_MS` | Crawl soft budget; default 100 s on Vercel. |
| `SPORTY_PAGES` | Fixture pages per sport; default 4 on Vercel. The engine itself requests 4 pages per sport. |
| Crawl schedule | An external scheduler calls `/api/crawl` every hour at :20 UTC (seen in `sc_crawl_runs`), plus two Vercel crons (19:00 and 23:05 UTC). Each run rebuilds and re-books the whole Sure board. |

## Board structure

- Nine slots per Lagos day: **Safe 1–3, Boost (Larger) 4–6, Longshot 7–9**.
- Slot plans: Safe = single, single, 2-fold · Boost = single, 2-fold, 3-fold ·
  Longshot = 3-fold, 4-fold, 3-fold (always multi-leg; falls back to 2 legs).
- Fixture windows: Safe and Boost use kickoffs 40 min to 36 h ahead.
  Longshot uses 2 h to 5 days ahead and does not exclude events used by the
  other modes. Safe and Boost never share an event.
- Sports: football (market list below); basketball, tennis, hockey and
  baseball use the moneyline favourite only.

## Per-mode limits (`LIMITS`)

| | Safe | Boost | Longshot |
| --- | --- | --- | --- |
| Leg odds band | 1.08–1.42 | 1.50–2.40 | 1.35–2.85 |
| Min implied probability (Safe singles) | 0.72 | — | — |
| Min de-vigged favourite edge | 0.10 | 0.06 | 0.08 |
| Min engine score | 1.45 | 1.15 | 1.08 |
| Max multi-leg combined odds | 2.25 | 4.5 | 8.5 |
| Tennis max odds | 1.28 | 1.90 | 2.25 |
| Hockey/baseball max odds | 1.35 | 2.10 | 2.45 |
| Home/away favourite probability floor | 0.48 | 0.42 | 0.44 |
| Moneyline margin (opponent ÷ favourite odds) | ≥ 1.15 | ≥ 1.08 | ≥ 1.08 |

Slip-level rules (`bookSlip`):

- Safe: a single must have implied ≥ 0.72 (unless the pick is O05 or 1HO05).
  Multi-leg slips need a combined implied probability ≥ 0.45.
- Boost: multi-leg slips need a combined implied probability ≥ 0.26. Packs
  need combined odds ≥ 2.2.
- Longshot: needs 2+ legs, combined odds ≥ 2.8 (packs aim for ≥ 3.2), and a
  combined implied probability ≥ 0.10.
- AI play-out veto on every multi-leg slip, when on. The slip is rejected if
  the AI says fail, or its confidence is below 0.55 (Safe), 0.40 (Boost) or
  0.28 (Longshot). A rejected Longshot pack drops its riskiest leg and retries,
  up to 4 attempts.

## Football markets per mode

- **Safe:** O05, 1HO05, DC1X, DCX2, O15, HO05, AO05, DNBH, DNBA, 1HDC1X, 1HDCX2
- **Boost:** DC1X, DCX2, O15, O25, DNBH, DNBA, BTTSY, 1HDC1X, 1HDCX2, 1, 2
- **Longshot:** DC1X, DCX2, O15, O25, DNBH, DNBA, BTTSY, 1, 2

Key market filters:

- O05 is Safe only, at odds ≤ 1.28.
- 1HO05 is capped at 1.32 (Safe) or 1.55, and is not used in Longshot.
- O15 in Safe requires odds ≤ 1.40 and draw probability ≤ 0.33. Boost caps it
  at 2.2. Longshot requires odds ≤ 2.4 and draw probability ≤ 0.32.
- O25 is never Safe and needs draw probability ≤ 0.30. BTTSY is never Safe and
  needs draw probability ≤ 0.34.
- Side markets need a clear de-vigged favourite. Coin-flip matches allow goals
  markets only.

## Pool and ranking

- Each event contributes only its best-scoring market.
- Ranking: Safe sorts by score. Boost and Longshot sort by `score × ln(odds + 0.15)`.
- Pool caps: at most 2 legs per league. Per-sport cap is 2 (Safe), 3 (Boost)
  or 4 (Longshot). The pool holds 14 legs (20 for Longshot).
- Multi-leg packs prefer distinct sports. If the greedy pick misses the odds
  band, the engine searches exhaustively over the top 12 legs.

## Learning layer (`learning.ts`)

- Source: the latest 1,200 rows of `sc_leg_history`, **including the
  score-less, winners-only backfill rows** (see `DATA_QUALITY_AUDIT.md`).
- Bayesian smoothing:
  - per market: prior 0.58, strength 8
  - per league × market: prior 0.55, strength 6
  - per odds band: prior 0.55, strength 10
- Elite markets: plays ≥ 10 and smoothed rate ≥ 0.62. Avoid list: plays ≥ 10
  and smoothed rate < 0.50.
- Effects on picks:
  - Safe rejects avoid-list markets.
  - Once there are 2 or more elite markets, Safe keeps only elite markets plus
    O05, DC1X, DCX2, HO05 and AO05.
  - Any market with 12 or more plays and a smoothed rate below 0.58 (Safe) or
    0.50 (others) is rejected.
  - The leg score blends market, league and band rates. Avoid-list markets get
    ×0.72.
- **The learning state changes with every settlement**, so the champion is the
  code plus the history at prediction time. Approximate state on 8 Oct, from
  the 181 scored rows only:
  - elite: O15, HO05, BBA, TNA, DC1X
  - borderline: DCX2
  - avoid: BTTSY (10/25)

## What "confidence" means today

Per-leg `confidence` is the **bookmaker-implied probability** (1/odds,
including the margin). Slip confidence is the product of those. It is not a
model probability, and the official report scores it against outcomes next to
the de-vigged market for that reason.

## How to compare a challenger

1. Run the challenger in shadow mode, logging to `prediction_log` under a new
   `model_version` and `published = false`.
2. Compare on `GET /api/prediction-log/report?eval=1&model_version=…`, over
   the same dates, tiers and markets.
3. Use the unique-selection numbers and the closing-line value (CLV), not raw
   leg counts. The board is re-booked every hour, so a leg can appear in many
   slips.
