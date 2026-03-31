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
  lugar text,
  "time" timestamptz,
  priority_level text,
  reasoning text,
  reported_by text,
  reported_by_user_id text,
  reported_by_email text,
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

-- Helpers de autorización para RLS.
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
    select u.role_level
    from public.users u
    where lower(coalesce(u.email, '')) = public.app_current_email()
    limit 1
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
    select u.custom_permissions
    from public.users u
    where lower(coalesce(u.email, '')) = public.app_current_email()
    limit 1
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
    select u.status
    from public.users u
    where lower(coalesce(u.email, '')) = public.app_current_email()
    limit 1
  ), 'active')));
$$;

create or replace function public.app_is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select auth.role()) = 'authenticated'
    and public.app_current_status() in ('active', 'activo');
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
      coalesce((
        select u.assigned
        from public.users u
        where lower(coalesce(u.email, '')) = public.app_current_email()
        limit 1
      ), ''),
      '[|,;]+'
    ) as token
    where nullif(trim(token), '') is not null
      and lower(coalesce(value, '')) like '%' || lower(trim(token)) || '%'
  );
$$;

create or replace function public.app_can_access_round_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_is_active_user()
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
$$;

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
alter table public.internal_notes enable row level security;
alter table public.round_sessions enable row level security;
alter table public.round_checkpoint_events enable row level security;

drop policy if exists "Allow all for authenticated" on public.users;
drop policy if exists users_select_scoped on public.users;
drop policy if exists users_update_director on public.users;
drop policy if exists users_delete_director on public.users;
create policy users_select_scoped on public.users
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_has_permission('personnel_view')
    or lower(coalesce(email, '')) = public.app_current_email()
  )
);
create policy users_update_director on public.users
for update to authenticated
using (public.app_is_active_user() and public.app_is_role(4))
with check (public.app_is_active_user() and public.app_is_role(4));
create policy users_delete_director on public.users
for delete to authenticated
using (public.app_is_active_user() and public.app_is_role(4));

drop policy if exists "Allow all for authenticated" on public.supervisions;
drop policy if exists supervisions_select_scoped on public.supervisions;
drop policy if exists supervisions_insert_owner on public.supervisions;
drop policy if exists supervisions_update_owner_or_director on public.supervisions;
drop policy if exists supervisions_delete_owner_or_director on public.supervisions;
create policy supervisions_select_scoped on public.supervisions
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_has_permission('supervision_grouped_view')
    or public.app_matches_current_user(supervisor_id)
    or public.app_matches_assigned_scope(review_post)
    or public.app_matches_assigned_scope(operation_name)
  )
);
create policy supervisions_insert_owner on public.supervisions
for insert to authenticated
with check (
  public.app_is_active_user()
  and public.app_matches_current_user(supervisor_id)
);
create policy supervisions_update_owner_or_director on public.supervisions
for update to authenticated
using (public.app_is_active_user() and (public.app_is_role(4) or public.app_matches_current_user(supervisor_id)))
with check (public.app_is_active_user() and (public.app_is_role(4) or public.app_matches_current_user(supervisor_id)));
create policy supervisions_delete_owner_or_director on public.supervisions
for delete to authenticated
using (public.app_is_active_user() and (public.app_is_role(4) or public.app_matches_current_user(supervisor_id)));

drop policy if exists "Allow all for authenticated" on public.management_audits;
drop policy if exists management_audits_select_manager on public.management_audits;
drop policy if exists management_audits_insert_manager on public.management_audits;
drop policy if exists management_audits_update_manager on public.management_audits;
drop policy if exists management_audits_delete_manager on public.management_audits;
create policy management_audits_select_manager on public.management_audits
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_matches_current_user(manager_id)
    or public.app_matches_assigned_scope(post_name)
    or public.app_matches_assigned_scope(operation_name)
  )
);
create policy management_audits_insert_manager on public.management_audits
for insert to authenticated
with check (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_matches_current_user(manager_id)
  )
);
create policy management_audits_update_manager on public.management_audits
for update to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_matches_current_user(manager_id)
    or public.app_matches_assigned_scope(post_name)
    or public.app_matches_assigned_scope(operation_name)
  )
)
with check (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_matches_current_user(manager_id)
    or public.app_matches_assigned_scope(post_name)
    or public.app_matches_assigned_scope(operation_name)
  )
);
create policy management_audits_delete_manager on public.management_audits
for delete to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_matches_current_user(manager_id)
    or public.app_matches_assigned_scope(post_name)
    or public.app_matches_assigned_scope(operation_name)
  )
);

drop policy if exists "Allow all for authenticated" on public.incidents;
drop policy if exists incidents_select_authenticated on public.incidents;
drop policy if exists incidents_insert_authenticated on public.incidents;
drop policy if exists incidents_update_supervisor on public.incidents;
drop policy if exists incidents_delete_supervisor on public.incidents;
create policy incidents_select_authenticated on public.incidents
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(3)
    or public.app_matches_current_user(reported_by_user_id)
    or public.app_matches_current_user(reported_by_email)
    or public.app_matches_assigned_scope(location)
    or public.app_matches_assigned_scope(lugar)
  )
);
create policy incidents_insert_authenticated on public.incidents
for insert to authenticated
with check (
  public.app_is_active_user()
  and (
    public.app_matches_current_user(reported_by_user_id)
    or public.app_matches_current_user(reported_by_email)
  )
);
create policy incidents_update_supervisor on public.incidents
for update to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(3)
    or (
      public.app_is_role(2)
      and (
        public.app_matches_current_user(reported_by_user_id)
        or public.app_matches_current_user(reported_by_email)
        or public.app_matches_assigned_scope(location)
        or public.app_matches_assigned_scope(lugar)
      )
    )
  )
)
with check (
  public.app_is_active_user()
  and (
    public.app_is_role(3)
    or (
      public.app_is_role(2)
      and (
        public.app_matches_current_user(reported_by_user_id)
        or public.app_matches_current_user(reported_by_email)
        or public.app_matches_assigned_scope(location)
        or public.app_matches_assigned_scope(lugar)
      )
    )
  )
);
create policy incidents_delete_supervisor on public.incidents
for delete to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(3)
    or (
      public.app_is_role(2)
      and (
        public.app_matches_current_user(reported_by_user_id)
        or public.app_matches_current_user(reported_by_email)
        or public.app_matches_assigned_scope(location)
        or public.app_matches_assigned_scope(lugar)
      )
    )
  )
);

drop policy if exists "Allow all for authenticated" on public.rounds;
drop policy if exists rounds_select_authenticated on public.rounds;
drop policy if exists rounds_insert_director on public.rounds;
drop policy if exists rounds_update_director on public.rounds;
drop policy if exists rounds_delete_director on public.rounds;
create policy rounds_select_authenticated on public.rounds
for select to authenticated
using (public.app_is_active_user());
create policy rounds_insert_director on public.rounds
for insert to authenticated
with check (public.app_is_active_user() and public.app_is_role(4));
create policy rounds_update_director on public.rounds
for update to authenticated
using (public.app_is_active_user() and public.app_is_role(4))
with check (public.app_is_active_user() and public.app_is_role(4));
create policy rounds_delete_director on public.rounds
for delete to authenticated
using (public.app_is_active_user() and public.app_is_role(4));

drop policy if exists "Allow all for authenticated" on public.weapons;
drop policy if exists weapons_select_manager on public.weapons;
drop policy if exists weapons_insert_manager on public.weapons;
drop policy if exists weapons_update_manager on public.weapons;
drop policy if exists weapons_delete_manager on public.weapons;
create policy weapons_select_manager on public.weapons
for select to authenticated
using (public.app_is_active_user() and public.app_is_role(2));
create policy weapons_insert_manager on public.weapons
for insert to authenticated
with check (public.app_is_active_user() and public.app_is_role(3));
create policy weapons_update_manager on public.weapons
for update to authenticated
using (public.app_is_active_user() and public.app_is_role(3))
with check (public.app_is_active_user() and public.app_is_role(3));
create policy weapons_delete_manager on public.weapons
for delete to authenticated
using (public.app_is_active_user() and public.app_is_role(3));

drop policy if exists "Allow all for authenticated" on public.weapon_control_logs;
drop policy if exists weapon_control_logs_select_manager on public.weapon_control_logs;
drop policy if exists weapon_control_logs_insert_manager on public.weapon_control_logs;
drop policy if exists weapon_control_logs_delete_director on public.weapon_control_logs;
create policy weapon_control_logs_select_manager on public.weapon_control_logs
for select to authenticated
using (public.app_is_active_user() and public.app_is_role(3));
create policy weapon_control_logs_insert_manager on public.weapon_control_logs
for insert to authenticated
with check (public.app_is_active_user() and public.app_is_role(3));
create policy weapon_control_logs_delete_director on public.weapon_control_logs
for delete to authenticated
using (public.app_is_active_user() and public.app_is_role(4));

drop policy if exists "Allow all for authenticated" on public.alerts;
drop policy if exists alerts_select_scoped on public.alerts;
drop policy if exists alerts_insert_authenticated on public.alerts;
drop policy if exists alerts_update_manager on public.alerts;
drop policy if exists alerts_delete_manager on public.alerts;
create policy alerts_select_scoped on public.alerts
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(2)
    or public.app_matches_current_user(user_id)
    or public.app_matches_current_user(user_email)
  )
);
create policy alerts_insert_authenticated on public.alerts
for insert to authenticated
with check (public.app_is_active_user());
create policy alerts_update_manager on public.alerts
for update to authenticated
using (public.app_is_active_user() and public.app_is_role(3))
with check (public.app_is_active_user() and public.app_is_role(3));
create policy alerts_delete_manager on public.alerts
for delete to authenticated
using (public.app_is_active_user() and public.app_is_role(3));

drop policy if exists "Allow all for authenticated" on public.visitors;
drop policy if exists visitors_select_authenticated on public.visitors;
drop policy if exists visitors_insert_supervisor on public.visitors;
drop policy if exists visitors_update_supervisor on public.visitors;
drop policy if exists visitors_delete_supervisor on public.visitors;
create policy visitors_select_authenticated on public.visitors
for select to authenticated
using (public.app_is_active_user());
create policy visitors_insert_supervisor on public.visitors
for insert to authenticated
with check (public.app_is_active_user() and public.app_is_role(2));
create policy visitors_update_supervisor on public.visitors
for update to authenticated
using (public.app_is_active_user() and public.app_is_role(2))
with check (public.app_is_active_user() and public.app_is_role(2));
create policy visitors_delete_supervisor on public.visitors
for delete to authenticated
using (public.app_is_active_user() and public.app_is_role(2));

drop policy if exists "Allow all for authenticated" on public.round_reports;
drop policy if exists round_reports_select_scoped on public.round_reports;
drop policy if exists round_reports_insert_owner on public.round_reports;
drop policy if exists round_reports_update_director on public.round_reports;
drop policy if exists round_reports_delete_director on public.round_reports;
create policy round_reports_select_scoped on public.round_reports
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_has_permission('supervision_grouped_view')
    or public.app_matches_current_user(officer_id)
    or public.app_matches_assigned_scope(post_name)
    or public.app_matches_assigned_scope(round_name)
  )
);
create policy round_reports_insert_owner on public.round_reports
for insert to authenticated
with check (
  public.app_is_active_user()
  and public.app_matches_current_user(officer_id)
);
create policy round_reports_update_director on public.round_reports
for update to authenticated
using (public.app_is_active_user() and public.app_is_role(4))
with check (public.app_is_active_user() and public.app_is_role(4));
create policy round_reports_delete_director on public.round_reports
for delete to authenticated
using (public.app_is_active_user() and public.app_is_role(4));

drop policy if exists "Allow all for authenticated" on public.internal_notes;
drop policy if exists internal_notes_select_scoped on public.internal_notes;
drop policy if exists internal_notes_insert_owner on public.internal_notes;
drop policy if exists internal_notes_update_supervisor on public.internal_notes;
drop policy if exists internal_notes_delete_supervisor on public.internal_notes;
create policy internal_notes_select_scoped on public.internal_notes
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(2)
    or public.app_matches_current_user(reported_by_user_id)
    or public.app_matches_current_user(reported_by_email)
    or public.app_matches_assigned_scope(post_name)
  )
);
create policy internal_notes_insert_owner on public.internal_notes
for insert to authenticated
with check (
  public.app_is_active_user()
  and (
    public.app_matches_current_user(reported_by_user_id)
    or public.app_matches_current_user(reported_by_email)
  )
);
create policy internal_notes_update_supervisor on public.internal_notes
for update to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(3)
    or (
      public.app_is_role(2)
      and (
        public.app_matches_current_user(reported_by_user_id)
        or public.app_matches_current_user(reported_by_email)
        or public.app_matches_assigned_scope(post_name)
      )
    )
  )
)
with check (
  public.app_is_active_user()
  and (
    public.app_is_role(3)
    or (
      public.app_is_role(2)
      and (
        public.app_matches_current_user(reported_by_user_id)
        or public.app_matches_current_user(reported_by_email)
        or public.app_matches_assigned_scope(post_name)
      )
    )
  )
);
create policy internal_notes_delete_supervisor on public.internal_notes
for delete to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(3)
    or (
      public.app_is_role(2)
      and (
        public.app_matches_current_user(reported_by_user_id)
        or public.app_matches_current_user(reported_by_email)
        or public.app_matches_assigned_scope(post_name)
      )
    )
  )
);

drop policy if exists "Allow all for authenticated" on public.round_sessions;
drop policy if exists round_sessions_select_scoped on public.round_sessions;
drop policy if exists round_sessions_insert_owner on public.round_sessions;
drop policy if exists round_sessions_update_scoped on public.round_sessions;
drop policy if exists round_sessions_delete_director on public.round_sessions;
create policy round_sessions_select_scoped on public.round_sessions
for select to authenticated
using (public.app_can_access_round_session(id));
create policy round_sessions_insert_owner on public.round_sessions
for insert to authenticated
with check (
  public.app_is_active_user()
  and public.app_matches_current_user(officer_id)
);
create policy round_sessions_update_scoped on public.round_sessions
for update to authenticated
using (public.app_can_access_round_session(id))
with check (public.app_can_access_round_session(id));
create policy round_sessions_delete_director on public.round_sessions
for delete to authenticated
using (public.app_is_active_user() and public.app_is_role(4));

drop policy if exists "Allow all for authenticated" on public.round_checkpoint_events;
drop policy if exists round_checkpoint_events_select_scoped on public.round_checkpoint_events;
drop policy if exists round_checkpoint_events_insert_scoped on public.round_checkpoint_events;
drop policy if exists round_checkpoint_events_update_director on public.round_checkpoint_events;
drop policy if exists round_checkpoint_events_delete_director on public.round_checkpoint_events;
create policy round_checkpoint_events_select_scoped on public.round_checkpoint_events
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_can_access_round_session(session_id)
  )
);
create policy round_checkpoint_events_insert_scoped on public.round_checkpoint_events
for insert to authenticated
with check (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_can_access_round_session(session_id)
  )
);
create policy round_checkpoint_events_update_director on public.round_checkpoint_events
for update to authenticated
using (public.app_is_active_user() and public.app_is_role(4))
with check (public.app_is_active_user() and public.app_is_role(4));
create policy round_checkpoint_events_delete_director on public.round_checkpoint_events
for delete to authenticated
using (public.app_is_active_user() and public.app_is_role(4));
