-- SureCode: evaluation layer v1.
-- Run once in Supabase → SQL editor AFTER schema-prediction-log-v2.sql. Safe to re-run.
--
-- 1. product + tier (generated, so every row — old and new — is classified the same way)
-- 2. full market at prediction time on log and candidate rows (new rows only; no backfill)
-- 3. app_commit on candidate rows
-- 4. v_eval_selections: the only source for leg metrics
--
-- The app keeps working before this is run (it detects the missing columns and
-- derives the same unique-selection set in code).

-- ───────────────────────── product + tier ─────────────────────────
-- Mirrors productOf / tierOf in src/lib/evaluation.ts.

alter table public.prediction_log
  add column if not exists product text
    generated always as (
      case source
        when 'sure'        then 'sure-engine'
        when 'plenty'      then 'plenty-codes'
        when 'predictions' then 'predictions'
        when 'builder'     then 'combo-builder'
        when 'demo-auto'   then 'demo'
        else 'user'                      -- book, edit-code, sure-combine
      end
    ) stored,
  add column if not exists tier text
    generated always as (
      case
        when source = 'sure' and slot between 1 and 3 then 'safe'
        when source = 'sure' and slot between 4 and 6 then 'boost'
        when source = 'sure' and slot between 7 and 9 then 'longshot'
        when lower(coalesce(product_tier, '')) = 'safe' then 'safe'
        when source = 'sure' and lower(product_tier) in ('boost', 'longshot') then lower(product_tier)
        else 'none'                      -- VALUE / tip / AI / COMBO / user
      end
    ) stored;

do $$ begin
  alter table public.prediction_log
    add constraint prediction_log_tier_chk check (tier in ('safe', 'boost', 'longshot', 'none'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.prediction_log
    add constraint prediction_log_product_chk
    check (product in ('sure-engine', 'plenty-codes', 'predictions', 'combo-builder', 'user', 'demo'));
exception when duplicate_object then null; end $$;

-- ───────────────────────── market at prediction time ─────────────────────────
-- market_odds: {"market_id","specifier","outcomes":{outcome_id: odds},"picked_outcome","captured_at","source"}
-- overround:   Σ(1/odds) / k − 1   (k = 2 for double chance, else 1)
-- devig_prob:  proportional de-vig of the predicted outcome = (1/odds) / Σ(1/odds) × k

alter table public.prediction_log
  add column if not exists market_odds jsonb,
  add column if not exists overround   numeric(8,6),
  add column if not exists devig_prob  numeric(8,6);

alter table public.prediction_candidates
  add column if not exists market_odds jsonb,
  add column if not exists overround   numeric(8,6),
  add column if not exists devig_prob  numeric(8,6),
  add column if not exists app_commit  text;

create index if not exists prediction_log_eval_idx
  on public.prediction_log (product, event_id, pick_code, created_at)
  where data_origin = 'prospective' and published and result in ('win', 'loss');

-- ───────────────────────── evaluation view ─────────────────────────
-- One row per unique published selection (product, event, pick): the first
-- time it was published, prospective only (recovered rows are never
-- evaluated), predicted before kickoff, graded win/loss (void / cancelled
-- are not accuracy outcomes).

create or replace view public.v_eval_selections
with (security_invoker = true) as
select distinct on (product, event_id, pick_code) *
  from public.prediction_log
 where data_origin = 'prospective'
   and predicted_before_kickoff
   and published
   and result in ('win', 'loss')
 order by product, event_id, pick_code, created_at asc;

revoke all on public.v_eval_selections from anon, authenticated;
grant select on public.v_eval_selections to service_role;

notify pgrst, 'reload schema';

-- ───────────────────────── acceptance checks ─────────────────────────
-- select count(*) from v_eval_selections where data_origin = 'recovered';            -- 0
-- select count(*) from prediction_log where tier not in ('safe','boost','longshot','none'); -- 0
-- select count(*) from prediction_log where published and product is null;           -- 0
-- select model_version, count(*) from v_eval_selections where product = 'sure-engine' group by 1;
