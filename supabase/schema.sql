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
