-- Restrict SECURITY DEFINER helper exposure from anon/public RPC execution.
--
-- Why this migration exists:
-- - Supabase linter flags these helpers because they are SECURITY DEFINER functions
--   in the public schema with default EXECUTE privileges.
-- - These helpers are used by RLS policies, so authenticated must keep EXECUTE.
--
-- What this migration does:
-- - REVOKE EXECUTE from PUBLIC (this removes anon access).
-- - GRANT EXECUTE explicitly to authenticated and service_role.
--
-- Note:
-- - This mitigates anon exposure warnings immediately.
-- - To eliminate authenticated external warnings, move helpers to a non-exposed schema
--   and update policies accordingly.

do $$
declare
  fn_name text;
begin
  foreach fn_name in array array[
    'public.app_can_access_round_session(uuid)',
    'public.app_can_manage_round_session(uuid)',
    'public.app_current_email()',
    'public.app_current_permissions()',
    'public.app_current_role_level()',
    'public.app_current_status()',
    'public.app_current_uid()',
    'public.app_has_permission(text)',
    'public.app_is_active_user()',
    'public.app_is_role(integer)',
    'public.app_matches_assigned_scope(text)',
    'public.app_matches_current_user(text)'
  ]
  loop
    if to_regprocedure(fn_name) is not null then
      execute format('revoke execute on function %s from public', fn_name);
      execute format('grant execute on function %s to authenticated', fn_name);
      execute format('grant execute on function %s to service_role', fn_name);
    end if;
  end loop;
end
$$;
