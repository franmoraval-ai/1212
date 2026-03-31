-- Verificación post-bootstrap y post-hardening.
-- Ejecutar después de:
-- 1) supabase/bootstrap_minimal_schema.sql
-- 2) supabase/harden_access_policies.sql

with expected_tables as (
  select *
  from (values
    ('users'),
    ('supervisions'),
    ('management_audits'),
    ('incidents'),
    ('rounds'),
    ('round_security_config'),
    ('puestos'),
    ('visitas_puestos'),
    ('weapons'),
    ('weapon_control_logs'),
    ('alerts'),
    ('visitors'),
    ('round_reports'),
    ('internal_notes'),
    ('round_sessions'),
    ('round_checkpoint_events')
  ) as t(table_name)
)
select
  et.table_name,
  case when c.oid is not null then 'OK' else 'MISSING' end as table_exists,
  case
    when c.oid is null then 'N/A'
    when c.relrowsecurity then 'ON'
    else 'OFF'
  end as rls_status
from expected_tables et
left join pg_class c
  on c.relname = et.table_name
 and c.relnamespace = 'public'::regnamespace
order by et.table_name;

select
  routine_name,
  case when count(*) > 0 then 'OK' else 'MISSING' end as function_exists
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'app_current_email',
    'app_current_uid',
    'app_current_role_level',
    'app_current_permissions',
    'app_current_status',
    'app_is_active_user',
    'app_is_role',
    'app_has_permission',
    'app_matches_current_user',
    'app_matches_assigned_scope',
    'app_can_access_round_session'
  )
group by routine_name
order by routine_name;

with expected_policies as (
  select *
  from (values
    ('users', 'users_select_scoped'),
    ('users', 'users_update_director'),
    ('users', 'users_delete_director'),
    ('supervisions', 'supervisions_select_scoped'),
    ('supervisions', 'supervisions_insert_owner'),
    ('supervisions', 'supervisions_update_owner_or_director'),
    ('supervisions', 'supervisions_delete_owner_or_director'),
    ('management_audits', 'management_audits_select_manager'),
    ('management_audits', 'management_audits_insert_manager'),
    ('management_audits', 'management_audits_update_manager'),
    ('management_audits', 'management_audits_delete_manager'),
    ('incidents', 'incidents_select_authenticated'),
    ('incidents', 'incidents_insert_authenticated'),
    ('incidents', 'incidents_update_supervisor'),
    ('incidents', 'incidents_delete_supervisor'),
    ('rounds', 'rounds_select_authenticated'),
    ('rounds', 'rounds_insert_director'),
    ('rounds', 'rounds_update_director'),
    ('rounds', 'rounds_delete_director'),
    ('round_security_config', 'round_security_config_select_authenticated'),
    ('round_security_config', 'round_security_config_insert_director'),
    ('round_security_config', 'round_security_config_update_director'),
    ('round_security_config', 'round_security_config_delete_director'),
    ('puestos', 'puestos_select_authenticated'),
    ('puestos', 'puestos_insert_manager'),
    ('puestos', 'puestos_update_manager'),
    ('puestos', 'puestos_delete_director'),
    ('visitas_puestos', 'visitas_puestos_select_scoped'),
    ('visitas_puestos', 'visitas_puestos_insert_owner'),
    ('visitas_puestos', 'visitas_puestos_update_supervisor'),
    ('visitas_puestos', 'visitas_puestos_delete_supervisor'),
    ('weapons', 'weapons_select_manager'),
    ('weapons', 'weapons_insert_manager'),
    ('weapons', 'weapons_update_manager'),
    ('weapons', 'weapons_delete_manager'),
    ('weapon_control_logs', 'weapon_control_logs_select_manager'),
    ('weapon_control_logs', 'weapon_control_logs_insert_manager'),
    ('weapon_control_logs', 'weapon_control_logs_delete_director'),
    ('alerts', 'alerts_select_scoped'),
    ('alerts', 'alerts_insert_authenticated'),
    ('alerts', 'alerts_update_manager'),
    ('alerts', 'alerts_delete_manager'),
    ('visitors', 'visitors_select_authenticated'),
    ('visitors', 'visitors_insert_supervisor'),
    ('visitors', 'visitors_update_supervisor'),
    ('visitors', 'visitors_delete_supervisor'),
    ('round_reports', 'round_reports_select_scoped'),
    ('round_reports', 'round_reports_insert_owner'),
    ('round_reports', 'round_reports_update_director'),
    ('round_reports', 'round_reports_delete_director'),
    ('internal_notes', 'internal_notes_select_scoped'),
    ('internal_notes', 'internal_notes_insert_owner'),
    ('internal_notes', 'internal_notes_update_supervisor'),
    ('internal_notes', 'internal_notes_delete_supervisor'),
    ('round_sessions', 'round_sessions_select_scoped'),
    ('round_sessions', 'round_sessions_insert_owner'),
    ('round_sessions', 'round_sessions_update_scoped'),
    ('round_sessions', 'round_sessions_delete_director'),
    ('round_checkpoint_events', 'round_checkpoint_events_select_scoped'),
    ('round_checkpoint_events', 'round_checkpoint_events_insert_scoped'),
    ('round_checkpoint_events', 'round_checkpoint_events_update_director'),
    ('round_checkpoint_events', 'round_checkpoint_events_delete_director')
  ) as p(table_name, policy_name)
)
select
  ep.table_name,
  ep.policy_name,
  case when pp.policyname is not null then 'OK' else 'MISSING' end as policy_status
from expected_policies ep
left join pg_policies pp
  on pp.schemaname = 'public'
 and pp.tablename = ep.table_name
 and pp.policyname = ep.policy_name
order by ep.table_name, ep.policy_name;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;