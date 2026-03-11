-- Remediacion de RLS para operation_catalog
-- Objetivo: evitar politicas permisivas (USING/WITH CHECK true) en operaciones de escritura.

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
