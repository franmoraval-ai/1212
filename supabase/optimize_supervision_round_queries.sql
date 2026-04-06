-- Purpose: reduce latency on supervision and round-report reads observed in production.
-- Run in Supabase SQL Editor during a low-traffic window.

create index if not exists idx_supervisions_created_at_desc
  on public.supervisions (created_at desc);

create index if not exists idx_supervisions_supervisor_created
  on public.supervisions (supervisor_id, created_at desc);

create index if not exists idx_supervisions_status_created
  on public.supervisions (status, created_at desc);

create index if not exists idx_supervisions_review_post_created
  on public.supervisions (review_post, created_at desc);

create index if not exists idx_supervisions_operation_created
  on public.supervisions (operation_name, created_at desc);

do $$
begin
  if to_regclass('public.round_reports') is not null then
    execute 'create index if not exists idx_round_reports_created_at_desc on public.round_reports (created_at desc)';
    execute 'create index if not exists idx_round_reports_officer_created on public.round_reports (officer_id, created_at desc)';
    execute 'create index if not exists idx_round_reports_status_created on public.round_reports (status, created_at desc)';
    execute 'create index if not exists idx_round_reports_post_created on public.round_reports (post_name, created_at desc)';
    execute 'create index if not exists idx_round_reports_round_created on public.round_reports (round_id, created_at desc)';
  end if;
end $$;

analyze public.supervisions;

do $$
begin
  if to_regclass('public.round_reports') is not null then
    execute 'analyze public.round_reports';
  end if;
end $$;