alter table public.users
  add column if not exists manager_user_id uuid references public.users(id) on delete set null;

create index if not exists idx_users_manager_user_id
  on public.users (manager_user_id);