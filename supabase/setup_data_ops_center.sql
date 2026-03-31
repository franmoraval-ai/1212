-- Fase 1 + Fase 2 para Centro de Datos.
-- Ejecutar en Supabase SQL Editor despues de bootstrap/hardening general.

create extension if not exists pgcrypto;

create table if not exists public.data_export_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by_uid text not null,
  requested_by_email text not null,
  entity_type text not null,
  data_source text not null default 'live',
  export_format text not null default 'csv',
  filters jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  row_count int not null default 0,
  file_name text,
  error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_data_export_jobs_created_at on public.data_export_jobs (created_at desc);
create index if not exists idx_data_export_jobs_requested_by on public.data_export_jobs (requested_by_uid, created_at desc);

create table if not exists public.data_archive_runs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  cutoff_date date not null,
  dry_run boolean not null default true,
  batch_size int not null default 500,
  status text not null default 'pending',
  matched_count int not null default 0,
  archived_count int not null default 0,
  deleted_count int not null default 0,
  requested_by_uid text not null,
  requested_by_email text not null,
  error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_data_archive_runs_created_at on public.data_archive_runs (created_at desc);

create table if not exists public.data_restore_runs (
  id uuid primary key default gen_random_uuid(),
  source_run_id uuid not null references public.data_archive_runs(id) on delete cascade,
  entity_type text not null,
  dry_run boolean not null default true,
  batch_size int not null default 500,
  status text not null default 'pending',
  matched_count int not null default 0,
  restored_count int not null default 0,
  removed_from_archive_count int not null default 0,
  requested_by_uid text not null,
  requested_by_email text not null,
  error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_data_restore_runs_created_at on public.data_restore_runs (created_at desc);
create index if not exists idx_data_restore_runs_source_run on public.data_restore_runs (source_run_id, created_at desc);

create table if not exists public.archived_supervisions (
  id uuid primary key default gen_random_uuid(),
  original_id uuid not null unique,
  archive_run_id uuid references public.data_archive_runs(id) on delete set null,
  archived_at timestamptz not null default now(),
  archived_by text,
  operation_name text,
  officer_name text,
  type text,
  id_number text,
  weapon_model text,
  weapon_serial text,
  review_post text,
  lugar text,
  gps jsonb,
  checklist jsonb,
  checklist_reasons jsonb,
  property_details jsonb,
  observations text,
  photos jsonb,
  supervisor_id text,
  status text,
  created_at timestamptz
);

create index if not exists idx_archived_supervisions_created_at on public.archived_supervisions (created_at desc);
create index if not exists idx_archived_supervisions_archived_at on public.archived_supervisions (archived_at desc);

create table if not exists public.archived_round_reports (
  id uuid primary key default gen_random_uuid(),
  original_id uuid not null unique,
  archive_run_id uuid references public.data_archive_runs(id) on delete set null,
  archived_at timestamptz not null default now(),
  archived_by text,
  round_id text,
  round_name text,
  post_name text,
  officer_id text,
  officer_name text,
  supervisor_name text,
  started_at timestamptz,
  ended_at timestamptz,
  status text,
  checkpoints_total int,
  checkpoints_completed int,
  checkpoint_logs jsonb,
  notes text,
  created_at timestamptz
);

create index if not exists idx_archived_round_reports_created_at on public.archived_round_reports (created_at desc);
create index if not exists idx_archived_round_reports_archived_at on public.archived_round_reports (archived_at desc);

create table if not exists public.archived_incidents (
  id uuid primary key default gen_random_uuid(),
  original_id uuid not null unique,
  archive_run_id uuid references public.data_archive_runs(id) on delete set null,
  archived_at timestamptz not null default now(),
  archived_by text,
  title text,
  description text,
  incident_type text,
  location text,
  lugar text,
  time timestamptz,
  priority_level text,
  reasoning text,
  reported_by text,
  status text,
  created_at timestamptz
);

create index if not exists idx_archived_incidents_created_at on public.archived_incidents (created_at desc);
create index if not exists idx_archived_incidents_archived_at on public.archived_incidents (archived_at desc);

create table if not exists public.archived_internal_notes (
  id uuid primary key default gen_random_uuid(),
  original_id uuid not null unique,
  archive_run_id uuid references public.data_archive_runs(id) on delete set null,
  archived_at timestamptz not null default now(),
  archived_by text,
  post_name text,
  category text,
  priority text,
  detail text,
  status text,
  reported_by_user_id text,
  reported_by_name text,
  reported_by_email text,
  assigned_to text,
  resolution_note text,
  resolved_at timestamptz,
  updated_at timestamptz,
  created_at timestamptz
);

create index if not exists idx_archived_internal_notes_created_at on public.archived_internal_notes (created_at desc);
create index if not exists idx_archived_internal_notes_archived_at on public.archived_internal_notes (archived_at desc);

create table if not exists public.archived_visitors (
  id uuid primary key default gen_random_uuid(),
  original_id uuid not null unique,
  archive_run_id uuid references public.data_archive_runs(id) on delete set null,
  archived_at timestamptz not null default now(),
  archived_by text,
  name text,
  document_id text,
  visited_person text,
  destination text,
  post text,
  status text,
  entry_time timestamptz,
  exit_time timestamptz,
  created_at timestamptz
);

create index if not exists idx_archived_visitors_created_at on public.archived_visitors (created_at desc);
create index if not exists idx_archived_visitors_archived_at on public.archived_visitors (archived_at desc);

create table if not exists public.archived_weapons (
  id uuid primary key default gen_random_uuid(),
  original_id uuid not null unique,
  archive_run_id uuid references public.data_archive_runs(id) on delete set null,
  archived_at timestamptz not null default now(),
  archived_by text,
  serial text,
  model text,
  type text,
  status text,
  assigned_to text,
  ammo_count integer,
  location jsonb,
  last_check timestamptz,
  created_at timestamptz
);

create index if not exists idx_archived_weapons_created_at on public.archived_weapons (created_at desc);
create index if not exists idx_archived_weapons_archived_at on public.archived_weapons (archived_at desc);

alter table public.data_export_jobs enable row level security;
alter table public.data_archive_runs enable row level security;
alter table public.data_restore_runs enable row level security;
alter table public.archived_supervisions enable row level security;
alter table public.archived_round_reports enable row level security;
alter table public.archived_incidents enable row level security;
alter table public.archived_internal_notes enable row level security;
alter table public.archived_visitors enable row level security;
alter table public.archived_weapons enable row level security;

drop policy if exists data_export_jobs_select_scoped on public.data_export_jobs;
drop policy if exists data_export_jobs_insert_manager on public.data_export_jobs;
drop policy if exists data_export_jobs_update_manager on public.data_export_jobs;
drop policy if exists data_export_jobs_delete_director on public.data_export_jobs;

create policy data_export_jobs_select_scoped on public.data_export_jobs
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_has_permission('data_ops_manage')
    or public.app_matches_current_user(requested_by_uid)
    or public.app_matches_current_user(requested_by_email)
  )
);

create policy data_export_jobs_insert_manager on public.data_export_jobs
for insert to authenticated
with check (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
);

create policy data_export_jobs_update_manager on public.data_export_jobs
for update to authenticated
using (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
)
with check (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
);

create policy data_export_jobs_delete_director on public.data_export_jobs
for delete to authenticated
using (public.app_is_active_user() and public.app_is_role(4));

drop policy if exists data_archive_runs_select_manager on public.data_archive_runs;
drop policy if exists data_archive_runs_insert_manager on public.data_archive_runs;
drop policy if exists data_archive_runs_update_manager on public.data_archive_runs;
drop policy if exists data_archive_runs_delete_director on public.data_archive_runs;

create policy data_archive_runs_select_manager on public.data_archive_runs
for select to authenticated
using (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
);

create policy data_archive_runs_insert_manager on public.data_archive_runs
for insert to authenticated
with check (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
);

create policy data_archive_runs_update_manager on public.data_archive_runs
for update to authenticated
using (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
)
with check (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
);

create policy data_archive_runs_delete_director on public.data_archive_runs
for delete to authenticated
using (public.app_is_active_user() and public.app_is_role(4));

drop policy if exists data_restore_runs_select_manager on public.data_restore_runs;
drop policy if exists data_restore_runs_insert_manager on public.data_restore_runs;
drop policy if exists data_restore_runs_update_manager on public.data_restore_runs;
drop policy if exists data_restore_runs_delete_director on public.data_restore_runs;

create policy data_restore_runs_select_manager on public.data_restore_runs
for select to authenticated
using (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
);

create policy data_restore_runs_insert_manager on public.data_restore_runs
for insert to authenticated
with check (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
);

create policy data_restore_runs_update_manager on public.data_restore_runs
for update to authenticated
using (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
)
with check (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
);

create policy data_restore_runs_delete_director on public.data_restore_runs
for delete to authenticated
using (public.app_is_active_user() and public.app_is_role(4));

drop policy if exists archived_supervisions_select_manager on public.archived_supervisions;
drop policy if exists archived_round_reports_select_manager on public.archived_round_reports;
drop policy if exists archived_incidents_select_manager on public.archived_incidents;

create policy archived_supervisions_select_manager on public.archived_supervisions
for select to authenticated
using (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
);

create policy archived_round_reports_select_manager on public.archived_round_reports
for select to authenticated
using (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
);

create policy archived_incidents_select_manager on public.archived_incidents
for select to authenticated
using (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
);

drop policy if exists archived_internal_notes_select_manager on public.archived_internal_notes;
drop policy if exists archived_visitors_select_manager on public.archived_visitors;
drop policy if exists archived_weapons_select_manager on public.archived_weapons;

create policy archived_internal_notes_select_manager on public.archived_internal_notes
for select to authenticated
using (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
);

create policy archived_visitors_select_manager on public.archived_visitors
for select to authenticated
using (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
);

create policy archived_weapons_select_manager on public.archived_weapons
for select to authenticated
using (
  public.app_is_active_user()
  and (public.app_is_role(4) or public.app_has_permission('data_ops_manage'))
);
