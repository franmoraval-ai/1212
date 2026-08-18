-- Supervision V2 is additive: existing columns, records, API contracts, and RLS remain intact.
-- Apply add_supervision_operation_catalog_reference.sql first when operation_catalog_id is not present.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $$
begin
  if to_regclass('public.supervisions') is null then
    raise exception 'public.supervisions must exist before adding Supervision V2';
  end if;

  if to_regclass('public.users') is null then
    raise exception 'public.users must exist before adding Supervision V2';
  end if;
end;
$$;

alter table public.supervisions
  add column if not exists event_occurred_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists officer_user_id uuid,
  add column if not exists recorded_by_user_id uuid,
  add column if not exists shift_id uuid,
  add column if not exists checklist_version smallint not null default 1,
  add column if not exists finding_required boolean not null default false,
  add column if not exists corrected_onsite boolean,
  add column if not exists follow_up_required boolean not null default false,
  add column if not exists device_context jsonb;

update public.supervisions
set event_occurred_at = coalesce(event_occurred_at, created_at, now()),
    updated_at = coalesce(updated_at, created_at, now())
where event_occurred_at is null
   or updated_at is null;

alter table public.supervisions
  alter column event_occurred_at set default now(),
  alter column event_occurred_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'supervisions_officer_user_id_fkey'
      and conrelid = 'public.supervisions'::regclass
  ) then
    alter table public.supervisions
      add constraint supervisions_officer_user_id_fkey
      foreign key (officer_user_id)
      references public.users(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'supervisions_recorded_by_user_id_fkey'
      and conrelid = 'public.supervisions'::regclass
  ) then
    alter table public.supervisions
      add constraint supervisions_recorded_by_user_id_fkey
      foreign key (recorded_by_user_id)
      references public.users(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'supervisions_checklist_version_check'
      and conrelid = 'public.supervisions'::regclass
  ) then
    alter table public.supervisions
      add constraint supervisions_checklist_version_check
      check (checklist_version >= 1);
  end if;
end;
$$;

create index if not exists idx_supervisions_event_occurred
  on public.supervisions (event_occurred_at desc);

create index if not exists idx_supervisions_officer_event
  on public.supervisions (officer_user_id, event_occurred_at desc);

create index if not exists idx_supervisions_follow_up
  on public.supervisions (follow_up_required, event_occurred_at desc)
  where follow_up_required = true;

create table if not exists public.supervision_findings (
  id uuid primary key default gen_random_uuid(),
  supervision_id uuid not null references public.supervisions(id) on delete cascade,
  checklist_key text not null check (char_length(trim(checklist_key)) between 1 and 100),
  category text not null check (char_length(trim(category)) between 1 and 100),
  description text not null check (char_length(trim(description)) between 1 and 4000),
  severity text not null check (severity in ('BAJA', 'MEDIA', 'ALTA', 'CRITICA')),
  corrected_onsite boolean not null default false,
  follow_up_required boolean not null default false,
  responsible_user_id uuid references public.users(id) on delete set null,
  corrective_action text check (corrective_action is null or char_length(trim(corrective_action)) between 1 and 4000),
  due_at timestamptz,
  status text not null default 'ABIERTO' check (
    status in ('ABIERTO', 'EN_EJECUCION', 'PENDIENTE_VERIFICACION', 'CERRADO')
  ),
  evidence jsonb not null default '[]'::jsonb,
  recurrence_flag boolean not null default false,
  created_by_user_id uuid references public.users(id) on delete set null,
  verified_by_user_id uuid references public.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'CERRADO' or verified_at is not null)
);

create index if not exists idx_supervision_findings_supervision
  on public.supervision_findings (supervision_id, created_at desc);

create index if not exists idx_supervision_findings_open
  on public.supervision_findings (status, due_at)
  where status <> 'CERRADO';

create index if not exists idx_supervision_findings_responsible
  on public.supervision_findings (responsible_user_id, status, due_at);

alter table public.supervision_findings enable row level security;

comment on table public.supervision_findings is
  'Structured findings created from non-compliant Supervision V2 checklist items. Access is server-mediated.';

comment on column public.supervisions.checklist_version is
  'Historical rows remain version 1. New structured checklist submissions explicitly write version 2.';

comment on column public.supervisions.shift_id is
  'Optional shift or attendance identifier. No foreign key is imposed while legacy shift schemas coexist.';

comment on column public.supervisions.device_context is
  'Optional non-sensitive capture metadata. GPS remains in gps and photographs remain in photos.';

commit;