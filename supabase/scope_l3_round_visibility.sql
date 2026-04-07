-- Rounds definitions visibility: keep SELECT open for all active users.
-- Round definitions are operational templates, not sensitive data.
-- Scope filtering for L2/L3 is handled at the application layer
-- (prioritizedRounds + scopedReports in rounds/page.tsx) using
-- authorizedOperations from station_officer_authorizations.
-- This avoids expensive per-row RLS subqueries that cause timeouts.

-- Ensure the old wide-open policy exists (idempotent)
drop policy if exists rounds_select_scoped on public.rounds;
drop policy if exists rounds_select_authenticated on public.rounds;

create policy rounds_select_authenticated on public.rounds
for select to authenticated
using (
  public.app_is_active_user()
);

-- Insert/update/delete remain L4-only (unchanged).
