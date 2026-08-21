-- Canonical operational identity for officers, including personnel without Auth access.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $$
begin
  if to_regclass('public.users') is null then
    raise exception 'public.users must exist before creating personnel_registry';
  end if;
  if to_regclass('public.operation_catalog') is null then
    raise exception 'public.operation_catalog must exist before creating personnel_registry';
  end if;
  if to_regclass('public.supervisions') is null then
    raise exception 'public.supervisions must exist before creating personnel_registry';
  end if;
  if to_regclass('public.station_officer_authorizations') is null then
    raise exception 'Apply add_station_officer_authorizations.sql before creating personnel_registry';
  end if;
  if to_regclass('public.personnel_code_seq') is null then
    raise exception 'Apply add_stable_personnel_identity.sql before creating personnel_registry';
  end if;
end;
$$;

create table if not exists public.personnel_registry (
  id uuid primary key default gen_random_uuid(),
  personnel_code text not null default (
    'HO-' || lpad(nextval('public.personnel_code_seq')::text, 6, '0')
  ),
  linked_user_id uuid unique references public.users(id) on delete set null,
  full_name text not null check (char_length(trim(full_name)) between 2 and 160),
  id_number text,
  phone text,
  status text not null default 'ACTIVO' check (status in ('ACTIVO', 'INACTIVO')),
  source text not null default 'PREREGISTRO' check (source in ('AUTH_USER', 'PREREGISTRO')),
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (personnel_code ~ '^HO-[0-9]{6,}$'),
  check (id_number is null or char_length(trim(id_number)) between 3 and 40),
  check (phone is null or char_length(trim(phone)) between 4 and 30)
);

create unique index if not exists idx_personnel_registry_code_unique
  on public.personnel_registry (upper(trim(personnel_code)));

create unique index if not exists idx_personnel_registry_id_number_unique
  on public.personnel_registry (
    regexp_replace(upper(trim(id_number)), '[^A-Z0-9]', '', 'g')
  )
  where nullif(regexp_replace(upper(trim(id_number)), '[^A-Z0-9]', '', 'g'), '') is not null;

create index if not exists idx_personnel_registry_active_name
  on public.personnel_registry (status, full_name);

create table if not exists public.personnel_registry_assignments (
  id uuid primary key default gen_random_uuid(),
  personnel_registry_id uuid not null references public.personnel_registry(id) on delete cascade,
  operation_catalog_id uuid not null references public.operation_catalog(id) on delete cascade,
  is_active boolean not null default true,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (personnel_registry_id, operation_catalog_id)
);

create index if not exists idx_personnel_registry_assignments_catalog
  on public.personnel_registry_assignments (operation_catalog_id, is_active);

insert into public.personnel_registry (
  personnel_code,
  linked_user_id,
  full_name,
  status,
  source
)
select
  u.personnel_code,
  u.id,
  coalesce(nullif(trim(u.first_name), ''), nullif(trim(u.email), ''), 'Oficial'),
  case when lower(trim(coalesce(u.status, 'active'))) in ('', 'active', 'activo') then 'ACTIVO' else 'INACTIVO' end,
  'AUTH_USER'
from public.users u
where coalesce(u.role_level, 1) = 1
on conflict (linked_user_id) do update
set full_name = excluded.full_name,
    status = excluded.status,
    source = 'AUTH_USER',
    updated_at = now();

insert into public.personnel_registry_assignments (
  personnel_registry_id,
  operation_catalog_id,
  is_active,
  created_by_user_id
)
select
  registry.id,
  station_auth.operation_catalog_id,
  station_auth.is_active,
  station_auth.granted_by_user_id
from public.station_officer_authorizations station_auth
join public.personnel_registry registry
  on registry.linked_user_id = station_auth.officer_user_id
on conflict (personnel_registry_id, operation_catalog_id) do update
set is_active = excluded.is_active,
    updated_at = now();

alter table public.supervisions
  add column if not exists officer_registry_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'supervisions_officer_registry_id_fkey'
      and conrelid = 'public.supervisions'::regclass
  ) then
    alter table public.supervisions
      add constraint supervisions_officer_registry_id_fkey
      foreign key (officer_registry_id)
      references public.personnel_registry(id)
      on delete set null;
  end if;
end;
$$;

update public.supervisions supervision
set officer_registry_id = registry.id
from public.personnel_registry registry
where supervision.officer_registry_id is null
  and supervision.officer_user_id = registry.linked_user_id;

create index if not exists idx_supervisions_officer_registry_event
  on public.supervisions (officer_registry_id, event_occurred_at desc);

create or replace function public.sync_l1_personnel_registry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_rows integer := 0;
begin
  if coalesce(new.role_level, 1) <> 1 then
    return new;
  end if;

  update public.personnel_registry
  set linked_user_id = new.id,
      full_name = coalesce(nullif(trim(new.first_name), ''), nullif(trim(new.email), ''), 'Oficial'),
      status = case when lower(trim(coalesce(new.status, 'active'))) in ('', 'active', 'activo') then 'ACTIVO' else 'INACTIVO' end,
      source = 'AUTH_USER',
      updated_at = now()
  where upper(trim(personnel_code)) = upper(trim(new.personnel_code))
    and (linked_user_id is null or linked_user_id = new.id);

  get diagnostics linked_rows = row_count;
  if linked_rows > 0 then
    return new;
  end if;

  insert into public.personnel_registry (
    personnel_code,
    linked_user_id,
    full_name,
    status,
    source
  ) values (
    new.personnel_code,
    new.id,
    coalesce(nullif(trim(new.first_name), ''), nullif(trim(new.email), ''), 'Oficial'),
    case when lower(trim(coalesce(new.status, 'active'))) in ('', 'active', 'activo') then 'ACTIVO' else 'INACTIVO' end,
    'AUTH_USER'
  )
  on conflict (linked_user_id) do update
  set full_name = excluded.full_name,
      status = excluded.status,
      source = 'AUTH_USER',
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_sync_l1_personnel_registry on public.users;
create trigger trg_sync_l1_personnel_registry
after insert or update of first_name, email, role_level, status
on public.users
for each row
execute function public.sync_l1_personnel_registry();

alter table public.personnel_registry enable row level security;
alter table public.personnel_registry_assignments enable row level security;

comment on table public.personnel_registry is
  'Canonical UUID identity for officers with or without an authenticated application account.';

comment on column public.supervisions.officer_registry_id is
  'Canonical officer identity. officer_name, id_number, and officer_phone remain historical snapshots.';

commit;