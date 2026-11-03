-- Sharing: a read-only link anyone can open, and sharing with other profiles in the app.
-- Run once in Supabase → SQL Editor. Safe to run more than once.

-- One link per profile. Turning the link off deletes the row (the old link stops working at once).
create table if not exists public.share_links (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  token       text not null unique,          -- long random secret in the link
  show_values boolean not null default true,
  created_at  timestamptz not null default now()
);

-- owner lets viewer see their collection (read-only).
create table if not exists public.profile_shares (
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  viewer_id   uuid not null references public.profiles(id) on delete cascade,
  show_values boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (owner_id, viewer_id),
  check (owner_id <> viewer_id)
);
create index if not exists profile_shares_viewer_idx on public.profile_shares (viewer_id);

alter table public.share_links enable row level security;
alter table public.profile_shares enable row level security;
