-- Bitacora de control de armas para cambios desde dashboard de supervision
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

alter table public.weapon_control_logs enable row level security;

create policy "Allow all for authenticated" on public.weapon_control_logs
for all to authenticated
using ((select auth.role()) = 'authenticated')
with check ((select auth.role()) = 'authenticated');
