-- Fase 1 rondas en vivo: sesiones + eventos granulares

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

alter table public.round_sessions enable row level security;
alter table public.round_checkpoint_events enable row level security;

drop policy if exists "Allow all for authenticated" on public.round_sessions;
create policy "Allow all for authenticated"
  on public.round_sessions
  for all
  to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

drop policy if exists "Allow all for authenticated" on public.round_checkpoint_events;
create policy "Allow all for authenticated"
  on public.round_checkpoint_events
  for all
  to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');