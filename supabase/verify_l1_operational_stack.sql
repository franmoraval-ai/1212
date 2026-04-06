-- Verificación rápida del stack L1 operativo.
-- Ejecutar después de aplicar:
-- 1) supabase/add_station_officer_authorizations.sql
-- 2) supabase/add_station_profiles.sql
-- 3) supabase/add_station_shift_mode.sql
-- 4) supabase/add_l1_attendance.sql

with expected_tables as (
  select *
  from (values
    ('operation_catalog'),
    ('station_officer_authorizations'),
    ('station_profiles'),
    ('shift_handoffs'),
    ('attendance_logs'),
    ('round_sessions')
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

with expected_functions as (
  select *
  from (values
    ('app_is_active_user'),
    ('app_is_role'),
    ('app_matches_assigned_scope'),
    ('set_station_profiles_updated_at'),
    ('sync_station_profile_from_catalog')
  ) as f(function_name)
)
select
  ef.function_name,
  case when r.routine_name is not null then 'OK' else 'MISSING' end as function_exists
from expected_functions ef
left join information_schema.routines r
  on r.routine_schema = 'public'
 and r.routine_name = ef.function_name
order by ef.function_name;

with expected_indexes as (
  select *
  from (values
    ('idx_station_officer_authorizations_unique'),
    ('idx_station_officer_authorizations_officer'),
    ('idx_station_officer_authorizations_catalog'),
    ('station_profiles_enabled_idx'),
    ('station_profiles_registered_at_idx'),
    ('idx_shift_handoffs_station_created_at'),
    ('idx_attendance_logs_station_check_in'),
    ('idx_attendance_logs_officer_check_in'),
    ('idx_attendance_logs_station_open_shift')
  ) as i(index_name)
)
select
  ei.index_name,
  case when c.oid is not null then 'OK' else 'MISSING' end as index_exists
from expected_indexes ei
left join pg_class c
  on c.relname = ei.index_name
 and c.relnamespace = 'public'::regnamespace
order by ei.index_name;

with expected_policies as (
  select *
  from (values
    ('station_officer_authorizations', 'station_officer_authorizations_select_authenticated'),
    ('station_officer_authorizations', 'station_officer_authorizations_insert_authenticated'),
    ('station_officer_authorizations', 'station_officer_authorizations_update_authenticated'),
    ('station_officer_authorizations', 'station_officer_authorizations_delete_authenticated'),
    ('station_profiles', 'station_profiles_select_active_users'),
    ('station_profiles', 'station_profiles_l4_insert'),
    ('station_profiles', 'station_profiles_l4_update'),
    ('shift_handoffs', 'shift_handoffs_select_manager'),
    ('shift_handoffs', 'shift_handoffs_insert_manager'),
    ('attendance_logs', 'attendance_logs_select_authenticated'),
    ('attendance_logs', 'attendance_logs_insert_authenticated'),
    ('attendance_logs', 'attendance_logs_update_authenticated')
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
  count(*) filter (where oc.is_active = true) as active_catalog_posts,
  count(sp.id) as registered_station_profiles,
  count(*) filter (where oc.is_active = true and sp.id is null) as active_posts_missing_profile,
  count(*) filter (where oc.is_active = true and sp.id is not null and sp.is_enabled = false) as active_posts_paused_in_l1
from public.operation_catalog oc
left join public.station_profiles sp
  on sp.operation_catalog_id = oc.id;

select
  count(*) as total_authorizations,
  count(*) filter (where is_active = true) as active_authorizations,
  count(*) filter (where valid_to is not null and valid_to < timezone('utc', now())) as expired_authorizations
from public.station_officer_authorizations;

select
  count(*) as open_shifts,
  count(distinct station_label) as open_shift_stations,
  count(distinct officer_user_id) as officers_with_open_shift
from public.attendance_logs
where check_out_at is null;

select
  oc.operation_name,
  oc.client_name as post_name,
  sp.is_enabled,
  sp.device_label,
  sp.updated_at
from public.operation_catalog oc
left join public.station_profiles sp
  on sp.operation_catalog_id = oc.id
where oc.is_active = true
order by oc.operation_name, oc.client_name
limit 50;