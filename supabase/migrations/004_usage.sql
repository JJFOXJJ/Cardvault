-- Adds a usage counter for Brave searches and Gemini requests, per profile.
-- Run once in Supabase → SQL Editor. Safe to run more than once.

create table if not exists public.api_usage (
  period     text    not null,   -- Brave: month 'YYYY-MM' (UTC). Gemini: day 'YYYY-MM-DD' (US Pacific).
  service    text    not null,   -- 'brave' | 'gemini'
  profile_id uuid    not null,   -- no foreign key, so a deleted profile's usage still counts this month
  count      integer not null default 0,
  primary key (period, service, profile_id)
);
alter table public.api_usage enable row level security;

-- Atomic "add n" so two people scanning at the same time never lose a count.
create or replace function public.bump_usage(p_period text, p_service text, p_profile uuid, p_n integer default 1)
returns integer
language sql
as $$
  insert into public.api_usage (period, service, profile_id, count)
  values (p_period, p_service, p_profile, p_n)
  on conflict (period, service, profile_id)
  do update set count = public.api_usage.count + excluded.count
  returning count;
$$;

-- Only the app's server key may call it.
revoke execute on function public.bump_usage(text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.bump_usage(text, text, uuid, integer) to service_role;
