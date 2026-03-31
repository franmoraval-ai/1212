-- Añade identidad fuerte al reportante de incidentes y limita alcance de incidents/internal_notes.

alter table if exists public.incidents add column if not exists lugar text;
alter table if exists public.incidents add column if not exists reported_by_user_id text;
alter table if exists public.incidents add column if not exists reported_by_email text;

drop policy if exists incidents_select_authenticated on public.incidents;
drop policy if exists incidents_insert_authenticated on public.incidents;
drop policy if exists incidents_update_supervisor on public.incidents;
drop policy if exists incidents_delete_supervisor on public.incidents;

create policy incidents_select_authenticated on public.incidents
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(3)
    or public.app_matches_current_user(reported_by_user_id)
    or public.app_matches_current_user(reported_by_email)
    or public.app_matches_assigned_scope(location)
    or public.app_matches_assigned_scope(lugar)
  )
);

create policy incidents_insert_authenticated on public.incidents
for insert to authenticated
with check (
  public.app_is_active_user()
  and (
    public.app_matches_current_user(reported_by_user_id)
    or public.app_matches_current_user(reported_by_email)
  )
);

create policy incidents_update_supervisor on public.incidents
for update to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(3)
    or (
      public.app_is_role(2)
      and (
        public.app_matches_current_user(reported_by_user_id)
        or public.app_matches_current_user(reported_by_email)
        or public.app_matches_assigned_scope(location)
        or public.app_matches_assigned_scope(lugar)
      )
    )
  )
)
with check (
  public.app_is_active_user()
  and (
    public.app_is_role(3)
    or (
      public.app_is_role(2)
      and (
        public.app_matches_current_user(reported_by_user_id)
        or public.app_matches_current_user(reported_by_email)
        or public.app_matches_assigned_scope(location)
        or public.app_matches_assigned_scope(lugar)
      )
    )
  )
);

create policy incidents_delete_supervisor on public.incidents
for delete to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(3)
    or (
      public.app_is_role(2)
      and (
        public.app_matches_current_user(reported_by_user_id)
        or public.app_matches_current_user(reported_by_email)
        or public.app_matches_assigned_scope(location)
        or public.app_matches_assigned_scope(lugar)
      )
    )
  )
);

drop policy if exists internal_notes_update_supervisor on public.internal_notes;
drop policy if exists internal_notes_delete_supervisor on public.internal_notes;

create policy internal_notes_update_supervisor on public.internal_notes
for update to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(3)
    or (
      public.app_is_role(2)
      and (
        public.app_matches_current_user(reported_by_user_id)
        or public.app_matches_current_user(reported_by_email)
        or public.app_matches_assigned_scope(post_name)
      )
    )
  )
)
with check (
  public.app_is_active_user()
  and (
    public.app_is_role(3)
    or (
      public.app_is_role(2)
      and (
        public.app_matches_current_user(reported_by_user_id)
        or public.app_matches_current_user(reported_by_email)
        or public.app_matches_assigned_scope(post_name)
      )
    )
  )
);

create policy internal_notes_delete_supervisor on public.internal_notes
for delete to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(3)
    or (
      public.app_is_role(2)
      and (
        public.app_matches_current_user(reported_by_user_id)
        or public.app_matches_current_user(reported_by_email)
        or public.app_matches_assigned_scope(post_name)
      )
    )
  )
);