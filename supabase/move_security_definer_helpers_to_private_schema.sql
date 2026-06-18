-- Phase 2 hardening for SECURITY DEFINER helper functions used by RLS.
--
-- Goal:
-- - Keep RLS behavior intact.
-- - Remove SECURITY DEFINER from public RPC surface.
--
-- Strategy:
-- 1) Move privileged logic to app_private.* (SECURITY DEFINER).
-- 2) Keep public.app_* as SECURITY INVOKER wrappers.
-- 3) Restrict EXECUTE grants explicitly.

create schema if not exists app_private;

revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;
grant usage on schema app_private to service_role;

create or replace function app_private.app_current_email()
returns text
language sql
stable
security definer
set search_path = public, app_private
as $$
  select lower(coalesce((select auth.jwt()) ->> 'email', ''));
$$;

create or replace function app_private.app_current_uid()
returns text
language sql
stable
security definer
set search_path = public, app_private
as $$
  select coalesce((select auth.uid())::text, '');
$$;

create or replace function app_private.app_current_role_level()
returns int
language sql
stable
security definer
set search_path = public, app_private
as $$
  select coalesce((
    select u.role_level
    from public.users u
    where lower(coalesce(u.email, '')) = app_private.app_current_email()
    limit 1
  ), 1);
$$;

create or replace function app_private.app_current_permissions()
returns text[]
language sql
stable
security definer
set search_path = public, app_private
as $$
  select coalesce((
    select u.custom_permissions
    from public.users u
    where lower(coalesce(u.email, '')) = app_private.app_current_email()
    limit 1
  ), '{}'::text[]);
$$;

create or replace function app_private.app_current_status()
returns text
language sql
stable
security definer
set search_path = public, app_private
as $$
  select lower(trim(coalesce((
    select u.status
    from public.users u
    where lower(coalesce(u.email, '')) = app_private.app_current_email()
    limit 1
  ), 'active')));
$$;

create or replace function app_private.app_is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select (select auth.role()) = 'authenticated'
    and app_private.app_current_status() in ('active', 'activo');
$$;

create or replace function app_private.app_is_role(min_role integer)
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select app_private.app_current_role_level() >= min_role;
$$;

create or replace function app_private.app_has_permission(permission text)
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select coalesce(permission = any(app_private.app_current_permissions()), false);
$$;

create or replace function app_private.app_matches_current_user(value text)
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select lower(trim(coalesce(value, ''))) in (app_private.app_current_uid(), app_private.app_current_email());
$$;

create or replace function app_private.app_normalize_scope_text(value text)
returns text
language sql
immutable
security definer
set search_path = public, app_private
as $$
  select regexp_replace(
    lower(trim(coalesce(value, ''))),
    '[^a-z0-9]+',
    ' ',
    'g'
  );
$$;

create or replace function app_private.app_matches_assigned_scope(value text)
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  with current_scope as (
    select
      app_private.app_normalize_scope_text(u.assigned) as assigned_scope,
      app_private.app_normalize_scope_text(split_part(coalesce(u.assigned, ''), '|', 1)) as operation_scope,
      app_private.app_normalize_scope_text(split_part(coalesce(u.assigned, ''), '|', 2)) as post_scope
    from public.users u
    where lower(coalesce(u.email, '')) = app_private.app_current_email()
    limit 1
  ),
  candidate as (
    select app_private.app_normalize_scope_text(value) as candidate_scope
  )
  select exists (
    select 1
    from current_scope, candidate
    where candidate.candidate_scope <> ''
      and (
        candidate.candidate_scope = current_scope.assigned_scope
        or candidate.candidate_scope = current_scope.operation_scope
        or candidate.candidate_scope = current_scope.post_scope
        or (
          current_scope.operation_scope <> ''
          and current_scope.post_scope <> ''
          and position(current_scope.operation_scope in candidate.candidate_scope) > 0
          and position(current_scope.post_scope in candidate.candidate_scope) > 0
        )
      )
  );
$$;

create or replace function app_private.app_can_access_round_session(target_session_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, app_private
as $$
begin
  if to_regclass('public.round_sessions') is null then
    return false;
  end if;

  return app_private.app_is_active_user()
    and exists (
      select 1
      from public.round_sessions rs
      where rs.id = target_session_id
        and (
          app_private.app_is_role(4)
          or app_private.app_has_permission('supervision_grouped_view')
          or app_private.app_matches_current_user(rs.officer_id)
          or app_private.app_matches_current_user(rs.supervisor_id)
          or app_private.app_matches_assigned_scope(rs.post_name)
          or app_private.app_matches_assigned_scope(rs.round_name)
        )
    );
end;
$$;

create or replace function app_private.app_can_manage_round_session(target_session_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, app_private
as $$
begin
  if to_regclass('public.round_sessions') is null then
    return false;
  end if;

  return app_private.app_is_active_user()
    and exists (
      select 1
      from public.round_sessions rs
      where rs.id = target_session_id
        and (
          app_private.app_is_role(4)
          or app_private.app_matches_current_user(rs.officer_id)
          or app_private.app_matches_current_user(rs.supervisor_id)
        )
    );
end;
$$;

-- Public wrappers remain for backward compatibility in RLS expressions and SQL scripts,
-- but now run as SECURITY INVOKER to avoid exposed SECURITY DEFINER RPC surface.

create or replace function public.app_current_email()
returns text
language sql
stable
security invoker
set search_path = public, app_private
as $$
  select app_private.app_current_email();
$$;

create or replace function public.app_current_uid()
returns text
language sql
stable
security invoker
set search_path = public, app_private
as $$
  select app_private.app_current_uid();
$$;

create or replace function public.app_current_role_level()
returns int
language sql
stable
security invoker
set search_path = public, app_private
as $$
  select app_private.app_current_role_level();
$$;

create or replace function public.app_current_permissions()
returns text[]
language sql
stable
security invoker
set search_path = public, app_private
as $$
  select app_private.app_current_permissions();
$$;

create or replace function public.app_current_status()
returns text
language sql
stable
security invoker
set search_path = public, app_private
as $$
  select app_private.app_current_status();
$$;

create or replace function public.app_is_active_user()
returns boolean
language sql
stable
security invoker
set search_path = public, app_private
as $$
  select app_private.app_is_active_user();
$$;

create or replace function public.app_is_role(min_role integer)
returns boolean
language sql
stable
security invoker
set search_path = public, app_private
as $$
  select app_private.app_is_role(min_role);
$$;

create or replace function public.app_has_permission(permission text)
returns boolean
language sql
stable
security invoker
set search_path = public, app_private
as $$
  select app_private.app_has_permission(permission);
$$;

create or replace function public.app_matches_current_user(value text)
returns boolean
language sql
stable
security invoker
set search_path = public, app_private
as $$
  select app_private.app_matches_current_user(value);
$$;

create or replace function public.app_matches_assigned_scope(value text)
returns boolean
language sql
stable
security invoker
set search_path = public, app_private
as $$
  select app_private.app_matches_assigned_scope(value);
$$;

create or replace function public.app_can_access_round_session(target_session_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, app_private
as $$
  select app_private.app_can_access_round_session(target_session_id);
$$;

create or replace function public.app_can_manage_round_session(target_session_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, app_private
as $$
  select app_private.app_can_manage_round_session(target_session_id);
$$;

-- Restrict execution grants explicitly.
do $$
declare
  fn_name text;
begin
  foreach fn_name in array array[
    'app_private.app_can_access_round_session(uuid)',
    'app_private.app_can_manage_round_session(uuid)',
    'app_private.app_current_email()',
    'app_private.app_current_permissions()',
    'app_private.app_current_role_level()',
    'app_private.app_current_status()',
    'app_private.app_current_uid()',
    'app_private.app_has_permission(text)',
    'app_private.app_is_active_user()',
    'app_private.app_is_role(integer)',
    'app_private.app_matches_assigned_scope(text)',
    'app_private.app_matches_current_user(text)',
    'app_private.app_normalize_scope_text(text)',
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
