-- L3 scope: scope rounds definitions SELECT by assigned scope.
-- Previously ALL authenticated users could see ALL round definitions.
-- After this migration:
--   • L4 sees all rounds
--   • Users with rounds_access permission see all rounds
--   • L1/L2/L3 see rounds whose post or name matches their assigned scope
-- This aligns rounds definitions visibility with the existing
-- round_reports and round_sessions scoping model.

drop policy if exists rounds_select_authenticated on public.rounds;
drop policy if exists rounds_select_scoped on public.rounds;

create policy rounds_select_scoped on public.rounds
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_has_permission('rounds_access')
    or public.app_matches_assigned_scope(post)
    or public.app_matches_assigned_scope(name)
  )
);

-- Insert/update/delete remain L4-only (unchanged).
