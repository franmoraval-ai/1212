-- Additive closure traceability for incidents. Existing records remain unchanged.
alter table if exists public.incidents
  add column if not exists resolution_note text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by_user_id text,
  add column if not exists resolved_by_email text;

create index if not exists idx_incidents_open_by_location_time
  on public.incidents (location, time desc)
  where coalesce(lower(trim(status)), '') <> 'cerrado';

create index if not exists idx_incidents_resolved_at
  on public.incidents (resolved_at desc)
  where resolved_at is not null;

comment on column public.incidents.resolution_note is
  'Required operational resolution when an incident is closed.';