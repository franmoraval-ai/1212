-- Purpose: Reduce memory pressure and full table scans on frequent read paths.
-- Run in Supabase SQL Editor during a low-traffic window.

-- 1) Time-ordered feeds used across dashboard pages.
create index if not exists idx_supervisions_created_at_desc
  on public.supervisions (created_at desc);

create index if not exists idx_management_audits_created_at_desc
  on public.management_audits (created_at desc);

create index if not exists idx_incidents_time_desc
  on public.incidents ("time" desc);

create index if not exists idx_alerts_created_at_desc
  on public.alerts (created_at desc);

create index if not exists idx_visitors_entry_time_desc
  on public.visitors (entry_time desc);

create index if not exists idx_users_role_level_desc
  on public.users (role_level desc);

create index if not exists idx_rounds_name
  on public.rounds (name);

create index if not exists idx_weapons_serial
  on public.weapons (serial);

create index if not exists idx_operation_catalog_operation_name
  on public.operation_catalog (operation_name);

-- 2) Filters and joins seen in supervision flows.
create index if not exists idx_supervisions_supervisor_created
  on public.supervisions (supervisor_id, created_at desc);

create index if not exists idx_supervisions_operation_created
  on public.supervisions (operation_name, created_at desc);

create index if not exists idx_supervisions_review_post_created
  on public.supervisions (review_post, created_at desc);

-- 2b) Trigger anti-duplicado (prevent_duplicate_supervisions) usa lower(trim(...)).
-- Este indice evita scans costosos en inserciones de supervision.
create index if not exists idx_supervisions_dedupe_probe
  on public.supervisions (
    lower(trim(supervisor_id)),
    lower(trim(operation_name)),
    lower(trim(officer_name)),
    lower(trim(type)),
    lower(trim(review_post)),
    created_at
  );

-- 3) Round reports timeline access.
do $$
begin
  if to_regclass('public.round_reports') is not null then
    execute 'create index if not exists idx_round_reports_created_at_desc on public.round_reports (created_at desc)';
    execute 'create index if not exists idx_round_reports_round_created on public.round_reports (round_id, created_at desc)';
  end if;
end $$;

-- 4) Keep planner stats fresh after index creation.
analyze public.supervisions;
analyze public.management_audits;
analyze public.incidents;
analyze public.alerts;
analyze public.visitors;
analyze public.users;
analyze public.rounds;
analyze public.weapons;
analyze public.operation_catalog;
do $$
begin
  if to_regclass('public.round_reports') is not null then
    execute 'analyze public.round_reports';
  end if;
end $$;
