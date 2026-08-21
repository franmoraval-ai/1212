-- Stable human-readable personnel identity. Relationships continue to use users.id UUID.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $$
begin
  if to_regclass('public.users') is null then
    raise exception 'public.users must exist before adding stable personnel identity';
  end if;
end;
$$;

create sequence if not exists public.personnel_code_seq;

alter table public.users
  add column if not exists personnel_code text;

alter sequence public.personnel_code_seq owned by public.users.personnel_code;

alter table public.users
  alter column personnel_code set default (
    'HO-' || lpad(nextval('public.personnel_code_seq')::text, 6, '0')
  );

update public.users
set personnel_code = 'HO-' || lpad(nextval('public.personnel_code_seq')::text, 6, '0')
where nullif(trim(personnel_code), '') is null;

alter table public.users
  alter column personnel_code set not null;

alter table public.users
  drop constraint if exists users_personnel_code_format_check,
  add constraint users_personnel_code_format_check
  check (personnel_code ~ '^HO-[0-9]{6,}$');

create unique index if not exists idx_users_personnel_code_unique
  on public.users (upper(trim(personnel_code)));

create unique index if not exists idx_users_email_normalized_unique
  on public.users (lower(trim(email)))
  where nullif(trim(email), '') is not null;

create or replace function public.prevent_personnel_code_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.personnel_code is distinct from new.personnel_code then
    raise exception using
      errcode = '23514',
      message = 'personnel_code is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_personnel_code_change on public.users;
create trigger trg_prevent_personnel_code_change
before update of personnel_code on public.users
for each row
execute function public.prevent_personnel_code_change();

comment on column public.users.personnel_code is
  'Immutable human-readable personnel identifier. Database relationships must use users.id UUID.';

commit;
