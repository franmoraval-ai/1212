-- Permisos personalizados por usuario para acceso granular.
-- Ejecutar una sola vez en ambientes existentes.

alter table public.users
  add column if not exists custom_permissions text[] default '{}'::text[];

create index if not exists idx_users_custom_permissions_gin
  on public.users using gin (custom_permissions);
