drop policy if exists supervisions_select_scoped on public.supervisions;

create policy supervisions_select_scoped on public.supervisions
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_has_permission('supervision_grouped_view')
    or public.app_matches_current_user(supervisor_id)
    or public.app_matches_assigned_scope(review_post)
    or public.app_matches_assigned_scope(operation_name)
  )
);