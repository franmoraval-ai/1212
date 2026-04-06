# Project Guidelines

## Architecture
- This is a Next.js App Router workspace. Keep UI routes under `src/app`, protected product flows under `src/app/(dashboard)`, and server handlers under `src/app/api`.
- Prefer the established server-mediated data pattern: page component -> hook in `src/hooks` -> internal API route -> shared helper in `src/lib`. Do not introduce new browser-direct Supabase writes.
- Reuse shared auth and permission helpers from `src/lib/server-auth.ts` and `src/lib/access-control.ts` instead of open-coded role checks.
- Preserve the station/post model centered on `src/lib/stations.ts`, `src/lib/station-profiles.ts`, `src/lib/station-officer-authorizations.ts`, and `src/components/layout/station-shift-provider.tsx`.
- Offline behavior is a core requirement. Changes affecting rounds, supervision, incidents, or internal notes should account for `src/lib/offline-mutations.ts` and related sync/reload UI patterns.

## Build and Test
- Use `npm run dev` for local development. The dev server runs on port `9004`.
- Validate changes with `npm run lint`, `npm run test`, and `npm run build` as appropriate for the slice you touched.
- When changing shared dashboard, auth, offline, or route-handler behavior, prefer ending with `npm run build` because this repo relies heavily on integration across App Router pages and API routes.

## Conventions
- Follow the explicit data-context pattern already used in the repo. Good reference files include `src/hooks/use-rounds-context.ts`, `src/hooks/use-supervision-context.ts`, and `src/app/api/supervision/context/route.ts`.
- Keep read and write contracts explicit. Existing route handlers often include compatibility fallbacks for optional or legacy Supabase columns; preserve that approach when touching production-facing queries.
- L1 officer workflows are the highest-priority UX path. Optimize for low-friction, mobile-friendly, offline-tolerant flows, especially in rounds and station features.
- Keep authorization logic strict and readable. Scope rules are defense-in-depth between app code and Supabase RLS, not one or the other.
- If a task needs schema or policy changes, add or update SQL files under `supabase/` and do not assume those scripts are applied automatically from this workspace.

## Docs
- Link to `docs/PRODUCTION_SMOKE_CHECKLIST_L1_L4.md` for post-deploy validation instead of re-embedding that checklist.
- Link to `docs/SUPABASE_INCIDENT_RUNBOOK.md` for auth, RLS, and schema incident handling.
- Link to `README.md` for deployment, environment-variable, and hosting context.