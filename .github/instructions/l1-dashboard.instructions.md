---
description: "Use when working on L1 officer UX, rounds, station, shift-book, incidents report, offline sync, or mobile dashboard flows. Covers low-friction post workflows, station context, and offline-first behavior."
name: "L1 Dashboard Flows"
applyTo:
  - "src/app/(dashboard)/rounds/**"
  - "src/app/(dashboard)/station/**"
  - "src/app/(dashboard)/shift-book/**"
  - "src/app/(dashboard)/incidents/report/**"
  - "src/components/offline/**"
  - "src/components/layout/station-shift-provider.tsx"
  - "src/hooks/use-rounds-context.ts"
  - "src/hooks/use-station-workspace-data.ts"
  - "src/app/api/rounds/**"
  - "src/app/api/station/**"
  - "src/app/api/shifts/**"
---
# L1 Dashboard Guidelines

- Optimize for L1 first: fast task completion, low cognitive load, and reliable mobile use while on shift.
- Preserve the current station-context model. Use station/profile/authorization helpers instead of reviving UI fallbacks to `users.assigned`.
- Keep offline behavior explicit. If a write can fail offline, make sure queueing, retry, reload, and user feedback still make sense.
- Favor the existing context pattern: dashboard page -> hook -> internal API route -> shared lib helper.
- Avoid adding extra confirmation steps, heavy forms, or desktop-only interactions in rounds and station flows unless there is a clear safety reason.
- When changing L1 flows, check for side effects in rounds history, quick actions, station workspace summaries, and shift handoff behavior.
- For post-deploy validation, link the operator to [docs/PRODUCTION_SMOKE_CHECKLIST_L1_L4.md](../../docs/PRODUCTION_SMOKE_CHECKLIST_L1_L4.md) instead of copying the checklist.