-- Boletas independientes para ejecucion de rondas por QR

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

alter table public.round_reports enable row level security;

drop policy if exists "Allow all for authenticated" on public.round_reports;
create policy "Allow all for authenticated"
  on public.round_reports
  for all
  to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');
