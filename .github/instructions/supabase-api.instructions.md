---
description: "Use when editing Next.js route handlers, server auth, access control, Supabase queries, RLS-sensitive helpers, or SQL migrations. Covers explicit contracts, scoped authorization, and schema-compat fallbacks."
name: "Supabase API Contracts"
applyTo:
  - "src/app/api/**/*.ts"
  - "src/lib/server-auth.ts"
  - "src/lib/access-control.ts"
  - "src/lib/stations.ts"
  - "src/lib/station-profiles.ts"
  - "src/lib/station-officer-authorizations.ts"
  - "supabase/**/*.sql"
---
# Supabase And API Guidelines

- Keep reads and writes server-mediated. Do not introduce new browser-direct Supabase mutations.
- Reuse `src/lib/server-auth.ts` and `src/lib/access-control.ts` for actor resolution, role checks, and custom-permission checks.
- Keep route contracts explicit and defensive. Preserve compatibility fallbacks for optional or legacy Supabase columns when touching production-facing queries.
- Treat app authorization and Supabase RLS as defense-in-depth. Do not weaken one because the other exists.
- For L1/L2/L3 scope logic, prefer shared station helpers over ad hoc assigned-scope matching.
- When schema or policy changes are required, add or update SQL under `supabase/` and state clearly that scripts are not auto-applied from this workspace.
- If a change affects auth, schema cache, RLS, or missing-column incidents, link [docs/SUPABASE_INCIDENT_RUNBOOK.md](../../docs/SUPABASE_INCIDENT_RUNBOOK.md) instead of re-embedding the runbook.