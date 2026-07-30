-- Execute after create_operation_catalog.sql. This migration is additive and keeps legacy text fields intact.
alter table if exists public.supervisions
  add column if not exists operation_catalog_id uuid;

do $$
begin
  if to_regclass('public.supervisions') is null then
    raise exception 'public.supervisions must exist before adding its operation catalog reference';
  end if;

  if to_regclass('public.operation_catalog') is null then
    raise exception 'public.operation_catalog must exist before adding its supervision reference';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'supervisions_operation_catalog_id_fkey'
      and conrelid = 'public.supervisions'::regclass
  ) then
    alter table public.supervisions
      add constraint supervisions_operation_catalog_id_fkey
      foreign key (operation_catalog_id)
      references public.operation_catalog(id)
      on delete restrict;
  end if;
end;
$$;

-- Backfill only exact operation/client matches. Inactive catalog rows are included for historical traceability.
update public.supervisions as supervision
set operation_catalog_id = catalog.id
from public.operation_catalog as catalog
where supervision.operation_catalog_id is null
  and nullif(trim(supervision.operation_name), '') is not null
  and nullif(trim(supervision.review_post), '') is not null
  and lower(trim(supervision.operation_name)) = lower(trim(catalog.operation_name))
  and lower(trim(supervision.review_post)) = lower(trim(catalog.client_name));

create index if not exists idx_supervisions_operation_catalog_id_created
  on public.supervisions (operation_catalog_id, created_at desc);

comment on column public.supervisions.operation_catalog_id is
  'Canonical operation_catalog reference. Legacy operation_name and review_post remain for compatibility.';