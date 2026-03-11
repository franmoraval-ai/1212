-- Supabase live incident diagnostics
-- Run each query separately while the project is unhealthy.

-- 1) Connections by state
select state, count(*)
from pg_stat_activity
group by state
order by count(*) desc;

-- 2) Active queries running > 10s
select
  pid,
  usename,
  application_name,
  client_addr,
  state,
  now() - query_start as running_for,
  wait_event_type,
  wait_event,
  query
from pg_stat_activity
where state <> 'idle'
  and now() - query_start > interval '10 seconds'
order by running_for desc;

-- 3) Blocking chains
select
  blocked.pid as blocked_pid,
  blocking.pid as blocking_pid,
  now() - blocked.query_start as blocked_for,
  blocked.query as blocked_query,
  blocking.query as blocking_query
from pg_stat_activity blocked
join pg_locks bl on blocked.pid = bl.pid and not bl.granted
join pg_locks kl on bl.locktype = kl.locktype
  and bl.database is not distinct from kl.database
  and bl.relation is not distinct from kl.relation
  and bl.page is not distinct from kl.page
  and bl.tuple is not distinct from kl.tuple
  and bl.virtualxid is not distinct from kl.virtualxid
  and bl.transactionid is not distinct from kl.transactionid
  and bl.classid is not distinct from kl.classid
  and bl.objid is not distinct from kl.objid
  and bl.objsubid is not distinct from kl.objsubid
  and kl.granted
join pg_stat_activity blocking on blocking.pid = kl.pid;

-- 4) Database size
select pg_size_pretty(pg_database_size(current_database())) as db_size;

-- 5) Table sizes (largest first)
select
  relname as table_name,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size
from pg_catalog.pg_statio_user_tables
order by pg_total_relation_size(relid) desc
limit 20;
