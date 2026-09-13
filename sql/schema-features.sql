-- SureCode feature expansion — paste AFTER schema.sql (sc_ prefix, shared DB safe)

-- Cached daily pick pools (expert / value / combo / predictions snapshots)
create table if not exists public.sc_pick_pools (
  id text primary key, -- e.g. expert-result, value, combo, predictions
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Generated SportyBet codes from the app (user or crawl)
create table if not exists public.sc_generated_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  code text not null,
  share_url text,
  total_odds numeric(12, 4),
  origin text not null default 'manual', -- expert|value|combo|predictions|analysis|sure|auto
  legs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sc_generated_codes_created_idx
  on public.sc_generated_codes (created_at desc);

-- Plenty of human-style / crawl-published codes (beyond the 3 sure slips)
create table if not exists public.sc_codes (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  code text not null,
  share_url text,
  total_odds numeric(12, 4),
  confidence numeric(6, 4),
  legs jsonb not null default '[]'::jsonb,
  rationale text,
  code_type text not null default 'SAFE', -- SAFE|VALUE|COMBO|AI
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  unique (day, code)
);

create index if not exists sc_codes_day_idx on public.sc_codes (day desc);

-- Saved picks / preferences (lightweight personalization)
create table if not exists public.sc_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  game_type text default 'result',
  min_confidence numeric(6, 4) default 0.55,
  max_odds numeric(8, 2) default 5,
  favorite_leagues text[] default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.sc_saved_picks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  home text,
  away text,
  pick text,
  odds numeric(8, 2),
  confidence numeric(6, 4),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists sc_saved_picks_user_idx on public.sc_saved_picks (user_id, created_at desc);

alter table public.sc_pick_pools enable row level security;
alter table public.sc_generated_codes enable row level security;
alter table public.sc_codes enable row level security;
alter table public.sc_preferences enable row level security;
alter table public.sc_saved_picks enable row level security;

drop policy if exists sc_pick_pools_read on public.sc_pick_pools;
create policy sc_pick_pools_read on public.sc_pick_pools
  for select to authenticated using (true);

drop policy if exists sc_codes_read on public.sc_codes;
create policy sc_codes_read on public.sc_codes
  for select to authenticated using (true);

drop policy if exists sc_generated_codes_read on public.sc_generated_codes;
create policy sc_generated_codes_read on public.sc_generated_codes
  for select to authenticated using (true);

drop policy if exists sc_generated_codes_insert_own on public.sc_generated_codes;
create policy sc_generated_codes_insert_own on public.sc_generated_codes
  for insert to authenticated with check (user_id = auth.uid() or user_id is null);

drop policy if exists sc_preferences_all_own on public.sc_preferences;
create policy sc_preferences_all_own on public.sc_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists sc_saved_picks_all_own on public.sc_saved_picks;
create policy sc_saved_picks_all_own on public.sc_saved_picks
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select on public.sc_pick_pools, public.sc_codes, public.sc_generated_codes to authenticated;
grant select, insert on public.sc_generated_codes to authenticated;
grant select, insert, update, delete on public.sc_preferences, public.sc_saved_picks to authenticated;

notify pgrst, 'reload schema';
