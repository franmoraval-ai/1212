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