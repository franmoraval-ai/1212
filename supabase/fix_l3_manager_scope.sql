-- Endurece alcance L3 para auditorías gerenciales y normaliza políticas del catálogo.

drop policy if exists management_audits_select_manager on public.management_audits;
drop policy if exists management_audits_insert_manager on public.management_audits;
drop policy if exists management_audits_update_manager on public.management_audits;
drop policy if exists management_audits_delete_manager on public.management_audits;

create policy management_audits_select_manager on public.management_audits
for select to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_matches_current_user(manager_id)
    or public.app_matches_assigned_scope(post_name)
    or public.app_matches_assigned_scope(operation_name)
  )
);

create policy management_audits_insert_manager on public.management_audits
for insert to authenticated
with check (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_matches_current_user(manager_id)
  )
);

create policy management_audits_update_manager on public.management_audits
for update to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_matches_current_user(manager_id)
    or public.app_matches_assigned_scope(post_name)
    or public.app_matches_assigned_scope(operation_name)
  )
)
with check (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_matches_current_user(manager_id)
    or public.app_matches_assigned_scope(post_name)
    or public.app_matches_assigned_scope(operation_name)
  )
);

create policy management_audits_delete_manager on public.management_audits
for delete to authenticated
using (
  public.app_is_active_user()
  and (
    public.app_is_role(4)
    or public.app_matches_current_user(manager_id)
    or public.app_matches_assigned_scope(post_name)
    or public.app_matches_assigned_scope(operation_name)
  )
);

drop policy if exists operation_catalog_select_authenticated on public.operation_catalog;
drop policy if exists operation_catalog_insert_authenticated on public.operation_catalog;
drop policy if exists operation_catalog_update_authenticated on public.operation_catalog;
drop policy if exists operation_catalog_delete_authenticated on public.operation_catalog;

create policy operation_catalog_select_authenticated
on public.operation_catalog
for select to authenticated
using (public.app_is_active_user());

create policy operation_catalog_insert_authenticated
on public.operation_catalog
for insert to authenticated
with check (public.app_is_active_user() and public.app_is_role(3));

create policy operation_catalog_update_authenticated
on public.operation_catalog
for update to authenticated
using (public.app_is_active_user() and public.app_is_role(3))
with check (public.app_is_active_user() and public.app_is_role(3));

create policy operation_catalog_delete_authenticated
on public.operation_catalog
for delete to authenticated
using (public.app_is_active_user() and public.app_is_role(3));