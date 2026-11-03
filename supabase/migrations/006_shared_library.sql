-- Shared card library: anything found ONLINE (set checklists, card pictures, prices) is saved once
-- and reused by every profile, so the same lookup never costs a search twice.
-- Your own photos and your cards are never shared. Run once in Supabase → SQL Editor. Safe to run more than once.

create table if not exists public.shared_sets (
  key         text primary key,          -- set name reduced to sorted words, e.g. "1990 impel marvel universe"
  name        text not null,             -- name as first found
  source      text,                      -- 'web' | 'pokemon' | 'manual'
  source_url  text,
  entries     jsonb not null default '[]'::jsonb,  -- [{number, name, subset, est_aud}]
  total       integer not null default 0,
  priced_at   timestamptz,               -- when est_aud values were last looked up
  updated_at  timestamptz not null default now()
);

create table if not exists public.shared_pictures (
  key         text primary key,          -- set + card number (+ variant)
  image_url   text not null,             -- copy kept in storage under shared/ (never deleted with a card)
  source      text,
  created_at  timestamptz not null default now()
);

create table if not exists public.shared_prices (
  key         text primary key,          -- set + number + variant + grade
  value_usd   jsonb,                     -- {low, mid, high}
  value_notes text,
  price_sources jsonb not null default '[]'::jsonb,
  priced_at   timestamptz not null default now()
);

alter table public.shared_sets enable row level security;
alter table public.shared_pictures enable row level security;
alter table public.shared_prices enable row level security;
