-- Verificación rápida del Centro de Datos.

with expected_tables as (
  select *
  from (values
    ('data_export_jobs'),
    ('data_archive_runs'),
    ('data_restore_runs'),
    ('archived_supervisions'),
    ('archived_round_reports'),
    ('archived_incidents'),
    ('archived_internal_notes'),
    ('archived_visitors'),
    ('archived_weapons')
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

with expected_policies as (
  select *
  from (values
    ('data_export_jobs', 'data_export_jobs_select_scoped'),
    ('data_export_jobs', 'data_export_jobs_insert_manager'),
    ('data_export_jobs', 'data_export_jobs_update_manager'),
    ('data_export_jobs', 'data_export_jobs_delete_director'),
    ('data_archive_runs', 'data_archive_runs_select_manager'),
    ('data_archive_runs', 'data_archive_runs_insert_manager'),
    ('data_archive_runs', 'data_archive_runs_update_manager'),
    ('data_archive_runs', 'data_archive_runs_delete_director'),
    ('data_restore_runs', 'data_restore_runs_select_manager'),
    ('data_restore_runs', 'data_restore_runs_insert_manager'),
    ('data_restore_runs', 'data_restore_runs_update_manager'),
    ('data_restore_runs', 'data_restore_runs_delete_director'),
    ('archived_supervisions', 'archived_supervisions_select_manager'),
    ('archived_round_reports', 'archived_round_reports_select_manager'),
    ('archived_incidents', 'archived_incidents_select_manager'),
    ('archived_internal_notes', 'archived_internal_notes_select_manager'),
    ('archived_visitors', 'archived_visitors_select_manager'),
    ('archived_weapons', 'archived_weapons_select_manager')
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
  id,
  entity_type,
  status,
  row_count,
  file_name,
  created_at,
  completed_at
from public.data_export_jobs
order by created_at desc
limit 10;

select
  id,
  entity_type,
  cutoff_date,
  dry_run,
  status,
  matched_count,
  archived_count,
  deleted_count,
  created_at,
  completed_at
from public.data_archive_runs
order by created_at desc
limit 10;

select
  id,
  source_run_id,
  entity_type,
  dry_run,
  status,
  matched_count,
  restored_count,
  removed_from_archive_count,
  created_at,
  completed_at
from public.data_restore_runs
order by created_at desc
limit 10;