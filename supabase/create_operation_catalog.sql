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

-- Politicas basicas equivalentes al comportamiento actual del sistema (usuarios autenticados).
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'operation_catalog'
      and policyname = 'operation_catalog_select_authenticated'
  ) then
    create policy operation_catalog_select_authenticated
      on public.operation_catalog
      for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'operation_catalog'
      and policyname = 'operation_catalog_insert_authenticated'
  ) then
    create policy operation_catalog_insert_authenticated
      on public.operation_catalog
      for insert
      to authenticated
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'operation_catalog'
      and policyname = 'operation_catalog_update_authenticated'
  ) then
    create policy operation_catalog_update_authenticated
      on public.operation_catalog
      for update
      to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'operation_catalog'
      and policyname = 'operation_catalog_delete_authenticated'
  ) then
    create policy operation_catalog_delete_authenticated
      on public.operation_catalog
      for delete
      to authenticated
      using (true);
  end if;
end
$$;
