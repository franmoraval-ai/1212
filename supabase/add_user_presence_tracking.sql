-- Presencia basica de usuarios en linea
-- Ejecutar una sola vez en ambientes ya existentes.

alter table public.users
  add column if not exists is_online boolean default false;

alter table public.users
  add column if not exists last_seen timestamptz;

create index if not exists idx_users_is_online_last_seen
  on public.users (is_online, last_seen desc);
