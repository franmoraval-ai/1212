# Supabase Incident Runbook

Use this when the project flips to `Unhealthy` and recovers only after restart.

Note: this file is documentation (`.md`). Do not run it in SQL Editor.
Run SQL only from files under `supabase/*.sql`.

## 1) Capture During Outage (2 minutes)
1. Open Supabase Dashboard and take screenshot of service health.
2. Open `Logs` for `Database`, `API (PostgREST)`, and `Auth`.
3. Filter logs to the exact outage minute.
4. Save lines with any of these patterns:
- `too many connections`
- `statement timeout`
- `out of memory` / `OOM`
- `disk full` / `no space left`
- repeated `5xx`

## 2) Run SQL Diagnostics
Run `supabase/diagnostic_live.sql` queries one by one while still unhealthy.

If the symptoms are specific to L1 operational workflows such as shifts, station profiles, or authorized posts returning `503`/schema-missing errors, also run `supabase/verify_l1_operational_stack.sql` to confirm the required L1 tables, indexes, policies, and profile coverage are present.

Also run `supabase/diagnostic_wal.sql` to confirm WAL growth and retention source:
- `pg_wal` size (if `pg_ls_waldir()` is allowed)
- replication slot retention
- WAL generation rate (`pg_stat_wal`)
- checkpoint pressure (rename-safe query against `pg_stat_bgwriter` fields)

If one table dominates DB size (for example `supervisions`), run `supabase/diagnostic_supervisions_size.sql`.
It separates heap/index/TOAST usage and dead tuples before deciding purge vs vacuum/index action.

If SQL Editor returns `Connection terminated due to connection timeout`:
1. Run `supabase/diagnostic_minimal.sql` first.
2. If even `select now()` fails, treat as platform-level outage for the project.
3. Capture screenshot of the SQL timeout error and the health panel.
4. Skip heavy queries and open support ticket immediately.

Keep results for:
- connections by state
- active queries > 10s
- blocking chains
- db size
- top table sizes

## 3) Immediate Triage
1. If `too many connections`: reduce polling and background tabs, then restart once.
2. If `statement timeout`/long queries: identify query text from diagnostics and optimize.
3. If `disk full` or size near plan limit: clean old data or upgrade plan.
4. If `pg_wal` is large:
- If `pg_replication_slots` shows high retained WAL, remove/fix stale consumers first.
- If WAL generation rate is high, reduce bulk writes and check indexes/hot tables.
- If checkpoints are too frequent (`checkpoints_req` high), review write spikes and settings.
5. If no DB symptom but API/Auth unhealthy: treat as platform incident and open support ticket.

## 4) Support Ticket Template
Subject: Intermittent Supabase outage - services become Unhealthy until manual restart

Include:
- Project ref:
- Region:
- Plan: NANO
- First seen date/time (UTC):
- Frequency (times/day):
- Screenshot of health panel:
- Logs snippets (Database/API/Auth):
- SQL diagnostics output (connections, long queries, blocks, db size):
- If SQL timed out, include exact message: `Connection terminated due to connection timeout`:
- Confirmation that manual restart recovers temporarily:

Expected request to support:
- Please check infrastructure events for this project/region and backend service crashes.
- Please confirm whether connection limits, memory pressure, or platform incident caused the unhealthy state.

## 5) Stabilization Recommendations
- Keep only one active app tab per operator during incidents.
- Avoid bulk exports while project is degraded.
- Run heavy maintenance queries off-peak.
- Consider upgrading from NANO if usage regularly spikes.
