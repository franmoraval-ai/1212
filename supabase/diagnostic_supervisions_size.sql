-- Supervisions storage diagnostics
-- Goal: determine whether size is from table heap, indexes, TOAST, or dead tuples.

-- 1) Relation size breakdown
select
  c.reltuples::bigint as est_rows,
  pg_size_pretty(pg_relation_size('public.supervisions')) as table_heap,
  pg_size_pretty(pg_indexes_size('public.supervisions')) as indexes,
  pg_size_pretty(pg_total_relation_size('public.supervisions') - pg_relation_size('public.supervisions') - pg_indexes_size('public.supervisions')) as toast_and_other,
  pg_size_pretty(pg_total_relation_size('public.supervisions')) as total,
  pg_total_relation_size('public.supervisions') as total_bytes
from pg_class c
where c.oid = 'public.supervisions'::regclass;

-- 2) Vacuum / dead tuples health
select
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  round((n_dead_tup::numeric / nullif(n_live_tup + n_dead_tup, 0)) * 100, 2) as dead_pct,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze,
  vacuum_count,
  autovacuum_count,
  analyze_count,
  autoanalyze_count
from pg_stat_user_tables
where schemaname = 'public'
  and relname = 'supervisions';

-- 3) Index footprint
select
  indexrelname as index_name,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
from pg_stat_user_indexes
where schemaname = 'public'
  and relname = 'supervisions'
order by pg_relation_size(indexrelid) desc;

-- 4) Approx payload weight in JSON/text columns
select
  count(*) as rows,
  pg_size_pretty(sum(coalesce(pg_column_size(gps), 0))) as gps_total,
  pg_size_pretty(sum(coalesce(pg_column_size(checklist), 0))) as checklist_total,
  pg_size_pretty(sum(coalesce(pg_column_size(checklist_reasons), 0))) as checklist_reasons_total,
  pg_size_pretty(sum(coalesce(pg_column_size(property_details), 0))) as property_details_total,
  pg_size_pretty(sum(coalesce(pg_column_size(photos), 0))) as photos_total,
  pg_size_pretty(sum(coalesce(pg_column_size(observations), 0))) as observations_total
from public.supervisions;

-- 5) Daily growth trend (last 30d)
select
  date_trunc('day', created_at) as day,
  count(*) as rows_created
from public.supervisions
where created_at >= now() - interval '30 days'
group by 1
order by 1 desc;
