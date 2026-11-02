-- Adds set checklists (track a whole set and tick off the cards you own).
-- Run once in Supabase → SQL Editor. Safe to run more than once.

create table if not exists public.sets (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  name        text not null,                 -- matches cards.set_name
  tracking    boolean not null default true, -- false = owner chose "just this card"
  source      text,                          -- 'pokemon' | 'web' | 'manual'
  source_url  text,
  total       integer not null default 0,
  priced_at   timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists sets_profile_name_idx on public.sets (profile_id, lower(name));
alter table public.sets enable row level security;

create table if not exists public.set_cards (
  id          uuid primary key default gen_random_uuid(),
  set_id      uuid not null references public.sets(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  sort        integer not null default 0,
  number      text,
  name        text not null,
  subset      text,
  image_url   text,                          -- official picture when known (Pokémon)
  est_aud     numeric                        -- rough value from the set price lookup
);
create index if not exists set_cards_set_idx on public.set_cards (set_id, sort);
alter table public.set_cards enable row level security;

-- An owned card can point at its checklist entry.
alter table public.cards add column if not exists checklist_id uuid references public.set_cards(id) on delete set null;
create index if not exists cards_checklist_idx on public.cards (checklist_id);
