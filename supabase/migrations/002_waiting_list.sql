-- Adds the "save for later" waiting list. Run once in Supabase → SQL Editor.
-- Safe to run more than once.

alter table public.cards add column if not exists status text not null default 'catalogued'; -- 'pending' | 'catalogued'
alter table public.cards add column if not exists back_photo_url text;
alter table public.cards add column if not exists hint text;
alter table public.cards add column if not exists last_error text;

create index if not exists cards_status_idx on public.cards (status);
