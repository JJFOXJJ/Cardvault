-- Adds profiles so several people can use the same site with separate collections.
-- Run once in Supabase → SQL Editor. Safe to run more than once.
-- Existing cards are claimed by the first profile, which is created on the sign-in screen
-- using your current APP_PIN.

create table if not exists public.profiles (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  name            text not null,
  pin_hash        text not null,
  is_admin        boolean not null default false,
  session_version integer not null default 1
);
create unique index if not exists profiles_name_idx on public.profiles (lower(name));
alter table public.profiles enable row level security;

alter table public.cards add column if not exists profile_id uuid references public.profiles(id) on delete cascade;
create index if not exists cards_profile_idx on public.cards (profile_id);
