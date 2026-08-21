-- Stable L2/L3 responsibility for internal station notes.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.internal_notes
  add column if not exists assigned_to_user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'internal_notes_assigned_to_user_id_fkey'
      and conrelid = 'public.internal_notes'::regclass
  ) then
    alter table public.internal_notes
      add constraint internal_notes_assigned_to_user_id_fkey
      foreign key (assigned_to_user_id)
      references public.users(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists idx_internal_notes_assignee_status_created
  on public.internal_notes (assigned_to_user_id, status, created_at desc)
  where assigned_to_user_id is not null;

alter table public.internal_notes enable row level security;

drop policy if exists internal_notes_select_scoped on public.internal_notes;
create policy internal_notes_select_scoped
  on public.internal_notes
  for select
  to authenticated
  using (
    public.app_is_active_user()
    and (
      public.app_is_role(2)
      or public.app_matches_current_user(reported_by_user_id)
      or public.app_matches_current_user(reported_by_email)
      or public.app_matches_current_user(assigned_to_user_id::text)
      or public.app_matches_assigned_scope(post_name)
    )
  );

comment on column public.internal_notes.assigned_to_user_id is
  'Stable UUID of the active L2/L3 responsible for the note; assigned_to remains a historical name snapshot.';

commit;
