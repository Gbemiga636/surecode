-- SureCode: prediction audit log.
-- Run once in Supabase → SQL editor. Safe to re-run.
--
-- One row per predicted selection (a leg). Legs that belong to the same booked
-- slip share `slip_code`. Rows are written by the server only (service role);
-- browser clients (anon / authenticated) have no access at all.

create table if not exists public.prediction_log (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),

  fixture         text,                     -- "Home v Away"
  sport           text,
  league          text,
  market          text,                     -- e.g. 1X2, Over/Under, Double Chance
  selection       text,                     -- e.g. "Home or Draw (1X)"
  odds            numeric(10,4),
  confidence      numeric(6,4),             -- probability the engine assigned to this leg (0–1)
  slip_code       text,                     -- SportyBet booking code, null for single tips
  model_version   text,

  result          text not null default 'pending',  -- pending | win | loss | void | cancelled
  final_score     text,                     -- "2-1"
  closing_odds    numeric(10,4),

  -- audit / settlement helpers
  source          text,                     -- sure | plenty | predictions | book | builder | edit-code | demo-auto
  origin          text,                     -- finer detail, e.g. "slot-4:boost" or "builder:O05+BTTSY"
  event_id        text,                     -- SportyBet event id, used to settle
  pick_code       text,                     -- internal market code, used to settle
  kickoff         timestamptz,
  slip_odds       numeric(12,4),
  slip_confidence numeric(8,6),
  slip_legs       integer,
  settled_at      timestamptz,
  settle_note     text,
  dedupe_key      text not null,

  constraint prediction_log_result_chk
    check (result in ('pending', 'win', 'loss', 'void', 'cancelled'))
);

create unique index if not exists prediction_log_dedupe_uidx on public.prediction_log (dedupe_key);
create index if not exists prediction_log_created_idx   on public.prediction_log (created_at desc);
create index if not exists prediction_log_kickoff_idx   on public.prediction_log (kickoff);
create index if not exists prediction_log_slip_idx      on public.prediction_log (slip_code);
create index if not exists prediction_log_filters_idx   on public.prediction_log (sport, market, result);
create index if not exists prediction_log_pending_idx   on public.prediction_log (kickoff)
  where result = 'pending' and settled_at is null;

-- Lock it down: RLS on with no policies = only the service role can read or write.
alter table public.prediction_log enable row level security;
revoke all on public.prediction_log from anon, authenticated;

notify pgrst, 'reload schema';
