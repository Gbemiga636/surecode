-- exbot (hidden page https://surecodev1.vercel.app/exbot). Run once in the
-- Supabase SQL editor; safe to re-run. It only creates exbot_ tables and one
-- pg_cron job, and never touches sc_ tables.
--
-- Row level security is on with no policies, so the browser (anon and
-- authenticated roles) can read nothing here; only the server, using the
-- service-role key, can. Exchange keys are stored AES-256-GCM encrypted.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.exbot_accounts (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  email             text not null,
  exchange          text not null default 'bybit' check (exchange in ('bybit', 'binance')),
  mode              text not null default 'paper' check (mode in ('paper', 'testnet', 'live')),
  enabled           boolean not null default false,
  key_enc           text,
  secret_enc        text,
  key_hint          text,
  key_check         text,
  key_checked_at    timestamptz,
  live_confirmed_at timestamptz,
  paper_start       numeric not null default 10000 check (paper_start > 0),
  status            text,
  status_at         timestamptz,
  lock_until        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Risk-manager memory, last processed bar per coin, practice balance: one row per user and mode.
create table if not exists public.exbot_state (
  user_id    uuid not null references auth.users(id) on delete cascade,
  mode       text not null check (mode in ('paper', 'testnet', 'live')),
  risk       jsonb not null default '{}'::jsonb,
  last_bar   jsonb not null default '{}'::jsonb,
  paper_cash numeric,
  updated_at timestamptz not null default now(),
  primary key (user_id, mode)
);

create table if not exists public.exbot_positions (
  user_id    uuid not null references auth.users(id) on delete cascade,
  mode       text not null,
  symbol     text not null,
  data       jsonb not null,
  trade_id   bigint,
  updated_at timestamptz not null default now(),
  primary key (user_id, mode, symbol)
);

create table if not exists public.exbot_trades (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  mode        text not null,
  exchange    text not null,
  symbol      text not null,
  side        smallint not null check (side in (-1, 1)),
  qty         numeric not null,
  entry       numeric not null,
  stop0       numeric not null,
  entry_time  timestamptz not null,
  reason_in   text,
  exit_time   timestamptz,
  pnl         numeric,
  fees        numeric,
  r_mult      numeric,
  reason_out  text,
  exits       jsonb,
  status      text not null default 'open' check (status in ('open', 'closed'))
);
create index if not exists exbot_trades_user_idx on public.exbot_trades (user_id, mode, entry_time desc);

create table if not exists public.exbot_events (
  id      bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  at      timestamptz not null default now(),
  level   text not null default 'info' check (level in ('info', 'trade', 'warn', 'error')),
  message text not null
);
create index if not exists exbot_events_user_idx on public.exbot_events (user_id, at desc);

-- Token pg_cron sends to /api/exbot/tick (generated here, never typed anywhere).
create table if not exists public.exbot_runtime (
  id         smallint primary key default 1 check (id = 1),
  cron_token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  updated_at timestamptz not null default now()
);
insert into public.exbot_runtime (id) values (1) on conflict (id) do nothing;

alter table public.exbot_accounts  enable row level security;
alter table public.exbot_state     enable row level security;
alter table public.exbot_positions enable row level security;
alter table public.exbot_trades    enable row level security;
alter table public.exbot_events    enable row level security;
alter table public.exbot_runtime   enable row level security;
revoke all on public.exbot_accounts, public.exbot_state, public.exbot_positions,
  public.exbot_trades, public.exbot_events, public.exbot_runtime from anon, authenticated;

-- Every 5 minutes, one minute after each 5-minute mark (4h candles close on the hour).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'exbot-tick') then
    perform cron.unschedule('exbot-tick');
  end if;
end $$;

select cron.schedule(
  'exbot-tick',
  '1-59/5 * * * *',
  $$
  select net.http_post(
    url := 'https://surecodev1.vercel.app/api/exbot/tick',
    headers := jsonb_build_object('x-exbot-cron', (select cron_token from public.exbot_runtime where id = 1)),
    timeout_milliseconds := 60000
  );
  $$
);
