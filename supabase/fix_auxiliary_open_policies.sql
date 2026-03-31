-- Corrige tablas auxiliares que aún quedaron con "Allow all for authenticated".
-- Ejecutar si verify_access_hardening.sql todavía reporta abiertas:
-- - public.puestos
-- - public.visitas_puestos
-- - public.round_security_config

do $$
begin
  if to_regclass('public.round_security_config') is not null then
    execute 'alter table public.round_security_config enable row level security';
    execute 'drop policy if exists "Allow all for authenticated" on public.round_security_config';
    execute 'drop policy if exists round_security_config_select_authenticated on public.round_security_config';
    execute 'drop policy if exists round_security_config_insert_director on public.round_security_config';
    execute 'drop policy if exists round_security_config_update_director on public.round_security_config';
    execute 'drop policy if exists round_security_config_delete_director on public.round_security_config';
    execute 'create policy round_security_config_select_authenticated on public.round_security_config for select to authenticated using (public.app_is_active_user())';
    execute 'create policy round_security_config_insert_director on public.round_security_config for insert to authenticated with check (public.app_is_active_user() and public.app_is_role(4))';
    execute 'create policy round_security_config_update_director on public.round_security_config for update to authenticated using (public.app_is_active_user() and public.app_is_role(4)) with check (public.app_is_active_user() and public.app_is_role(4))';
    execute 'create policy round_security_config_delete_director on public.round_security_config for delete to authenticated using (public.app_is_active_user() and public.app_is_role(4))';
  end if;

  if to_regclass('public.puestos') is not null then
    execute 'alter table public.puestos enable row level security';
    execute 'drop policy if exists "Allow all for authenticated" on public.puestos';
    execute 'drop policy if exists puestos_select_authenticated on public.puestos';
    execute 'drop policy if exists puestos_insert_manager on public.puestos';
    execute 'drop policy if exists puestos_update_manager on public.puestos';
    execute 'drop policy if exists puestos_delete_director on public.puestos';
    execute 'create policy puestos_select_authenticated on public.puestos for select to authenticated using (public.app_is_active_user())';
    execute 'create policy puestos_insert_manager on public.puestos for insert to authenticated with check (public.app_is_active_user() and public.app_is_role(3))';
    execute 'create policy puestos_update_manager on public.puestos for update to authenticated using (public.app_is_active_user() and public.app_is_role(3)) with check (public.app_is_active_user() and public.app_is_role(3))';
    execute 'create policy puestos_delete_director on public.puestos for delete to authenticated using (public.app_is_active_user() and public.app_is_role(4))';
  end if;

  if to_regclass('public.visitas_puestos') is not null then
    execute 'alter table public.visitas_puestos enable row level security';
    execute 'drop policy if exists "Allow all for authenticated" on public.visitas_puestos';
    execute 'drop policy if exists visitas_puestos_select_scoped on public.visitas_puestos';
    execute 'drop policy if exists visitas_puestos_insert_owner on public.visitas_puestos';
    execute 'drop policy if exists visitas_puestos_update_supervisor on public.visitas_puestos';
    execute 'drop policy if exists visitas_puestos_delete_supervisor on public.visitas_puestos';
    execute 'create policy visitas_puestos_select_scoped on public.visitas_puestos for select to authenticated using (public.app_is_active_user() and (public.app_is_role(2) or public.app_matches_current_user(officer_id)))';
    execute 'create policy visitas_puestos_insert_owner on public.visitas_puestos for insert to authenticated with check (public.app_is_active_user() and public.app_matches_current_user(officer_id))';
    execute 'create policy visitas_puestos_update_supervisor on public.visitas_puestos for update to authenticated using (public.app_is_active_user() and public.app_is_role(2)) with check (public.app_is_active_user() and public.app_is_role(2))';
    execute 'create policy visitas_puestos_delete_supervisor on public.visitas_puestos for delete to authenticated using (public.app_is_active_user() and public.app_is_role(2))';
  end if;
end
$$;