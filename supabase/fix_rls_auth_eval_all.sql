-- Remediacion global: evita re-evaluacion por fila de auth.role() en politicas RLS
-- Patron recomendado: (select auth.role())

-- users
alter table public.users enable row level security;
drop policy if exists "Allow all for authenticated" on public.users;
create policy "Allow all for authenticated"
  on public.users
  for all
  to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

-- supervisions
alter table public.supervisions enable row level security;
drop policy if exists "Allow all for authenticated" on public.supervisions;
create policy "Allow all for authenticated"
  on public.supervisions
  for all
  to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

-- management_audits
alter table public.management_audits enable row level security;
drop policy if exists "Allow all for authenticated" on public.management_audits;
create policy "Allow all for authenticated"
  on public.management_audits
  for all
  to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

-- incidents
alter table public.incidents enable row level security;
drop policy if exists "Allow all for authenticated" on public.incidents;
create policy "Allow all for authenticated"
  on public.incidents
  for all
  to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

-- rounds
alter table public.rounds enable row level security;
drop policy if exists "Allow all for authenticated" on public.rounds;
create policy "Allow all for authenticated"
  on public.rounds
  for all
  to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

-- weapons
alter table public.weapons enable row level security;
drop policy if exists "Allow all for authenticated" on public.weapons;
create policy "Allow all for authenticated"
  on public.weapons
  for all
  to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

-- alerts
alter table public.alerts enable row level security;
drop policy if exists "Allow all for authenticated" on public.alerts;
create policy "Allow all for authenticated"
  on public.alerts
  for all
  to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

-- visitors
alter table public.visitors enable row level security;
drop policy if exists "Allow all for authenticated" on public.visitors;
create policy "Allow all for authenticated"
  on public.visitors
  for all
  to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

-- puestos
alter table public.puestos enable row level security;
drop policy if exists "Allow all for authenticated" on public.puestos;
create policy "Allow all for authenticated"
  on public.puestos
  for all
  to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

-- visitas_puestos
alter table public.visitas_puestos enable row level security;
drop policy if exists "Allow all for authenticated" on public.visitas_puestos;
create policy "Allow all for authenticated"
  on public.visitas_puestos
  for all
  to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

-- operation_catalog (role_level >= 3)
alter table public.operation_catalog enable row level security;

drop policy if exists operation_catalog_select_authenticated on public.operation_catalog;
create policy operation_catalog_select_authenticated
  on public.operation_catalog
  for select
  to authenticated
  using (true);

drop policy if exists operation_catalog_insert_authenticated on public.operation_catalog;
create policy operation_catalog_insert_authenticated
  on public.operation_catalog
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.users u
      where lower(coalesce(u.email, '')) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
        and lower(trim(coalesce(u.status, 'active'))) in ('active', 'activo')
        and coalesce(u.role_level, 1) >= 3
    )
  );

drop policy if exists operation_catalog_update_authenticated on public.operation_catalog;
create policy operation_catalog_update_authenticated
  on public.operation_catalog
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.users u
      where lower(coalesce(u.email, '')) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
        and lower(trim(coalesce(u.status, 'active'))) in ('active', 'activo')
        and coalesce(u.role_level, 1) >= 3
    )
  )
  with check (
    exists (
      select 1
      from public.users u
      where lower(coalesce(u.email, '')) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
        and lower(trim(coalesce(u.status, 'active'))) in ('active', 'activo')
        and coalesce(u.role_level, 1) >= 3
    )
  );

drop policy if exists operation_catalog_delete_authenticated on public.operation_catalog;
create policy operation_catalog_delete_authenticated
  on public.operation_catalog
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.users u
      where lower(coalesce(u.email, '')) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
        and lower(trim(coalesce(u.status, 'active'))) in ('active', 'activo')
        and coalesce(u.role_level, 1) >= 3
    )
  );
