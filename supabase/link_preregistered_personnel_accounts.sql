-- Link a new L1 Auth profile to an existing operational preregistration by personnel code.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

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

commit;
