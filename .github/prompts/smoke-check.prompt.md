---
description: "Run a post-deploy smoke check for HO Seguridad using the repo's documented L1-L4 validation flow and Supabase incident guidance."
name: "Post-Deploy Smoke Check"
argument-hint: "Target environment, deployment notes, or suspected risk areas"
agent: "agent"
---
Review the current workspace context and use the provided input as the target environment or deployment notes.

Run a concise post-deploy smoke-check plan for this repo.

Requirements:
- Use [the production smoke checklist](../../docs/PRODUCTION_SMOKE_CHECKLIST_L1_L4.md) as the primary validation source.
- Use [the Supabase incident runbook](../../docs/SUPABASE_INCIDENT_RUNBOOK.md) only when auth, RLS, schema, or API failures are relevant.
- Use [the README](../../README.md) only for deployment, environment-variable, or hosting context.
- Do not duplicate those documents. Link them and summarize only what matters for the current check.
- Optimize the check order for fastest confidence on critical paths, especially L1 rounds/station flows and L4 operational setup.

Return:
1. A recommended smoke-check sequence.
2. The exact high-risk areas to verify first.
3. Any repo-specific blockers or caveats that could make the checklist fail even if the deploy succeeded.
4. A short pass/fail reporting template the operator can fill in.