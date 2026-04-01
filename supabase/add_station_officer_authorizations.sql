create table if not exists public.station_officer_authorizations (
  id uuid primary key default gen_random_uuid(),
  operation_catalog_id uuid not null references public.operation_catalog(id) on delete cascade,
  officer_user_id uuid not null references public.users(id) on delete cascade,
  granted_by_user_id uuid references public.users(id) on delete set null,
  is_active boolean not null default true,
  valid_from timestamptz,
  valid_to timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_station_officer_authorizations_unique
  on public.station_officer_authorizations (operation_catalog_id, officer_user_id);

create index if not exists idx_station_officer_authorizations_officer
  on public.station_officer_authorizations (officer_user_id, is_active);

create index if not exists idx_station_officer_authorizations_catalog
  on public.station_officer_authorizations (operation_catalog_id, is_active);

insert into public.station_officer_authorizations (
  operation_catalog_id,
  officer_user_id,
  granted_by_user_id,
  is_active,
  valid_from,
  notes
)
select
  oc.id,
  u.id,
  null,
  true,
  now(),
  'Backfill inicial desde users.assigned para transicion a puesto fijo'
from public.users u
join public.operation_catalog oc
  on lower(trim(oc.operation_name)) = lower(trim(split_part(coalesce(u.assigned, ''), '|', 1)))
 and lower(trim(oc.client_name)) = lower(trim(split_part(coalesce(u.assigned, ''), '|', 2)))
where coalesce(u.role_level, 1) = 1
  and lower(trim(coalesce(u.status, 'active'))) in ('', 'active', 'activo')
  and trim(split_part(coalesce(u.assigned, ''), '|', 1)) <> ''
  and trim(split_part(coalesce(u.assigned, ''), '|', 2)) <> ''
on conflict (operation_catalog_id, officer_user_id) do nothing;

alter table public.station_officer_authorizations enable row level security;

drop policy if exists station_officer_authorizations_select_authenticated on public.station_officer_authorizations;
create policy station_officer_authorizations_select_authenticated
  on public.station_officer_authorizations
  for select
  to authenticated
  using (public.app_is_active_user());

drop policy if exists station_officer_authorizations_insert_authenticated on public.station_officer_authorizations;
create policy station_officer_authorizations_insert_authenticated
  on public.station_officer_authorizations
  for insert
  to authenticated
  with check (
    public.app_is_active_user() and public.app_is_role(4)
  );

drop policy if exists station_officer_authorizations_update_authenticated on public.station_officer_authorizations;
create policy station_officer_authorizations_update_authenticated
  on public.station_officer_authorizations
  for update
  to authenticated
  using (
    public.app_is_active_user() and public.app_is_role(4)
  )
  with check (
    public.app_is_active_user() and public.app_is_role(4)
  );

drop policy if exists station_officer_authorizations_delete_authenticated on public.station_officer_authorizations;
create policy station_officer_authorizations_delete_authenticated
  on public.station_officer_authorizations
  for delete
  to authenticated
  using (
    public.app_is_active_user() and public.app_is_role(4)
  );