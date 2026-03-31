-- Endurece el alcance L2 para supervisiones y boletas de ronda.
-- La UI ya filtra por propio/asignado; esta migración alinea RLS con ese comportamiento.

drop policy if exists supervisions_select_scoped on public.supervisions;
create policy supervisions_select_scoped on public.supervisions
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_has_permission('supervision_grouped_view')
    or public.app_matches_current_user(supervisor_id)
    or public.app_matches_assigned_scope(review_post)
    or public.app_matches_assigned_scope(operation_name)
  )
);

drop policy if exists round_reports_select_scoped on public.round_reports;
create policy round_reports_select_scoped on public.round_reports
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_has_permission('supervision_grouped_view')
    or public.app_matches_current_user(officer_id)
    or public.app_matches_assigned_scope(post_name)
    or public.app_matches_assigned_scope(round_name)
  )
);