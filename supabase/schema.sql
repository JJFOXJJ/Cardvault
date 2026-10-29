-- Card Vault schema. Paste into Supabase → SQL Editor → Run.

create table if not exists public.cards (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- What the card is
  category        text not null default 'Other',   -- Marvel, Basketball, The Simpsons, Pokémon, Other
  name            text not null,                   -- display title
  subject         text,                            -- player / character
  year            text,
  manufacturer    text,
  set_name        text,                            -- the collection / set it belongs to
  card_number     text,
  variant         text,                            -- parallel, insert, refractor, holo…
  graded          text,                            -- e.g. "PSA 9" or null for raw

  -- Your copy
  condition       text,
  quantity        integer not null default 1 check (quantity > 0),
  notes           text,

  -- Pictures
  image_url       text,                            -- clean picture found online (stored in our bucket)
  image_source    text,                            -- page it came from
  photo_url       text,                            -- your own photo, kept for condition reference

  -- Value (per card)
  value_usd_mid   numeric,
  aud_low         numeric,
  aud_mid         numeric,
  aud_high        numeric,
  fx_usd_aud      numeric,
  value_notes     text,
  price_sources   jsonb not null default '[]'::jsonb,
  priced_at       timestamptz,
  confidence      text
);

create index if not exists cards_set_idx on public.cards (set_name);
create index if not exists cards_category_idx on public.cards (category);

-- Login throttling for the PIN screen
create table if not exists public.login_attempts (
  ip               text primary key,
  failures         integer not null default 0,
  first_failure_at timestamptz not null default now(),
  locked_until     timestamptz
);

-- Row Level Security on, with no policies: the public anon key can read nothing.
-- The app talks to Supabase only from the server with the service-role key, behind the PIN.
alter table public.cards enable row level security;
alter table public.login_attempts enable row level security;

-- Image bucket (public read so <img> tags work; file names are random UUIDs)
insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', true)
on conflict (id) do nothing;

-- Waiting list ("save for later") — same as migrations/002_waiting_list.sql
alter table public.cards add column if not exists status text not null default 'catalogued';
alter table public.cards add column if not exists back_photo_url text;
alter table public.cards add column if not exists hint text;
alter table public.cards add column if not exists last_error text;
create index if not exists cards_status_idx on public.cards (status);

-- Profiles (separate collections per person) — same as migrations/003_profiles.sql
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

-- Usage counter — same as migrations/004_usage.sql
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
