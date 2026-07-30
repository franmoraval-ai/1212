-- Immutable operational follow-up log for incident handling.
create table if not exists public.incident_follow_ups (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  note text not null check (char_length(trim(note)) between 1 and 2000),
  created_by_user_id text,
  created_by_email text,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_incident_follow_ups_incident_created
  on public.incident_follow_ups (incident_id, created_at desc);

alter table public.incident_follow_ups enable row level security;

-- Only internal service-role routes access this log; no browser-direct policies are defined.