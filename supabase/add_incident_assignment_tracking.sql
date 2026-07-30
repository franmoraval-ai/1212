-- Additive ownership and assignment traceability for operational incident follow-up.
alter table if exists public.incidents
  add column if not exists assigned_to_user_id text,
  add column if not exists assigned_to_email text,
  add column if not exists assigned_to_name text,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by_user_id text,
  add column if not exists assigned_by_email text;

create index if not exists idx_incidents_assigned_open
  on public.incidents (assigned_to_user_id, time desc)
  where assigned_to_user_id is not null
    and coalesce(lower(trim(status)), '') <> 'cerrado';

comment on column public.incidents.assigned_to_user_id is
  'User responsible for operational follow-up; assignment authority is validated by the incident API.';