-- Liked codes: users bookmark one or many codes and track WON / LOST with per-leg reasons.
-- Paste into the Supabase SQL editor (after schema.sql / schema-features.sql).

create table if not exists public.sc_liked_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  code text not null,
  source text not null default 'manual', -- sure|codes|past|generated|manual
  lane text, -- safe|boost|longshot|safe_code|value|combo|ai|custom
  day date,
  share_url text,
  total_odds numeric(12, 4),
  confidence numeric(6, 4),
  legs jsonb not null default '[]'::jsonb,
  leg_results jsonb not null default '[]'::jsonb,
  outcome text not null default 'PENDING', -- PENDING|WON|LOST|VOID
  loss_summary text,
  note text,
  checked_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code)
);

create index if not exists sc_liked_codes_user_idx
  on public.sc_liked_codes (user_id, created_at desc);
create index if not exists sc_liked_codes_pending_idx
  on public.sc_liked_codes (outcome, checked_at);

alter table public.sc_liked_codes enable row level security;

drop policy if exists sc_liked_codes_all_own on public.sc_liked_codes;
create policy sc_liked_codes_all_own on public.sc_liked_codes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.sc_liked_codes to authenticated;

notify pgrst, 'reload schema';
