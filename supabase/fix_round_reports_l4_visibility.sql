drop policy if exists round_reports_select_scoped on public.round_reports;

create policy round_reports_select_scoped on public.round_reports
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_has_permission('supervision_grouped_view')
    or public.app_matches_current_user(officer_id)
    or public.app_matches_assigned_scope(post_name)
    or public.app_matches_assigned_scope(round_name)
  )
);