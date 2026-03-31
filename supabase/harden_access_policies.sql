-- Endurecimiento de acceso y RLS para ambientes existentes.
-- Ejecutar una sola vez en Supabase SQL Editor.

create or replace function public.app_current_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce((select auth.jwt()) ->> 'email', ''));
$$;

create or replace function public.app_current_uid()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select auth.uid())::text, '');
$$;

create or replace function public.app_current_role_level()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select u.role_level from public.users u where lower(coalesce(u.email, '')) = public.app_current_email() limit 1
  ), 1);
$$;

create or replace function public.app_current_permissions()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select u.custom_permissions from public.users u where lower(coalesce(u.email, '')) = public.app_current_email() limit 1
  ), '{}'::text[]);
$$;

create or replace function public.app_current_status()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(coalesce((
    select u.status from public.users u where lower(coalesce(u.email, '')) = public.app_current_email() limit 1
  ), 'active')));
$$;

create or replace function public.app_is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select auth.role()) = 'authenticated' and public.app_current_status() in ('active', 'activo');
$$;

create or replace function public.app_is_role(min_role int)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_current_role_level() >= min_role;
$$;

create or replace function public.app_has_permission(permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(permission = any(public.app_current_permissions()), false);
$$;

create or replace function public.app_matches_current_user(value text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(coalesce(value, ''))) in (public.app_current_uid(), public.app_current_email());
$$;

create or replace function public.app_matches_assigned_scope(value text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from regexp_split_to_table(
      coalesce((select u.assigned from public.users u where lower(coalesce(u.email, '')) = public.app_current_email() limit 1), ''),
      '[|,;]+'
    ) as token
    where nullif(trim(token), '') is not null
      and lower(coalesce(value, '')) like '%' || lower(trim(token)) || '%'
  );
$$;

create or replace function public.app_can_access_round_session(target_session_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regclass('public.round_sessions') is null then
    return false;
  end if;

  return public.app_is_active_user()
    and exists (
      select 1
      from public.round_sessions rs
      where rs.id = target_session_id
        and (
          public.app_is_role(4)
          or public.app_matches_current_user(rs.officer_id)
          or public.app_matches_current_user(rs.supervisor_id)
        )
    );
end;
$$;

do $$
begin
  if to_regclass('public.users') is not null then
    execute 'alter table public.users enable row level security';
    execute 'drop policy if exists "Allow all for authenticated" on public.users';
    execute 'drop policy if exists users_select_scoped on public.users';
    execute 'drop policy if exists users_update_director on public.users';
    execute 'drop policy if exists users_delete_director on public.users';
    execute 'create policy users_select_scoped on public.users for select to authenticated using (public.app_is_active_user() and (public.app_is_role(4) or public.app_has_permission(''personnel_view'') or lower(coalesce(email, '''')) = public.app_current_email()))';
    execute 'create policy users_update_director on public.users for update to authenticated using (public.app_is_active_user() and public.app_is_role(4)) with check (public.app_is_active_user() and public.app_is_role(4))';
    execute 'create policy users_delete_director on public.users for delete to authenticated using (public.app_is_active_user() and public.app_is_role(4))';
  end if;

  if to_regclass('public.supervisions') is not null then
    execute 'alter table public.supervisions enable row level security';
    execute 'drop policy if exists "Allow all for authenticated" on public.supervisions';
    execute 'drop policy if exists supervisions_select_scoped on public.supervisions';
    execute 'drop policy if exists supervisions_insert_owner on public.supervisions';
    execute 'drop policy if exists supervisions_update_owner_or_director on public.supervisions';
    execute 'drop policy if exists supervisions_delete_owner_or_director on public.supervisions';
    execute 'create policy supervisions_select_scoped on public.supervisions for select to authenticated using (public.app_is_active_user() and (public.app_has_permission(''supervision_grouped_view'') or public.app_matches_current_user(supervisor_id) or public.app_matches_assigned_scope(review_post) or public.app_matches_assigned_scope(operation_name)))';
    execute 'create policy supervisions_insert_owner on public.supervisions for insert to authenticated with check (public.app_is_active_user() and public.app_matches_current_user(supervisor_id))';
    execute 'create policy supervisions_update_owner_or_director on public.supervisions for update to authenticated using (public.app_is_active_user() and (public.app_is_role(4) or public.app_matches_current_user(supervisor_id))) with check (public.app_is_active_user() and (public.app_is_role(4) or public.app_matches_current_user(supervisor_id)))';
    execute 'create policy supervisions_delete_owner_or_director on public.supervisions for delete to authenticated using (public.app_is_active_user() and (public.app_is_role(4) or public.app_matches_current_user(supervisor_id)))';
  end if;

  if to_regclass('public.management_audits') is not null then
    execute 'alter table public.management_audits enable row level security';
    execute 'drop policy if exists "Allow all for authenticated" on public.management_audits';
    execute 'drop policy if exists management_audits_select_manager on public.management_audits';
    execute 'drop policy if exists management_audits_insert_manager on public.management_audits';
    execute 'drop policy if exists management_audits_update_manager on public.management_audits';
    execute 'drop policy if exists management_audits_delete_manager on public.management_audits';
    execute 'create policy management_audits_select_manager on public.management_audits for select to authenticated using (public.app_is_active_user() and (public.app_is_role(4) or public.app_matches_current_user(manager_id) or public.app_matches_assigned_scope(post_name) or public.app_matches_assigned_scope(operation_name)))';
    execute 'create policy management_audits_insert_manager on public.management_audits for insert to authenticated with check (public.app_is_active_user() and (public.app_is_role(4) or public.app_matches_current_user(manager_id)))';
    execute 'create policy management_audits_update_manager on public.management_audits for update to authenticated using (public.app_is_active_user() and (public.app_is_role(4) or public.app_matches_current_user(manager_id) or public.app_matches_assigned_scope(post_name) or public.app_matches_assigned_scope(operation_name))) with check (public.app_is_active_user() and (public.app_is_role(4) or public.app_matches_current_user(manager_id) or public.app_matches_assigned_scope(post_name) or public.app_matches_assigned_scope(operation_name)))';
    execute 'create policy management_audits_delete_manager on public.management_audits for delete to authenticated using (public.app_is_active_user() and (public.app_is_role(4) or public.app_matches_current_user(manager_id) or public.app_matches_assigned_scope(post_name) or public.app_matches_assigned_scope(operation_name)))';
  end if;

  if to_regclass('public.incidents') is not null then
    execute 'alter table public.incidents enable row level security';
    execute 'drop policy if exists "Allow all for authenticated" on public.incidents';
    execute 'drop policy if exists incidents_select_authenticated on public.incidents';
    execute 'drop policy if exists incidents_insert_authenticated on public.incidents';
    execute 'drop policy if exists incidents_update_supervisor on public.incidents';
    execute 'drop policy if exists incidents_delete_supervisor on public.incidents';
    execute ''create policy incidents_select_authenticated on public.incidents for select to authenticated using (public.app_is_active_user() and (public.app_is_role(3) or public.app_matches_current_user(reported_by_user_id) or public.app_matches_current_user(reported_by_email) or public.app_matches_assigned_scope(location) or public.app_matches_assigned_scope(lugar)))'';
    execute ''create policy incidents_insert_authenticated on public.incidents for insert to authenticated with check (public.app_is_active_user() and (public.app_matches_current_user(reported_by_user_id) or public.app_matches_current_user(reported_by_email)))'';
    execute ''create policy incidents_update_supervisor on public.incidents for update to authenticated using (public.app_is_active_user() and (public.app_is_role(3) or (public.app_is_role(2) and (public.app_matches_current_user(reported_by_user_id) or public.app_matches_current_user(reported_by_email) or public.app_matches_assigned_scope(location) or public.app_matches_assigned_scope(lugar))))) with check (public.app_is_active_user() and (public.app_is_role(3) or (public.app_is_role(2) and (public.app_matches_current_user(reported_by_user_id) or public.app_matches_current_user(reported_by_email) or public.app_matches_assigned_scope(location) or public.app_matches_assigned_scope(lugar)))) )'';
    execute ''create policy incidents_delete_supervisor on public.incidents for delete to authenticated using (public.app_is_active_user() and (public.app_is_role(3) or (public.app_is_role(2) and (public.app_matches_current_user(reported_by_user_id) or public.app_matches_current_user(reported_by_email) or public.app_matches_assigned_scope(location) or public.app_matches_assigned_scope(lugar)))))'';
  end if;

  if to_regclass('public.rounds') is not null then
    execute 'alter table public.rounds enable row level security';
    execute 'drop policy if exists "Allow all for authenticated" on public.rounds';
    execute 'drop policy if exists rounds_select_authenticated on public.rounds';
    execute 'drop policy if exists rounds_insert_director on public.rounds';
    execute 'drop policy if exists rounds_update_director on public.rounds';
    execute 'drop policy if exists rounds_delete_director on public.rounds';
    execute 'create policy rounds_select_authenticated on public.rounds for select to authenticated using (public.app_is_active_user())';
    execute 'create policy rounds_insert_director on public.rounds for insert to authenticated with check (public.app_is_active_user() and public.app_is_role(4))';
    execute 'create policy rounds_update_director on public.rounds for update to authenticated using (public.app_is_active_user() and public.app_is_role(4)) with check (public.app_is_active_user() and public.app_is_role(4))';
    execute 'create policy rounds_delete_director on public.rounds for delete to authenticated using (public.app_is_active_user() and public.app_is_role(4))';
  end if;

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
    execute '' ||
      'create policy visitas_puestos_select_scoped on public.visitas_puestos for select to authenticated using (' ||
      'public.app_is_active_user() and (public.app_is_role(2) or public.app_matches_current_user(officer_id))' ||
      ')';
    execute 'create policy visitas_puestos_insert_owner on public.visitas_puestos for insert to authenticated with check (public.app_is_active_user() and public.app_matches_current_user(officer_id))';
    execute 'create policy visitas_puestos_update_supervisor on public.visitas_puestos for update to authenticated using (public.app_is_active_user() and public.app_is_role(2)) with check (public.app_is_active_user() and public.app_is_role(2))';
    execute 'create policy visitas_puestos_delete_supervisor on public.visitas_puestos for delete to authenticated using (public.app_is_active_user() and public.app_is_role(2))';
  end if;

  if to_regclass('public.weapons') is not null then
    execute 'alter table public.weapons enable row level security';
    execute 'drop policy if exists "Allow all for authenticated" on public.weapons';
    execute 'drop policy if exists weapons_select_manager on public.weapons';
    execute 'drop policy if exists weapons_insert_manager on public.weapons';
    execute 'drop policy if exists weapons_update_manager on public.weapons';
    execute 'drop policy if exists weapons_delete_manager on public.weapons';
    execute 'create policy weapons_select_manager on public.weapons for select to authenticated using (public.app_is_active_user() and public.app_is_role(2))';
    execute 'create policy weapons_insert_manager on public.weapons for insert to authenticated with check (public.app_is_active_user() and public.app_is_role(3))';
    execute 'create policy weapons_update_manager on public.weapons for update to authenticated using (public.app_is_active_user() and public.app_is_role(3)) with check (public.app_is_active_user() and public.app_is_role(3))';
    execute 'create policy weapons_delete_manager on public.weapons for delete to authenticated using (public.app_is_active_user() and public.app_is_role(3))';
  end if;

  if to_regclass('public.weapon_control_logs') is not null then
    execute 'alter table public.weapon_control_logs enable row level security';
    execute 'drop policy if exists "Allow all for authenticated" on public.weapon_control_logs';
    execute 'drop policy if exists weapon_control_logs_select_manager on public.weapon_control_logs';
    execute 'drop policy if exists weapon_control_logs_insert_manager on public.weapon_control_logs';
    execute 'drop policy if exists weapon_control_logs_delete_director on public.weapon_control_logs';
    execute 'create policy weapon_control_logs_select_manager on public.weapon_control_logs for select to authenticated using (public.app_is_active_user() and public.app_is_role(3))';
    execute 'create policy weapon_control_logs_insert_manager on public.weapon_control_logs for insert to authenticated with check (public.app_is_active_user() and public.app_is_role(3))';
    execute 'create policy weapon_control_logs_delete_director on public.weapon_control_logs for delete to authenticated using (public.app_is_active_user() and public.app_is_role(4))';
  end if;

  if to_regclass('public.alerts') is not null then
    execute 'alter table public.alerts enable row level security';
    execute 'drop policy if exists "Allow all for authenticated" on public.alerts';
    execute 'drop policy if exists alerts_select_scoped on public.alerts';
    execute 'drop policy if exists alerts_insert_authenticated on public.alerts';
    execute 'drop policy if exists alerts_update_manager on public.alerts';
    execute 'drop policy if exists alerts_delete_manager on public.alerts';
    execute 'create policy alerts_select_scoped on public.alerts for select to authenticated using (public.app_is_active_user() and (public.app_is_role(2) or public.app_matches_current_user(user_id) or public.app_matches_current_user(user_email)))';
    execute 'create policy alerts_insert_authenticated on public.alerts for insert to authenticated with check (public.app_is_active_user())';
    execute 'create policy alerts_update_manager on public.alerts for update to authenticated using (public.app_is_active_user() and public.app_is_role(3)) with check (public.app_is_active_user() and public.app_is_role(3))';
    execute 'create policy alerts_delete_manager on public.alerts for delete to authenticated using (public.app_is_active_user() and public.app_is_role(3))';
  end if;

  if to_regclass('public.visitors') is not null then
    execute 'alter table public.visitors enable row level security';
    execute 'drop policy if exists "Allow all for authenticated" on public.visitors';
    execute 'drop policy if exists visitors_select_authenticated on public.visitors';
    execute 'drop policy if exists visitors_insert_supervisor on public.visitors';
    execute 'drop policy if exists visitors_update_supervisor on public.visitors';
    execute 'drop policy if exists visitors_delete_supervisor on public.visitors';
    execute 'create policy visitors_select_authenticated on public.visitors for select to authenticated using (public.app_is_active_user())';
    execute 'create policy visitors_insert_supervisor on public.visitors for insert to authenticated with check (public.app_is_active_user() and public.app_is_role(2))';
    execute 'create policy visitors_update_supervisor on public.visitors for update to authenticated using (public.app_is_active_user() and public.app_is_role(2)) with check (public.app_is_active_user() and public.app_is_role(2))';
    execute 'create policy visitors_delete_supervisor on public.visitors for delete to authenticated using (public.app_is_active_user() and public.app_is_role(2))';
  end if;

  if to_regclass('public.round_reports') is not null then
    execute 'alter table public.round_reports enable row level security';
    execute 'drop policy if exists "Allow all for authenticated" on public.round_reports';
    execute 'drop policy if exists round_reports_select_scoped on public.round_reports';
    execute 'drop policy if exists round_reports_insert_owner on public.round_reports';
    execute 'drop policy if exists round_reports_update_director on public.round_reports';
    execute 'drop policy if exists round_reports_delete_director on public.round_reports';
    execute 'create policy round_reports_select_scoped on public.round_reports for select to authenticated using (public.app_is_active_user() and (public.app_has_permission(''supervision_grouped_view'') or public.app_matches_current_user(officer_id) or public.app_matches_assigned_scope(post_name) or public.app_matches_assigned_scope(round_name)))';
    execute 'create policy round_reports_insert_owner on public.round_reports for insert to authenticated with check (public.app_is_active_user() and public.app_matches_current_user(officer_id))';
    execute 'create policy round_reports_update_director on public.round_reports for update to authenticated using (public.app_is_active_user() and public.app_is_role(4)) with check (public.app_is_active_user() and public.app_is_role(4))';
    execute 'create policy round_reports_delete_director on public.round_reports for delete to authenticated using (public.app_is_active_user() and public.app_is_role(4))';
  end if;

  if to_regclass('public.internal_notes') is not null then
    execute 'alter table public.internal_notes enable row level security';
    execute 'drop policy if exists "Allow all for authenticated" on public.internal_notes';
    execute 'drop policy if exists internal_notes_select_scoped on public.internal_notes';
    execute 'drop policy if exists internal_notes_insert_owner on public.internal_notes';
    execute 'drop policy if exists internal_notes_update_supervisor on public.internal_notes';
    execute 'drop policy if exists internal_notes_delete_supervisor on public.internal_notes';
    execute 'create policy internal_notes_select_scoped on public.internal_notes for select to authenticated using (public.app_is_active_user() and (public.app_is_role(2) or public.app_matches_current_user(reported_by_user_id) or public.app_matches_current_user(reported_by_email) or public.app_matches_assigned_scope(post_name)))';
    execute 'create policy internal_notes_insert_owner on public.internal_notes for insert to authenticated with check (public.app_is_active_user() and (public.app_matches_current_user(reported_by_user_id) or public.app_matches_current_user(reported_by_email)))';
    execute ''create policy internal_notes_update_supervisor on public.internal_notes for update to authenticated using (public.app_is_active_user() and (public.app_is_role(3) or (public.app_is_role(2) and (public.app_matches_current_user(reported_by_user_id) or public.app_matches_current_user(reported_by_email) or public.app_matches_assigned_scope(post_name))))) with check (public.app_is_active_user() and (public.app_is_role(3) or (public.app_is_role(2) and (public.app_matches_current_user(reported_by_user_id) or public.app_matches_current_user(reported_by_email) or public.app_matches_assigned_scope(post_name)))))'';
    execute ''create policy internal_notes_delete_supervisor on public.internal_notes for delete to authenticated using (public.app_is_active_user() and (public.app_is_role(3) or (public.app_is_role(2) and (public.app_matches_current_user(reported_by_user_id) or public.app_matches_current_user(reported_by_email) or public.app_matches_assigned_scope(post_name)))))'';
  end if;

  if to_regclass('public.round_sessions') is not null then
    execute 'alter table public.round_sessions enable row level security';
    execute 'drop policy if exists "Allow all for authenticated" on public.round_sessions';
    execute 'drop policy if exists round_sessions_select_scoped on public.round_sessions';
    execute 'drop policy if exists round_sessions_insert_owner on public.round_sessions';
    execute 'drop policy if exists round_sessions_update_scoped on public.round_sessions';
    execute 'drop policy if exists round_sessions_delete_director on public.round_sessions';
    execute 'create policy round_sessions_select_scoped on public.round_sessions for select to authenticated using (public.app_can_access_round_session(id))';
    execute 'create policy round_sessions_insert_owner on public.round_sessions for insert to authenticated with check (public.app_is_active_user() and public.app_matches_current_user(officer_id))';
    execute 'create policy round_sessions_update_scoped on public.round_sessions for update to authenticated using (public.app_can_access_round_session(id)) with check (public.app_can_access_round_session(id))';
    execute 'create policy round_sessions_delete_director on public.round_sessions for delete to authenticated using (public.app_is_active_user() and public.app_is_role(4))';
  end if;

  if to_regclass('public.round_checkpoint_events') is not null then
    execute 'alter table public.round_checkpoint_events enable row level security';
    execute 'drop policy if exists "Allow all for authenticated" on public.round_checkpoint_events';
    execute 'drop policy if exists round_checkpoint_events_select_scoped on public.round_checkpoint_events';
    execute 'drop policy if exists round_checkpoint_events_insert_scoped on public.round_checkpoint_events';
    execute 'drop policy if exists round_checkpoint_events_update_director on public.round_checkpoint_events';
    execute 'drop policy if exists round_checkpoint_events_delete_director on public.round_checkpoint_events';
    execute 'create policy round_checkpoint_events_select_scoped on public.round_checkpoint_events for select to authenticated using (public.app_is_active_user() and (public.app_is_role(4) or public.app_can_access_round_session(session_id)))';
    execute 'create policy round_checkpoint_events_insert_scoped on public.round_checkpoint_events for insert to authenticated with check (public.app_is_active_user() and (public.app_is_role(4) or public.app_can_access_round_session(session_id)))';
    execute 'create policy round_checkpoint_events_update_director on public.round_checkpoint_events for update to authenticated using (public.app_is_active_user() and public.app_is_role(4)) with check (public.app_is_active_user() and public.app_is_role(4))';
    execute 'create policy round_checkpoint_events_delete_director on public.round_checkpoint_events for delete to authenticated using (public.app_is_active_user() and public.app_is_role(4))';
  end if;
end
$$;