create table if not exists public.station_profiles (
  id uuid primary key default gen_random_uuid(),
  operation_catalog_id uuid not null unique references public.operation_catalog(id) on delete cascade,
  is_enabled boolean not null default true,
  device_label text null,
  notes text null,
  registered_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists station_profiles_enabled_idx on public.station_profiles (is_enabled);
create index if not exists station_profiles_registered_at_idx on public.station_profiles (registered_at desc);

create or replace function public.set_station_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists station_profiles_set_updated_at on public.station_profiles;
create trigger station_profiles_set_updated_at
before update on public.station_profiles
for each row
execute function public.set_station_profiles_updated_at();

insert into public.station_profiles (operation_catalog_id, is_enabled, registered_at, updated_at)
select oc.id, coalesce(oc.is_active, true), timezone('utc', now()), timezone('utc', now())
from public.operation_catalog oc
left join public.station_profiles sp on sp.operation_catalog_id = oc.id
where sp.id is null;

create or replace function public.sync_station_profile_from_catalog()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.station_profiles (operation_catalog_id, is_enabled, registered_at, updated_at)
    values (new.id, coalesce(new.is_active, true), timezone('utc', now()), timezone('utc', now()))
    on conflict (operation_catalog_id) do nothing;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    update public.station_profiles
    set is_enabled = case
      when new.is_active is false then false
      else station_profiles.is_enabled
    end,
    updated_at = timezone('utc', now())
    where operation_catalog_id = new.id;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists operation_catalog_sync_station_profile on public.operation_catalog;
create trigger operation_catalog_sync_station_profile
after insert or update on public.operation_catalog
for each row
execute function public.sync_station_profile_from_catalog();

alter table public.station_profiles enable row level security;

drop policy if exists "station_profiles_select_active_users" on public.station_profiles;
create policy "station_profiles_select_active_users"
on public.station_profiles
for select
to authenticated
using (public.app_is_active_user());

drop policy if exists "station_profiles_l4_insert" on public.station_profiles;
create policy "station_profiles_l4_insert"
on public.station_profiles
for insert
to authenticated
with check (public.app_is_active_user() and public.app_is_role(4));

drop policy if exists "station_profiles_l4_update" on public.station_profiles;
create policy "station_profiles_l4_update"
on public.station_profiles
for update
to authenticated
using (public.app_is_active_user() and public.app_is_role(4))
with check (public.app_is_active_user() and public.app_is_role(4));
