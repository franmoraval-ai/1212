-- Bootstrap mínimo para ambientes parciales.
-- Objetivo: crear las tablas/columnas mínimas esperadas por harden_access_policies.sql
-- sin reabrir permisos ni depender de que el esquema completo ya exista.

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  first_name text,
  role_level int default 1,
  status text default 'active',
  custom_permissions text[] default '{}'::text[],
  is_online boolean default false,
  last_seen timestamptz,
  assigned text,
  display_name text,
  created_at timestamptz default now()
);

alter table public.users add column if not exists email text;
alter table public.users add column if not exists first_name text;
alter table public.users add column if not exists role_level int default 1;
alter table public.users add column if not exists status text default 'active';
alter table public.users add column if not exists custom_permissions text[] default '{}'::text[];
alter table public.users add column if not exists is_online boolean default false;
alter table public.users add column if not exists last_seen timestamptz;
alter table public.users add column if not exists assigned text;
alter table public.users add column if not exists display_name text;
alter table public.users add column if not exists created_at timestamptz default now();

create table if not exists public.supervisions (
  id uuid primary key default gen_random_uuid(),
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
  created_at timestamptz default now()
);

alter table public.supervisions add column if not exists operation_name text;
alter table public.supervisions add column if not exists officer_name text;
alter table public.supervisions add column if not exists type text;
alter table public.supervisions add column if not exists id_number text;
alter table public.supervisions add column if not exists weapon_model text;
alter table public.supervisions add column if not exists weapon_serial text;
alter table public.supervisions add column if not exists review_post text;
alter table public.supervisions add column if not exists lugar text;
alter table public.supervisions add column if not exists gps jsonb;
alter table public.supervisions add column if not exists checklist jsonb;
alter table public.supervisions add column if not exists checklist_reasons jsonb;
alter table public.supervisions add column if not exists property_details jsonb;
alter table public.supervisions add column if not exists observations text;
alter table public.supervisions add column if not exists photos jsonb;
alter table public.supervisions add column if not exists supervisor_id text;
alter table public.supervisions add column if not exists status text;
alter table public.supervisions add column if not exists created_at timestamptz default now();

create table if not exists public.management_audits (
  id uuid primary key default gen_random_uuid(),
  operation_name text,
  officer_name text,
  officer_id text,
  post_name text,
  findings text,
  action_plan text,
  manager_id text,
  created_at timestamptz default now()
);

alter table public.management_audits add column if not exists operation_name text;
alter table public.management_audits add column if not exists officer_name text;
alter table public.management_audits add column if not exists officer_id text;
alter table public.management_audits add column if not exists post_name text;
alter table public.management_audits add column if not exists findings text;
alter table public.management_audits add column if not exists action_plan text;
alter table public.management_audits add column if not exists manager_id text;
alter table public.management_audits add column if not exists created_at timestamptz default now();

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  title text,
  description text,
  incident_type text,
  location text,
  lugar text,
  time timestamptz,
  priority_level text,
  reasoning text,
  reported_by text,
  reported_by_user_id text,
  reported_by_email text,
  status text,
  created_at timestamptz default now()
);

alter table public.incidents add column if not exists title text;
alter table public.incidents add column if not exists description text;
alter table public.incidents add column if not exists incident_type text;
alter table public.incidents add column if not exists location text;
alter table public.incidents add column if not exists lugar text;
alter table public.incidents add column if not exists time timestamptz;
alter table public.incidents add column if not exists priority_level text;
alter table public.incidents add column if not exists reasoning text;
alter table public.incidents add column if not exists reported_by text;
alter table public.incidents add column if not exists reported_by_user_id text;
alter table public.incidents add column if not exists reported_by_email text;
alter table public.incidents add column if not exists status text;
alter table public.incidents add column if not exists created_at timestamptz default now();

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  name text,
  post text,
  status text,
  frequency text,
  lng float,
  lat float,
  checkpoints jsonb,
  operation_id text,
  puesto_base text,
  instructions text,
  created_at timestamptz default now()
);

alter table public.rounds add column if not exists name text;
alter table public.rounds add column if not exists post text;
alter table public.rounds add column if not exists status text;
alter table public.rounds add column if not exists frequency text;
alter table public.rounds add column if not exists lng float;
alter table public.rounds add column if not exists lat float;
alter table public.rounds add column if not exists checkpoints jsonb;
alter table public.rounds add column if not exists operation_id text;
alter table public.rounds add column if not exists puesto_base text;
alter table public.rounds add column if not exists instructions text;
alter table public.rounds add column if not exists created_at timestamptz default now();

create table if not exists public.round_security_config (
  id text primary key,
  geofence_radius_meters int not null default 50,
  no_scan_gap_minutes int not null default 10,
  max_jump_meters int not null default 120,
  updated_by text,
  updated_at timestamptz default now()
);

alter table public.round_security_config add column if not exists geofence_radius_meters int not null default 50;
alter table public.round_security_config add column if not exists no_scan_gap_minutes int not null default 10;
alter table public.round_security_config add column if not exists max_jump_meters int not null default 120;
alter table public.round_security_config add column if not exists updated_by text;
alter table public.round_security_config add column if not exists updated_at timestamptz default now();

create table if not exists public.puestos (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region text,
  province text,
  lng float,
  lat float,
  jefe_puesto text,
  phone text,
  visitas_count int default 0,
  estado text default 'Activo',
  tipo text default 'Puesto',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.puestos add column if not exists name text;
alter table public.puestos add column if not exists region text;
alter table public.puestos add column if not exists province text;
alter table public.puestos add column if not exists lng float;
alter table public.puestos add column if not exists lat float;
alter table public.puestos add column if not exists jefe_puesto text;
alter table public.puestos add column if not exists phone text;
alter table public.puestos add column if not exists visitas_count int default 0;
alter table public.puestos add column if not exists estado text default 'Activo';
alter table public.puestos add column if not exists tipo text default 'Puesto';
alter table public.puestos add column if not exists created_at timestamptz default now();
alter table public.puestos add column if not exists updated_at timestamptz default now();

create table if not exists public.visitas_puestos (
  id uuid primary key default gen_random_uuid(),
  puesto_id uuid,
  officer_name text,
  officer_id text,
  entrada timestamptz default now(),
  salida timestamptz,
  motivo text,
  observaciones text,
  created_at timestamptz default now()
);

alter table public.visitas_puestos add column if not exists puesto_id uuid;
alter table public.visitas_puestos add column if not exists officer_name text;
alter table public.visitas_puestos add column if not exists officer_id text;
alter table public.visitas_puestos add column if not exists entrada timestamptz default now();
alter table public.visitas_puestos add column if not exists salida timestamptz;
alter table public.visitas_puestos add column if not exists motivo text;
alter table public.visitas_puestos add column if not exists observaciones text;
alter table public.visitas_puestos add column if not exists created_at timestamptz default now();

create table if not exists public.weapons (
  id uuid primary key default gen_random_uuid(),
  serial text,
  model text,
  type text,
  status text,
  assigned_to text,
  ammo_count integer default 0,
  location jsonb,
  last_check timestamptz,
  created_at timestamptz default now()
);

alter table public.weapons add column if not exists serial text;
alter table public.weapons add column if not exists model text;
alter table public.weapons add column if not exists type text;
alter table public.weapons add column if not exists status text;
alter table public.weapons add column if not exists assigned_to text;
alter table public.weapons add column if not exists ammo_count integer default 0;
alter table public.weapons add column if not exists location jsonb;
alter table public.weapons add column if not exists last_check timestamptz;
alter table public.weapons add column if not exists created_at timestamptz default now();

create table if not exists public.weapon_control_logs (
  id uuid primary key default gen_random_uuid(),
  weapon_id uuid,
  weapon_serial text,
  weapon_model text,
  changed_by_user_id text,
  changed_by_email text,
  changed_by_name text,
  reason text,
  previous_data jsonb,
  new_data jsonb,
  created_at timestamptz default now()
);

alter table public.weapon_control_logs add column if not exists weapon_id uuid;
alter table public.weapon_control_logs add column if not exists weapon_serial text;
alter table public.weapon_control_logs add column if not exists weapon_model text;
alter table public.weapon_control_logs add column if not exists changed_by_user_id text;
alter table public.weapon_control_logs add column if not exists changed_by_email text;
alter table public.weapon_control_logs add column if not exists changed_by_name text;
alter table public.weapon_control_logs add column if not exists reason text;
alter table public.weapon_control_logs add column if not exists previous_data jsonb;
alter table public.weapon_control_logs add column if not exists new_data jsonb;
alter table public.weapon_control_logs add column if not exists created_at timestamptz default now();

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  type text,
  message text,
  user_id text,
  user_email text,
  location jsonb,
  created_at timestamptz default now()
);

alter table public.alerts add column if not exists type text;
alter table public.alerts add column if not exists message text;
alter table public.alerts add column if not exists user_id text;
alter table public.alerts add column if not exists user_email text;
alter table public.alerts add column if not exists location jsonb;
alter table public.alerts add column if not exists created_at timestamptz default now();

create table if not exists public.visitors (
  id uuid primary key default gen_random_uuid(),
  name text,
  document_id text,
  visited_person text,
  destination text,
  post text,
  status text,
  entry_time timestamptz default now(),
  exit_time timestamptz,
  created_at timestamptz default now()
);

alter table public.visitors add column if not exists name text;
alter table public.visitors add column if not exists document_id text;
alter table public.visitors add column if not exists visited_person text;
alter table public.visitors add column if not exists destination text;
alter table public.visitors add column if not exists post text;
alter table public.visitors add column if not exists status text;
alter table public.visitors add column if not exists entry_time timestamptz default now();
alter table public.visitors add column if not exists exit_time timestamptz;
alter table public.visitors add column if not exists created_at timestamptz default now();

create table if not exists public.round_reports (
  id uuid primary key default gen_random_uuid(),
  round_id text,
  round_name text,
  post_name text,
  officer_id text,
  officer_name text,
  supervisor_name text,
  started_at timestamptz,
  ended_at timestamptz,
  status text,
  checkpoints_total int default 0,
  checkpoints_completed int default 0,
  checkpoint_logs jsonb,
  notes text,
  created_at timestamptz default now()
);

alter table public.round_reports add column if not exists round_id text;
alter table public.round_reports add column if not exists round_name text;
alter table public.round_reports add column if not exists post_name text;
alter table public.round_reports add column if not exists officer_id text;
alter table public.round_reports add column if not exists officer_name text;
alter table public.round_reports add column if not exists supervisor_name text;
alter table public.round_reports add column if not exists started_at timestamptz;
alter table public.round_reports add column if not exists ended_at timestamptz;
alter table public.round_reports add column if not exists status text;
alter table public.round_reports add column if not exists checkpoints_total int default 0;
alter table public.round_reports add column if not exists checkpoints_completed int default 0;
alter table public.round_reports add column if not exists checkpoint_logs jsonb;
alter table public.round_reports add column if not exists notes text;
alter table public.round_reports add column if not exists created_at timestamptz default now();

create table if not exists public.internal_notes (
  id uuid primary key default gen_random_uuid(),
  post_name text,
  category text,
  priority text,
  detail text,
  status text default 'abierta',
  reported_by_user_id text,
  reported_by_name text,
  reported_by_email text,
  assigned_to text,
  resolution_note text,
  resolved_at timestamptz,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

alter table public.internal_notes add column if not exists post_name text;
alter table public.internal_notes add column if not exists category text;
alter table public.internal_notes add column if not exists priority text;
alter table public.internal_notes add column if not exists detail text;
alter table public.internal_notes add column if not exists status text default 'abierta';
alter table public.internal_notes add column if not exists reported_by_user_id text;
alter table public.internal_notes add column if not exists reported_by_name text;
alter table public.internal_notes add column if not exists reported_by_email text;
alter table public.internal_notes add column if not exists assigned_to text;
alter table public.internal_notes add column if not exists resolution_note text;
alter table public.internal_notes add column if not exists resolved_at timestamptz;
alter table public.internal_notes add column if not exists updated_at timestamptz default now();
alter table public.internal_notes add column if not exists created_at timestamptz default now();

create table if not exists public.round_sessions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid,
  round_name text,
  post_name text,
  officer_id text,
  officer_name text,
  supervisor_id text,
  status text default 'in_progress',
  started_at timestamptz,
  ended_at timestamptz,
  expected_end_at timestamptz,
  checkpoints_total int default 0,
  checkpoints_completed int default 0,
  last_scan_at timestamptz,
  last_location jsonb,
  fraud_score int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.round_sessions add column if not exists round_id uuid;
alter table public.round_sessions add column if not exists round_name text;
alter table public.round_sessions add column if not exists post_name text;
alter table public.round_sessions add column if not exists officer_id text;
alter table public.round_sessions add column if not exists officer_name text;
alter table public.round_sessions add column if not exists supervisor_id text;
alter table public.round_sessions add column if not exists status text default 'in_progress';
alter table public.round_sessions add column if not exists started_at timestamptz;
alter table public.round_sessions add column if not exists ended_at timestamptz;
alter table public.round_sessions add column if not exists expected_end_at timestamptz;
alter table public.round_sessions add column if not exists checkpoints_total int default 0;
alter table public.round_sessions add column if not exists checkpoints_completed int default 0;
alter table public.round_sessions add column if not exists last_scan_at timestamptz;
alter table public.round_sessions add column if not exists last_location jsonb;
alter table public.round_sessions add column if not exists fraud_score int default 0;
alter table public.round_sessions add column if not exists created_at timestamptz default now();
alter table public.round_sessions add column if not exists updated_at timestamptz default now();

create table if not exists public.round_checkpoint_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid,
  round_id uuid,
  checkpoint_id text,
  checkpoint_name text,
  event_type text,
  token_hash text,
  lat double precision,
  lng double precision,
  accuracy_meters double precision,
  distance_to_target_meters double precision,
  inside_geofence boolean,
  fraud_flag text,
  captured_at timestamptz default now(),
  created_at timestamptz default now()
);

alter table public.round_checkpoint_events add column if not exists session_id uuid;
alter table public.round_checkpoint_events add column if not exists round_id uuid;
alter table public.round_checkpoint_events add column if not exists checkpoint_id text;
alter table public.round_checkpoint_events add column if not exists checkpoint_name text;
alter table public.round_checkpoint_events add column if not exists event_type text;
alter table public.round_checkpoint_events add column if not exists token_hash text;
alter table public.round_checkpoint_events add column if not exists lat double precision;
alter table public.round_checkpoint_events add column if not exists lng double precision;
alter table public.round_checkpoint_events add column if not exists accuracy_meters double precision;
alter table public.round_checkpoint_events add column if not exists distance_to_target_meters double precision;
alter table public.round_checkpoint_events add column if not exists inside_geofence boolean;
alter table public.round_checkpoint_events add column if not exists fraud_flag text;
alter table public.round_checkpoint_events add column if not exists captured_at timestamptz default now();
alter table public.round_checkpoint_events add column if not exists created_at timestamptz default now();

create index if not exists idx_users_email on public.users (lower(email));
create index if not exists idx_round_reports_officer_id on public.round_reports (officer_id);
create index if not exists idx_round_sessions_officer_id on public.round_sessions (officer_id);
create index if not exists idx_round_checkpoint_events_session_id on public.round_checkpoint_events (session_id);
create index if not exists idx_internal_notes_reported_by on public.internal_notes (reported_by_user_id, reported_by_email);
create index if not exists idx_visitas_puestos_officer_id on public.visitas_puestos (officer_id);

-- Ejecutar después: supabase/harden_access_policies.sql