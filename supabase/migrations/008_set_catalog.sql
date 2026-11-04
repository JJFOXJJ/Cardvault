-- The approved set list: one standard name (plus details and checklist) per set, maintained by admins.
-- Users' cards are filed under these names; other spellings are kept as aliases so they snap to the approved name.
-- Run once in Supabase → SQL Editor. Safe to run more than once.

create table if not exists public.catalog_sets (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  aliases      text[] not null default '{}',     -- other spellings that mean this set (lower case)
  category     text,
  year         text,
  manufacturer text,
  checklist    jsonb not null default '[]'::jsonb, -- [{number, name, subset}]
  checklist_source text,                         -- 'link' | 'web' | 'pasted' | 'pokemon' | 'ai'
  checklist_url    text,
  checklist_updated_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists catalog_sets_name_idx on public.catalog_sets (lower(name));
alter table public.catalog_sets enable row level security;
