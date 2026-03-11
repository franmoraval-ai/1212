# Supabase Support Ticket (Ready to Send)

Subject: Critical outage - SQL Editor times out (`Connection terminated due to connection timeout`) and services become Unhealthy

Hello Supabase Support,

We are experiencing a recurring project outage. The project becomes Unhealthy and only recovers temporarily after manual restart.

## Impact
- App becomes unstable/unavailable.
- SQL Editor cannot run even minimal probes.
- Backend services show unhealthy status intermittently.

## Critical Evidence
- Error shown in SQL Editor:
  `Failed to run sql query: Connection terminated due to connection timeout`
- The same error occurs with minimal query set (`select now()` included).
- Manual restart restores service temporarily, then issue returns.

## Environment
- Project ref: <PASTE_PROJECT_REF>
- Region: <PASTE_REGION>
- Plan: NANO
- First seen (UTC): <PASTE_TIME>
- Frequency: <PASTE_FREQUENCY>

## Reproduction
1. Wait until project status flips to Unhealthy.
2. Open SQL Editor.
3. Run `select now();`
4. SQL Editor returns timeout/connection terminated.

## Attachments included
- Health panel screenshot (services unhealthy).
- SQL timeout screenshot with exact message.
- Logs (Database / API / Auth) around outage timestamps.
- Note that manual restart recovers temporarily.

## Request
Please investigate backend infrastructure for this project/region (DB/API/Auth), specifically:
- connection pool exhaustion,
- memory pressure / OOM,
- service restarts,
- platform incident affecting this project.

Also please confirm recommended mitigation for NANO plan stability under our workload.

## Follow-up after your OOM diagnosis
Thanks for confirming memory pressure/OOM on this project. We are taking immediate action on query/index optimization and preparing a compute upgrade if required.

Please provide:
- Recommended target `Compute Size` for our current workload pattern.
- Whether autoscaling is available/recommended for this project and region.
- Any specific top memory-consuming queries you detected from your side.
- Confirmation if there were backend restarts linked to OOM kills.

We can share post-optimization metrics after applying indexes to validate if upgrade is still required.

Thanks.
