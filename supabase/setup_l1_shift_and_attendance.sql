alter table public.users
  add column if not exists shift_pin_hash text,
  add column if not exists shift_nfc_code text;

create table if not exists public.shift_handoffs (
  id uuid primary key default gen_random_uuid(),
  station_label text not null,
  outgoing_officer_name text,
  outgoing_shift_started_at timestamptz,
  incoming_officer_name text not null,
  incoming_officer_email text,
  incoming_officer_user_id uuid,
  auth_method text not null default 'manual_id',
  handoff_notes text,
  created_by_device_email text,
  created_by_device_user_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_shift_handoffs_station_created_at
  on public.shift_handoffs (station_label, created_at desc);

alter table public.shift_handoffs enable row level security;

drop policy if exists shift_handoffs_select_manager on public.shift_handoffs;
create policy shift_handoffs_select_manager
  on public.shift_handoffs
  for select
  to authenticated
  using (public.app_is_role(2));

drop policy if exists shift_handoffs_insert_manager on public.shift_handoffs;
create policy shift_handoffs_insert_manager
  on public.shift_handoffs
  for insert
  to authenticated
  with check (public.app_is_role(1));

create table if not exists public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  station_label text not null,
  station_post_name text,
  officer_user_id uuid,
  officer_name text not null,
  officer_email text,
  check_in_at timestamptz not null default now(),
  check_out_at timestamptz,
  worked_minutes int,
  notes text,
  created_by_device_email text,
  created_by_device_user_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_logs_station_check_in
  on public.attendance_logs (station_label, check_in_at desc);

create index if not exists idx_attendance_logs_officer_check_in
  on public.attendance_logs (officer_user_id, check_in_at desc);

create unique index if not exists idx_attendance_logs_station_open_shift
  on public.attendance_logs (station_label)
  where check_out_at is null;

alter table public.attendance_logs enable row level security;

drop policy if exists attendance_logs_select_authenticated on public.attendance_logs;
create policy attendance_logs_select_authenticated
  on public.attendance_logs
  for select
  to authenticated
  using (public.app_is_active_user());

drop policy if exists attendance_logs_insert_authenticated on public.attendance_logs;
create policy attendance_logs_insert_authenticated
  on public.attendance_logs
  for insert
  to authenticated
  with check (public.app_is_active_user());

drop policy if exists attendance_logs_update_authenticated on public.attendance_logs;
create policy attendance_logs_update_authenticated
  on public.attendance_logs
  for update
  to authenticated
  using (public.app_is_active_user())
  with check (public.app_is_active_user());