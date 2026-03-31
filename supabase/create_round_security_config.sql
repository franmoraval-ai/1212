-- Configuracion global de geofencing/antifraude para rondas

create table if not exists public.round_security_config (
  id text primary key,
  geofence_radius_meters int not null default 50,
  no_scan_gap_minutes int not null default 10,
  max_jump_meters int not null default 120,
  updated_by text,
  updated_at timestamptz default now()
);

alter table public.round_security_config enable row level security;

drop policy if exists "Allow all for authenticated" on public.round_security_config;
drop policy if exists round_security_config_select_authenticated on public.round_security_config;
drop policy if exists round_security_config_insert_director on public.round_security_config;
drop policy if exists round_security_config_update_director on public.round_security_config;
drop policy if exists round_security_config_delete_director on public.round_security_config;

create policy round_security_config_select_authenticated
  on public.round_security_config
  for select
  to authenticated
  using ((select auth.role()) = 'authenticated');

create policy round_security_config_insert_director
  on public.round_security_config
  for insert
  to authenticated
  with check (public.app_is_active_user() and public.app_is_role(4));

create policy round_security_config_update_director
  on public.round_security_config
  for update
  to authenticated
  using (public.app_is_active_user() and public.app_is_role(4))
  with check (public.app_is_active_user() and public.app_is_role(4));

create policy round_security_config_delete_director
  on public.round_security_config
  for delete
  to authenticated
  using (public.app_is_active_user() and public.app_is_role(4));

insert into public.round_security_config (id, geofence_radius_meters, no_scan_gap_minutes, max_jump_meters, updated_by)
values ('global', 50, 10, 120, 'system')
on conflict (id) do nothing;
