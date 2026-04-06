create or replace function public.app_normalize_scope_text(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
    lower(trim(coalesce(value, ''))),
    '[^a-z0-9]+',
    ' ',
    'g'
  );
$$;

create or replace function public.app_matches_assigned_scope(value text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with current_scope as (
    select
      public.app_normalize_scope_text(u.assigned) as assigned_scope,
      public.app_normalize_scope_text(split_part(coalesce(u.assigned, ''), '|', 1)) as operation_scope,
      public.app_normalize_scope_text(split_part(coalesce(u.assigned, ''), '|', 2)) as post_scope
    from public.users u
    where lower(coalesce(u.email, '')) = public.app_current_email()
    limit 1
  ),
  candidate as (
    select public.app_normalize_scope_text(value) as candidate_scope
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