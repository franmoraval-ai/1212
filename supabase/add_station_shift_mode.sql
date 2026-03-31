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