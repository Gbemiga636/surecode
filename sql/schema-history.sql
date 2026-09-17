-- Leg-level settled history for SureCode learning (run in Supabase SQL editor)
-- Accumulates toward 1000+ rows as crawls settle real SportyBet results.

create table if not exists public.sc_leg_history (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  home text not null,
  away text not null,
  league text,
  pick_code text not null,
  pick_label text,
  odds numeric(10, 4),
  home_score int,
  away_score int,
  won boolean not null,
  settled_at timestamptz not null default now(),
  unique (event_id, pick_code)
);

create index if not exists sc_leg_history_pick_idx
  on public.sc_leg_history (pick_code, won);
create index if not exists sc_leg_history_league_idx
  on public.sc_leg_history (league, pick_code);
create index if not exists sc_leg_history_settled_idx
  on public.sc_leg_history (settled_at desc);

alter table public.sc_leg_history enable row level security;
drop policy if exists sc_leg_history_read on public.sc_leg_history;
create policy sc_leg_history_read on public.sc_leg_history
  for select to authenticated using (true);

grant select on public.sc_leg_history to authenticated;

notify pgrst, 'reload schema';
