-- SureCode — paste into Supabase SQL Editor (run once)
-- All tables/functions/triggers use the sc_ prefix for shared databases.

-- Profiles (1:1 with auth.users)
create table if not exists public.sc_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create or replace function public.sc_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sc_profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists sc_on_auth_user_created on auth.users;
create trigger sc_on_auth_user_created
  after insert on auth.users
  for each row execute function public.sc_handle_new_user();

-- Today's / scheduled sure codes (openable SportyBet share codes)
create table if not exists public.sc_sure_codes (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  slot smallint not null default 1,
  code text not null,
  share_url text,
  total_odds numeric(12, 4),
  confidence numeric(6, 4),
  legs jsonb not null default '[]'::jsonb,
  rationale text,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'SETTLED', 'VOID', 'EXPIRED')),
  outcome text check (outcome is null or outcome in ('WON', 'LOST', 'VOID', 'PENDING')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (day, slot)
);

create index if not exists sc_sure_codes_day_idx on public.sc_sure_codes (day desc);

-- Historical published codes
create table if not exists public.sc_past_codes (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  code text not null,
  share_url text,
  total_odds numeric(12, 4),
  confidence numeric(6, 4),
  legs jsonb not null default '[]'::jsonb,
  rationale text,
  outcome text check (outcome is null or outcome in ('WON', 'LOST', 'VOID', 'PENDING')),
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sc_past_codes_day_idx on public.sc_past_codes (day desc);

-- Demo wallet (virtual NGN)
create table if not exists public.sc_demo_wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance numeric(14, 2) not null default 100000,
  staked numeric(14, 2) not null default 0,
  returned numeric(14, 2) not null default 0,
  reset_day date not null default ((now() at time zone 'Africa/Lagos')::date),
  updated_at timestamptz not null default now()
);

create table if not exists public.sc_demo_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sure_code_id uuid references public.sc_sure_codes (id) on delete set null,
  code text,
  stake numeric(14, 2) not null,
  total_odds numeric(12, 4) not null,
  potential numeric(14, 2) not null,
  legs jsonb not null default '[]'::jsonb,
  outcome text not null default 'PENDING'
    check (outcome in ('PENDING', 'WON', 'LOST', 'VOID')),
  payout numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index if not exists sc_demo_bets_user_idx on public.sc_demo_bets (user_id, created_at desc);

-- Crawl run log
create table if not exists public.sc_crawl_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  summary text,
  codes_written int not null default 0
);

create or replace function public.sc_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sc_sure_codes_updated on public.sc_sure_codes;
create trigger sc_sure_codes_updated
  before update on public.sc_sure_codes
  for each row execute function public.sc_set_updated_at();

drop trigger if exists sc_demo_wallets_updated on public.sc_demo_wallets;
create trigger sc_demo_wallets_updated
  before update on public.sc_demo_wallets
  for each row execute function public.sc_set_updated_at();

-- RLS
alter table public.sc_profiles enable row level security;
alter table public.sc_sure_codes enable row level security;
alter table public.sc_past_codes enable row level security;
alter table public.sc_demo_wallets enable row level security;
alter table public.sc_demo_bets enable row level security;
alter table public.sc_crawl_runs enable row level security;

drop policy if exists sc_profiles_select_own on public.sc_profiles;
create policy sc_profiles_select_own on public.sc_profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists sc_profiles_update_own on public.sc_profiles;
create policy sc_profiles_update_own on public.sc_profiles
  for update to authenticated using (id = auth.uid());

drop policy if exists sc_sure_codes_read on public.sc_sure_codes;
create policy sc_sure_codes_read on public.sc_sure_codes
  for select to authenticated using (true);

drop policy if exists sc_past_codes_read on public.sc_past_codes;
create policy sc_past_codes_read on public.sc_past_codes
  for select to authenticated using (true);

drop policy if exists sc_crawl_runs_read on public.sc_crawl_runs;
create policy sc_crawl_runs_read on public.sc_crawl_runs
  for select to authenticated using (true);

drop policy if exists sc_demo_wallets_all_own on public.sc_demo_wallets;
create policy sc_demo_wallets_all_own on public.sc_demo_wallets
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists sc_demo_bets_all_own on public.sc_demo_bets;
create policy sc_demo_bets_all_own on public.sc_demo_bets
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant usage on schema public to authenticated;
grant select on public.sc_sure_codes, public.sc_past_codes, public.sc_crawl_runs to authenticated;
grant select, update on public.sc_profiles to authenticated;
grant select, insert, update, delete on public.sc_demo_wallets, public.sc_demo_bets to authenticated;

-- Refresh PostgREST schema cache (required after creating tables on shared Supabase)
notify pgrst, 'reload schema';
