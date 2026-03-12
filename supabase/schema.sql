-- Ejecutar en Supabase: SQL Editor → New query → Pegar y Run
-- Crea las tablas necesarias para la app HO Seguridad

-- Habilitar auth anónimo (en Dashboard: Authentication → Providers → Anonymous: Enable)

-- Tablas (nombres en minúsculas para Supabase; la app usa useCollection con estos nombres)
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  first_name text,
  role_level int default 4,
  status text default 'active',
  custom_permissions text[] default '{}'::text[],
  is_online boolean default false,
  last_seen timestamptz,
  assigned text,
  display_name text,
  created_at timestamptz default now()
);

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

create table if not exists public.management_audits (
  id uuid primary key default gen_random_uuid(),
  operation_name text,
  officer_name text,
  officer_id text,
  post_name text,
  officer_evaluation jsonb,
  post_evaluation jsonb,
  administrative_compliance jsonb,
  findings text,
  action_plan text,
  manager_id text,
  created_at timestamptz default now()
);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  title text,
  description text,
  incident_type text,
  location text,
  "time" timestamptz,
  priority_level text,
  reasoning text,
  reported_by text,
  status text,
  created_at timestamptz default now()
);

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

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  type text,
  message text,
  user_id text,
  user_email text,
  location jsonb,
  created_at timestamptz default now()
);

create table if not exists public.visitors (
  id uuid primary key default gen_random_uuid(),
  name text,
  document_id text,
  visited_person text,
  entry_time timestamptz default now(),
  exit_time timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.round_reports (
  id uuid primary key default gen_random_uuid(),
  round_id text,
  round_name text,
  post_name text,
  officer_id text,
  officer_name text,
  started_at timestamptz,
  ended_at timestamptz,
  status text,
  checkpoints_total int default 0,
  checkpoints_completed int default 0,
  checkpoint_logs jsonb,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.round_sessions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null,
  round_name text,
  post_name text,
  officer_id text not null,
  officer_name text,
  supervisor_id text,
  status text not null default 'in_progress',
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

create table if not exists public.round_checkpoint_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  round_id uuid not null,
  checkpoint_id text not null,
  checkpoint_name text,
  event_type text not null,
  token_hash text,
  lat double precision,
  lng double precision,
  accuracy_meters double precision,
  distance_to_target_meters double precision,
  inside_geofence boolean,
  fraud_flag text,
  captured_at timestamptz not null default now(),
  created_at timestamptz default now()
);

create index if not exists idx_round_sessions_status_started
  on public.round_sessions (status, started_at desc);

create index if not exists idx_round_sessions_officer_started
  on public.round_sessions (officer_id, started_at desc);

create index if not exists idx_round_sessions_round_created
  on public.round_sessions (round_id, created_at desc);

create index if not exists idx_round_checkpoint_events_session_captured
  on public.round_checkpoint_events (session_id, captured_at);

create index if not exists idx_round_checkpoint_events_round_captured
  on public.round_checkpoint_events (round_id, captured_at desc);

create index if not exists idx_round_checkpoint_events_fraud_created
  on public.round_checkpoint_events (fraud_flag, created_at desc)
  where fraud_flag is not null;

-- Guard anti-duplicados: evita dobles envios muy cercanos de la misma supervision.
create or replace function public.prevent_duplicate_supervisions()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.supervisions s
    where s.id <> new.id
      and coalesce(lower(trim(s.supervisor_id)), '') = coalesce(lower(trim(new.supervisor_id)), '')
      and coalesce(lower(trim(s.operation_name)), '') = coalesce(lower(trim(new.operation_name)), '')
      and coalesce(lower(trim(s.officer_name)), '') = coalesce(lower(trim(new.officer_name)), '')
      and coalesce(lower(trim(s.type)), '') = coalesce(lower(trim(new.type)), '')
      and coalesce(lower(trim(s.review_post)), '') = coalesce(lower(trim(new.review_post)), '')
      and abs(extract(epoch from (coalesce(s.created_at, now()) - coalesce(new.created_at, now())))) <= 90
  ) then
    raise exception using
      errcode = '23505',
      message = 'duplicate supervision submission detected';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_duplicate_supervisions on public.supervisions;
create trigger trg_prevent_duplicate_supervisions
before insert on public.supervisions
for each row
execute function public.prevent_duplicate_supervisions();

-- RLS: permitir todo a usuarios autenticados (anon o email)
alter table public.users enable row level security;
alter table public.supervisions enable row level security;
alter table public.management_audits enable row level security;
alter table public.incidents enable row level security;
alter table public.rounds enable row level security;
alter table public.weapons enable row level security;
alter table public.weapon_control_logs enable row level security;
alter table public.alerts enable row level security;
alter table public.visitors enable row level security;
alter table public.round_reports enable row level security;
alter table public.round_sessions enable row level security;
alter table public.round_checkpoint_events enable row level security;

create policy "Allow all for authenticated" on public.users for all to authenticated using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
create policy "Allow all for authenticated" on public.supervisions for all to authenticated using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
create policy "Allow all for authenticated" on public.management_audits for all to authenticated using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
create policy "Allow all for authenticated" on public.incidents for all to authenticated using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
create policy "Allow all for authenticated" on public.rounds for all to authenticated using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
create policy "Allow all for authenticated" on public.weapons for all to authenticated using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
create policy "Allow all for authenticated" on public.weapon_control_logs for all to authenticated using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
create policy "Allow all for authenticated" on public.alerts for all to authenticated using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
create policy "Allow all for authenticated" on public.visitors for all to authenticated using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
create policy "Allow all for authenticated" on public.round_reports for all to authenticated using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
create policy "Allow all for authenticated" on public.round_sessions for all to authenticated using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
create policy "Allow all for authenticated" on public.round_checkpoint_events for all to authenticated using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
