create or replace function public.app_can_access_round_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_is_active_user()
    and exists (
      select 1
      from public.round_sessions rs
      where rs.id = target_session_id
        and (
          public.app_is_role(4)
          or public.app_has_permission('supervision_grouped_view')
          or public.app_matches_current_user(rs.officer_id)
          or public.app_matches_current_user(rs.supervisor_id)
          or public.app_matches_assigned_scope(rs.post_name)
          or public.app_matches_assigned_scope(rs.round_name)
        )
    );
$$;

create or replace function public.app_can_manage_round_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_is_active_user()
    and exists (
      select 1
      from public.round_sessions rs
      where rs.id = target_session_id
        and (
          public.app_is_role(4)
          or public.app_matches_current_user(rs.officer_id)
          or public.app_matches_current_user(rs.supervisor_id)
        )
    );
$$;

drop policy if exists round_sessions_select_scoped on public.round_sessions;
drop policy if exists round_sessions_update_scoped on public.round_sessions;
drop policy if exists round_checkpoint_events_select_scoped on public.round_checkpoint_events;
drop policy if exists round_checkpoint_events_insert_scoped on public.round_checkpoint_events;

create policy round_sessions_select_scoped on public.round_sessions
for select to authenticated
using (public.app_can_access_round_session(id));

create policy round_sessions_update_scoped on public.round_sessions
for update to authenticated
using (public.app_can_manage_round_session(id))
with check (public.app_can_manage_round_session(id));

create policy round_checkpoint_events_select_scoped on public.round_checkpoint_events
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_can_access_round_session(session_id)
  )
);

create policy round_checkpoint_events_insert_scoped on public.round_checkpoint_events
for insert to authenticated
with check (
  public.app_is_active_user()
  and public.app_can_manage_round_session(session_id)
);