-- L3 scope: scope rounds definitions SELECT by authorized operations.
-- Previously ALL authenticated users could see ALL round definitions.
-- After this migration:
--   • L4 sees all rounds
--   • Users with rounds_access permission see all rounds
--   • Other users see rounds whose post or name matches an operation
--     they are authorized for via station_officer_authorizations + operation_catalog
--   • Fallback: users whose assigned field matches (legacy compat)
-- This uses the explicit authorization table instead of text-parsing assigned.

drop policy if exists rounds_select_authenticated on public.rounds;
drop policy if exists rounds_select_scoped on public.rounds;

create policy rounds_select_scoped on public.rounds
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_has_permission('rounds_access')
    or exists (
      select 1
      from public.station_officer_authorizations soa
      join public.operation_catalog oc on oc.id = soa.operation_catalog_id
      where soa.officer_user_id = auth.uid()
        and soa.is_active = true
        and (soa.valid_from is null or soa.valid_from <= now())
        and (soa.valid_to   is null or soa.valid_to   >= now())
        and (
          lower(trim(oc.client_name))    = lower(trim(rounds.post))
          or lower(trim(oc.operation_name)) = lower(trim(rounds.post))
          or lower(trim(oc.operation_name)) = lower(trim(rounds.name))
        )
    )
    or public.app_matches_assigned_scope(post)
    or public.app_matches_assigned_scope(name)
  )
);

-- Insert/update/delete remain L4-only (unchanged).
