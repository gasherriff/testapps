create table if not exists public.notes (
  id uuid primary key,
  text text not null default '',
  translated_text text not null default '',
  detected_language text,
  translation_status text not null default 'idle',
  color text not null,
  x integer not null default 24,
  y integer not null default 24,
  z_index integer not null default 1,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

alter table public.notes
add column if not exists translated_text text not null default '';

alter table public.notes
add column if not exists detected_language text;

alter table public.notes
add column if not exists translation_status text not null default 'idle';

drop trigger if exists notes_set_updated_at on public.notes;

create trigger notes_set_updated_at
before update on public.notes
for each row
execute function public.set_updated_at();

alter table public.notes enable row level security;

create policy "Public notes are readable"
on public.notes
for select
to anon, authenticated
using (true);

create policy "Public notes are insertable"
on public.notes
for insert
to anon, authenticated
with check (true);

create policy "Public notes are updateable"
on public.notes
for update
to anon, authenticated
using (true)
with check (true);

create policy "Public notes are deletable"
on public.notes
for delete
to anon, authenticated
using (true);
