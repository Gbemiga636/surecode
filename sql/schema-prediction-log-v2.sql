-- SureCode: prediction audit — v2 migration.
-- Run once in Supabase → SQL editor AFTER schema-prediction-log.sql. Safe to re-run.
--
-- Adds stable ids, product tier / slot, half-time scores, settlement bookkeeping,
-- closing-odds timestamps, derived audit columns, the candidate-universe table
-- and a clean evaluation view. The app keeps working before this is run
-- (it detects the missing columns and logs the v1 fields only).

-- ───────────────────────── prediction_log additions ─────────────────────────

alter table public.prediction_log
  add column if not exists prediction_id      text,          -- stable: same prediction → same id on every run
  add column if not exists product_tier       text,          -- safe | boost | longshot | SAFE/VALUE/AI/COMBO | tip | user
  add column if not exists slot               integer,       -- Sure board slot (1–9)
  add column if not exists published          boolean,       -- true = shown to customers by the system
  add column if not exists data_origin        text not null default 'prospective', -- prospective | recovered
  add column if not exists app_commit         text,          -- deployed git commit that logged the row
  add column if not exists ht_score           text,          -- half-time score when available
  add column if not exists closing_odds_at    timestamptz,   -- when closing_odds was last observed (pre-kickoff)
  add column if not exists closing_odds_source text,
  add column if not exists settle_attempts    integer not null default 0,
  add column if not exists last_checked_at    timestamptz,
  add column if not exists result_source      text;          -- auto | manual

-- Derived, always-consistent audit columns.
alter table public.prediction_log
  add column if not exists raw_implied_probability numeric(8,6)
    generated always as (case when odds > 1 then round(1 / odds, 6) end) stored,
  add column if not exists profit_units numeric(10,4)
    generated always as (
      case result
        when 'win' then odds - 1
        when 'loss' then -1
        when 'void' then 0
        when 'cancelled' then 0
      end
    ) stored,
  add column if not exists clv numeric(10,6)
    generated always as (
      case when closing_odds > 1 and odds > 1 then round(odds / closing_odds - 1, 6) end
    ) stored,
  add column if not exists predicted_before_kickoff boolean
    generated always as (kickoff is null or created_at < kickoff) stored;

-- Backfill ids for rows written before v2 (matches the app: 'pl_' + first 24 hex of sha256(dedupe_key)).
update public.prediction_log
   set prediction_id = 'pl_' || substr(encode(sha256(convert_to(dedupe_key, 'UTF8')), 'hex'), 1, 24)
 where prediction_id is null;

-- v1 stamped the deploy commit into model_version ("sure-engine/2026.10+abc1234"); split it out.
update public.prediction_log
   set app_commit = coalesce(app_commit, nullif(split_part(model_version, '+', 2), '')),
       model_version = split_part(model_version, '+', 1)
 where model_version like '%+%';

update public.prediction_log
   set product_tier = coalesce(product_tier, case
         when source = 'sure' then nullif(split_part(origin, ':', 2), '')
         when source = 'plenty' then origin
         when source = 'predictions' then 'tip'
         else 'user' end),
       slot = coalesce(slot, case
         when source = 'sure' and origin ~ '^slot-[0-9]+' then substring(origin from '^slot-([0-9]+)')::int end),
       published = coalesce(published, source in ('sure', 'plenty', 'predictions'))
 where product_tier is null or published is null;

create unique index if not exists prediction_log_pid_uidx on public.prediction_log (prediction_id);
create index if not exists prediction_log_event_idx   on public.prediction_log (event_id);
create index if not exists prediction_log_version_idx on public.prediction_log (model_version);
create index if not exists prediction_log_tier_idx    on public.prediction_log (product_tier);
create index if not exists prediction_log_settle_idx  on public.prediction_log (last_checked_at nulls first, kickoff)
  where result = 'pending' and settled_at is null;

-- ───────────────────────── candidate universe ─────────────────────────
-- Every selection the Sure engine evaluated inside its price band — selected
-- or rejected, with the reason — so selected picks can be compared with
-- similar picks the engine passed on (selection lift).

create table if not exists public.prediction_candidates (
  id                      uuid primary key default gen_random_uuid(),
  created_at              timestamptz not null default now(),
  evaluated_at            timestamptz not null default now(),
  run_id                  text,
  day                     text,
  product_tier            text,                -- safe | boost | longshot
  event_id                text not null,
  fixture                 text,
  sport                   text,
  league                  text,
  kickoff                 timestamptz,
  market                  text,
  pick_code               text,
  selection               text,
  odds                    numeric(10,4),
  raw_implied_probability numeric(8,6) generated always as (case when odds > 1 then round(1 / odds, 6) end) stored,
  fair_market_probability numeric(8,6),        -- de-vigged market probability where the full market is known
  engine_score            numeric(10,4),
  status                  text not null default 'rejected',   -- selected | rejected
  stage                   text,                -- analysis | pool | slip
  rejection_reason        text,
  slip_code               text,
  model_version           text,
  result                  text not null default 'pending',
  final_score             text,
  ht_score                text,
  settled_at              timestamptz,
  settle_note             text,
  settle_attempts         integer not null default 0,
  last_checked_at         timestamptz,
  dedupe_key              text not null,
  constraint prediction_candidates_result_chk check (result in ('pending', 'win', 'loss', 'void', 'cancelled')),
  constraint prediction_candidates_status_chk check (status in ('selected', 'rejected'))
);

create unique index if not exists prediction_candidates_dedupe_uidx on public.prediction_candidates (dedupe_key);
create index if not exists prediction_candidates_day_idx    on public.prediction_candidates (day, product_tier);
create index if not exists prediction_candidates_event_idx  on public.prediction_candidates (event_id);
create index if not exists prediction_candidates_status_idx on public.prediction_candidates (status, product_tier, market);
create index if not exists prediction_candidates_settle_idx on public.prediction_candidates (last_checked_at nulls first, kickoff)
  where result = 'pending' and settled_at is null;

alter table public.prediction_candidates enable row level security;
revoke all on public.prediction_candidates from anon, authenticated;

-- ───────────────────────── clean evaluation view ─────────────────────────
-- Official metrics are computed from this view: rows generated before kickoff
-- and graded. 'recovered' rows were rebuilt from codes the crawl stored at
-- generation time (created_at = that original time), so they are genuine
-- pre-match predictions; filter on data_origin to compare the two paths.

create or replace view public.prediction_log_eval
with (security_invoker = true) as
select *
  from public.prediction_log
 where data_origin in ('prospective', 'recovered')
   and predicted_before_kickoff
   and result in ('win', 'loss', 'void', 'cancelled');

revoke all on public.prediction_log_eval from anon, authenticated;

notify pgrst, 'reload schema';
