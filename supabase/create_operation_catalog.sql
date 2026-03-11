-- Catalogo de operaciones/clientes para estandarizar capturas en supervisiones e incidentes.
create table if not exists public.operation_catalog (
  id uuid primary key default gen_random_uuid(),
  operation_name text not null,
  client_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists operation_catalog_operation_client_uq
  on public.operation_catalog (lower(operation_name), lower(client_name));

alter table public.operation_catalog enable row level security;

-- Politicas RLS:
-- - Lectura: cualquier usuario autenticado.
-- - Escritura: solo usuarios autenticados con role_level >= 3.
do $$
begin
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
end
$$;
