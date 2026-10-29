-- SureCode: evaluation v3 (Brief v3 — evaluation and sharp-line test).
-- Run once in Supabase → SQL editor AFTER schema-eval-v1.sql. Safe to re-run.
--
-- B1  p_fair + devig_method on log and candidate rows (new rows only; no backfill)
-- B2  sporty_close (SportyBet price ~5 min before kickoff) + clv_sporty in the view
-- C1  sc_sharp_odds      sharp prices (internal only — check the provider licence before showing users)
-- C2  sc_event_map       SportyBet event ↔ sharp event
-- 0.3 sc_line_probe      Phase 0 price pairs (SportyBet vs sharp, both timestamped)
-- C3  clv_sharp in the view
-- D1  sc_hypotheses      frozen hypothesis registry (H1, H2 frozen here; H3 stays draft)
-- D2  sc_shadow_selections  unpublished shadow log, graded by the audit cron
--
-- The app keeps working before this is run: it detects the missing columns /
-- tables and skips v3 writes.

-- ───────────────────────── B1 / B2 columns ─────────────────────────
-- p_fair:        fair probability of the picked outcome, frozen method (devig_method)
-- sporty_close:  SportyBet price of the same outcome captured ≤ 10 min before kickoff
alter table public.prediction_log
  add column if not exists p_fair          numeric(8,6),
  add column if not exists devig_method    text,
  add column if not exists sporty_close    numeric(10,4),
  add column if not exists sporty_close_at timestamptz;

alter table public.prediction_candidates
  add column if not exists p_fair       numeric(8,6),
  add column if not exists devig_method text;

do $$ begin
  alter table public.prediction_log
    add constraint prediction_log_devig_method_chk check (devig_method is null or devig_method in ('proportional', 'power', 'shin'));
exception when duplicate_object then null; end $$;

create index if not exists prediction_log_close_idx
  on public.prediction_log (kickoff)
  where result = 'pending' and sporty_close_at is null;

-- ───────────────────────── C1 / C2 / Phase 0 ─────────────────────────
create table if not exists public.sc_sharp_odds (
  id                 bigserial primary key,
  event_key          text not null,               -- sharp provider event id
  source             text not null default 'pinnacle',
  market             text not null,               -- our market name (1X2, Double Chance, Winner, ...)
  outcome            text not null,               -- our pick_code
  odds               numeric(10,4),               -- sharp price (null for derived markets such as double chance)
  fair_prob          numeric(8,6) not null,       -- de-vigged sharp probability (frozen method)
  phase              text not null,               -- probe | creation | close
  sportybet_event_id text,
  captured_at        timestamptz not null default now(),
  constraint sc_sharp_odds_phase_chk check (phase in ('probe', 'creation', 'close'))
);
create index if not exists sc_sharp_odds_lookup_idx on public.sc_sharp_odds (event_key, outcome, captured_at desc);
create index if not exists sc_sharp_odds_sb_idx     on public.sc_sharp_odds (sportybet_event_id, phase);

create table if not exists public.sc_event_map (
  sportybet_event_id text primary key,
  sharp_event_id     text not null,
  source             text not null default 'pinnacle',
  method             text not null,               -- name+kickoff
  confidence         numeric(5,4) not null,       -- 0–1 name similarity
  sportybet_fixture  text,
  sharp_fixture      text,
  sportybet_kickoff  timestamptz,
  sharp_kickoff      timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists sc_event_map_sharp_idx on public.sc_event_map (sharp_event_id);

create table if not exists public.sc_line_probe (
  id                 bigserial primary key,
  sportybet_event_id text not null,
  sharp_event_id     text not null,
  sport              text,
  league             text,
  pick_code          text not null,
  sporty_odds        numeric(10,4) not null,
  sporty_captured_at timestamptz not null,
  sharp_fair_prob    numeric(8,6) not null,
  sharp_captured_at  timestamptz not null,
  kickoff            timestamptz,
  -- gap ≥ 0.03  ⇔  sporty_odds ≥ sharp_fair_odds × 1.03
  edge               numeric(10,6) generated always as (round(sporty_odds * sharp_fair_prob - 1, 6)) stored,
  captured_at        timestamptz not null default now()
);
create index if not exists sc_line_probe_pair_idx on public.sc_line_probe (sportybet_event_id, pick_code, captured_at);

-- ───────────────────────── D1 hypotheses ─────────────────────────
create table if not exists public.sc_hypotheses (
  id           text primary key,
  title        text not null,
  definition   jsonb not null,
  success_rule jsonb not null,
  frozen_at    timestamptz,
  min_n        integer not null,
  status       text not null default 'draft',
  note         text,
  created_at   timestamptz not null default now(),
  constraint sc_hypotheses_status_chk check (status in ('draft', 'active', 'retired')),
  constraint sc_hypotheses_frozen_chk check (status = 'draft' or frozen_at is not null)
);

-- Once frozen, a hypothesis can only be retired: definition, rule, min_n and frozen_at are immutable.
create or replace function public.sc_hypotheses_freeze_guard() returns trigger
language plpgsql as $$
begin
  if old.frozen_at is not null and (
       new.definition   is distinct from old.definition
    or new.success_rule is distinct from old.success_rule
    or new.min_n        is distinct from old.min_n
    or new.frozen_at    is distinct from old.frozen_at
    or (new.status <> old.status and new.status <> 'retired')
  ) then
    raise exception 'hypothesis % is frozen (since %); only status → retired is allowed', old.id, old.frozen_at;
  end if;
  return new;
end $$;

drop trigger if exists sc_hypotheses_freeze on public.sc_hypotheses;
create trigger sc_hypotheses_freeze before update on public.sc_hypotheses
  for each row execute function public.sc_hypotheses_freeze_guard();

-- H1 / H2: long-run tests (800+), not gate-deciding. Frozen when this script first runs.
insert into public.sc_hypotheses (id, title, definition, success_rule, frozen_at, min_n, status, note) values
  ('H1', '1X2 / Winner singles at odds 2.00–2.99',
   '{"kind":"market_band","markets":["1X2","Winner"],"odds_min":2.0,"odds_max":2.99,"legs":[1]}',
   '{"metric":"hit_rate_minus_p_fair","ci":0.95,"pass":"ci_low > 0 and roi >= 0","gate_deciding":false}',
   now(), 800, 'active', 'Brief v3 D4'),
  ('H2', 'Team Goals and Double Chance — singles and 2-leg slips',
   '{"kind":"market_band","markets":["Team Goals","Double Chance"],"legs":[1,2]}',
   '{"metric":"hit_rate_minus_p_fair","ci":0.95,"pass":"ci_low > 0 and roi >= 0","gate_deciding":false}',
   now(), 800, 'active', 'Brief v3 D4'),
  -- H3 is the primary (gate-deciding) test. It stays DRAFT until the 3% threshold
  -- is confirmed and Phase C runs; freeze it with:
  --   update sc_hypotheses set status = 'active', frozen_at = now() where id = 'H3' and frozen_at is null;
  ('H3', 'Sharp value singles: SportyBet ≥ sharp fair × 1.03',
   '{"kind":"sharp_value","min_edge":0.03,"max_price_gap_minutes":5,"legs":[1]}',
   '{"metric":"mean_clv_sharp","ci":0.95,"pass":"ci_low > 0","gate_deciding":true}',
   null, 150, 'draft', 'Brief v3 D3 — 3% threshold awaiting confirmation; needs Phase C')
on conflict (id) do nothing;

-- ───────────────────────── D2 shadow log ─────────────────────────
create table if not exists public.sc_shadow_selections (
  id                uuid primary key default gen_random_uuid(),
  hypothesis_id     text not null references public.sc_hypotheses (id),
  candidate_key     text,                         -- prediction_candidates.dedupe_key
  event_id          text not null,
  fixture           text,
  sport             text,
  league            text,
  market            text,
  pick_code         text not null,
  odds              numeric(10,4) not null,       -- SportyBet price at creation
  p_fair            numeric(8,6),
  devig_method      text,
  market_odds       jsonb,
  sharp_fair_prob   numeric(8,6),
  sharp_captured_at timestamptz,
  kickoff           timestamptz,
  created_at        timestamptz not null default now(),
  result            text not null default 'pending',
  final_score       text,
  ht_score          text,
  settled_at        timestamptz,
  settle_note       text,
  result_source     text,
  settle_attempts   integer not null default 0,
  last_checked_at   timestamptz,
  sporty_close      numeric(10,4),
  sporty_close_at   timestamptz,
  constraint sc_shadow_result_chk check (result in ('pending', 'win', 'loss', 'void', 'cancelled')),
  constraint sc_shadow_unique unique (hypothesis_id, event_id, pick_code)
);
create index if not exists sc_shadow_settle_idx on public.sc_shadow_selections (last_checked_at nulls first, kickoff)
  where result = 'pending' and settled_at is null;
create index if not exists sc_shadow_close_idx on public.sc_shadow_selections (kickoff)
  where result = 'pending' and sporty_close_at is null;

-- ───────────────────────── access ─────────────────────────
alter table public.sc_sharp_odds        enable row level security;
alter table public.sc_event_map         enable row level security;
alter table public.sc_line_probe        enable row level security;
alter table public.sc_hypotheses        enable row level security;
alter table public.sc_shadow_selections enable row level security;
revoke all on public.sc_sharp_odds, public.sc_event_map, public.sc_line_probe, public.sc_hypotheses, public.sc_shadow_selections
  from anon, authenticated;

-- ───────────────────────── views (C3 / B2) ─────────────────────────
-- Sharp close = latest sharp capture at or before kickoff for the same outcome.
-- clv_sporty = publish_odds / sporty_close − 1
-- clv_sharp  = publish_odds × p_fair_sharp_close − 1

drop view if exists public.v_eval_selections;
create view public.v_eval_selections
with (security_invoker = true) as
select s.*,
       case when s.sporty_close > 1 then round(s.odds / s.sporty_close - 1, 6) end        as clv_sporty,
       sharp.fair_prob                                                                  as p_fair_sharp_close,
       case when sharp.fair_prob > 0 then round(s.odds * sharp.fair_prob - 1, 6) end      as clv_sharp
  from (
    select distinct on (product, event_id, pick_code) *
      from public.prediction_log
     where data_origin = 'prospective'
       and predicted_before_kickoff
       and published
       and result in ('win', 'loss')
     order by product, event_id, pick_code, created_at asc
  ) s
  left join public.sc_event_map m on m.sportybet_event_id = s.event_id
  left join lateral (
    select o.fair_prob
      from public.sc_sharp_odds o
     where o.event_key = m.sharp_event_id
       and o.outcome = s.pick_code
       and o.captured_at <= s.kickoff
     order by o.captured_at desc
     limit 1
  ) sharp on true;

drop view if exists public.v_shadow_eval;
create view public.v_shadow_eval
with (security_invoker = true) as
select s.*,
       case when s.sporty_close > 1 then round(s.odds / s.sporty_close - 1, 6) end        as clv_sporty,
       sharp.fair_prob                                                                  as p_fair_sharp_close,
       case when sharp.fair_prob > 0 then round(s.odds * sharp.fair_prob - 1, 6) end      as clv_sharp
  from public.sc_shadow_selections s
  left join public.sc_event_map m on m.sportybet_event_id = s.event_id
  left join lateral (
    select o.fair_prob
      from public.sc_sharp_odds o
     where o.event_key = m.sharp_event_id
       and o.outcome = s.pick_code
       and o.captured_at <= s.kickoff
     order by o.captured_at desc
     limit 1
  ) sharp on true;

revoke all on public.v_eval_selections, public.v_shadow_eval from anon, authenticated;
grant select on public.v_eval_selections, public.v_shadow_eval to service_role;
grant all on public.sc_sharp_odds, public.sc_event_map, public.sc_line_probe, public.sc_hypotheses, public.sc_shadow_selections to service_role;
grant usage, select on sequence public.sc_sharp_odds_id_seq, public.sc_line_probe_id_seq to service_role;

notify pgrst, 'reload schema';

-- ───────────────────────── acceptance checks ─────────────────────────
-- select devig_method, count(*) from prediction_log where created_at > now() - interval '1 day' group by 1;   -- one method
-- select id, status, frozen_at from sc_hypotheses order by id;                                               -- H1/H2 active+frozen, H3 draft
-- select count(*) from v_eval_selections where clv_sporty is not null;
