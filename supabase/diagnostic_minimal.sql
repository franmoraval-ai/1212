-- Minimal Supabase incident probe
-- Use this when diagnostic_live.sql times out.

-- 0) Basic DB responsiveness
select now() as db_now;

-- 1) Current backend count
select count(*) as backends from pg_stat_activity;

-- 2) Connections by state (cheap)
select state, count(*)
from pg_stat_activity
group by state
order by count(*) desc;

-- 3) Database size (cheap)
select pg_size_pretty(pg_database_size(current_database())) as db_size;
