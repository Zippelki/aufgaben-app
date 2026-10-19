-- Einmalig im Supabase SQL Editor ausführen.
create table if not exists public.aufgaben (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titel text not null default '',
  status text not null default 'Nicht begonnen',
  prio text default '',
  faellig text default '',
  begonnen text default '',
  abgeschlossen text default '',
  notiz text default '',
  erstellt text default '',
  geaendert text default '',
  geloescht boolean not null default false
);

create table if not exists public.einstellungen (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  automationen jsonb not null default '{}'::jsonb,
  geaendert text default ''
);

alter table public.aufgaben enable row level security;
alter table public.einstellungen enable row level security;

-- Jeder sieht und ändert nur seine eigenen Zeilen.
drop policy if exists "eigene aufgaben" on public.aufgaben;
create policy "eigene aufgaben" on public.aufgaben for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "eigene einstellungen" on public.einstellungen;
create policy "eigene einstellungen" on public.einstellungen for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
