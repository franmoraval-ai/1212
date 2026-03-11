-- WAL diagnostics for retention and growth analysis
-- Run queries one by one.

-- 1) DB / WAL settings that influence retention
select name, setting, unit
from pg_settings
where name in (
  'wal_level',
  'max_wal_size',
  'min_wal_size',
  'wal_keep_size',
  'checkpoint_timeout',
  'archive_mode'
)
order by name;

-- 2) WAL generation counters (cluster-wide)
-- Use this output twice (e.g., 5 minutes apart) to estimate WAL generation rate.
select
  wal_records,
  wal_fpi,
  wal_bytes,
  pg_size_pretty(wal_bytes) as wal_bytes_pretty,
  stats_reset
from pg_stat_wal;

-- 3) Checkpoint pressure (single query, rename-safe)
-- Handles both old and new field names without failing if one set is missing.
with bg as (
  select to_jsonb(s) as j
  from pg_stat_bgwriter s
)
select
  coalesce((j->>'num_timed')::bigint, (j->>'checkpoints_timed')::bigint) as checkpoints_timed,
  coalesce((j->>'num_requested')::bigint, (j->>'checkpoints_req')::bigint) as checkpoints_req,
  coalesce((j->>'write_time')::double precision, (j->>'checkpoint_write_time')::double precision) as checkpoint_write_time_ms,
  coalesce((j->>'sync_time')::double precision, (j->>'checkpoint_sync_time')::double precision) as checkpoint_sync_time_ms,
  coalesce((j->>'buffers_written')::bigint, (j->>'buffers_checkpoint')::bigint) as buffers_checkpoint,
  j->>'stats_reset' as stats_reset
from bg;

-- 4) Replication slots retaining WAL
-- If retained_by_slot is large, this is commonly the retention cause.
select
  slot_name,
  slot_type,
  active,
  restart_lsn,
  confirmed_flush_lsn,
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) as retained_by_slot
from pg_replication_slots
order by pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) desc nulls last;

-- 5) Long running transactions that may delay vacuum/recycling
select
  pid,
  usename,
  state,
  now() - xact_start as xact_age,
  wait_event_type,
  wait_event,
  left(query, 300) as query
from pg_stat_activity
where xact_start is not null
order by xact_age desc
limit 20;

-- 6) Exact pg_wal directory size (requires function access)
-- If this fails with permissions, skip and use slot retention + WAL rate as proxy.
select
  pg_size_pretty(coalesce(sum(size), 0)) as pg_wal_size
from pg_ls_waldir();
