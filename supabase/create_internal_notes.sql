-- Modulo interno de novedades/faltantes por puesto (fuera de boletas)
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

alter table public.internal_notes enable row level security;

create policy "Allow all for authenticated" on public.internal_notes
for all to authenticated
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');
