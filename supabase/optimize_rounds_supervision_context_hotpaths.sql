-- Purpose: reduce latency on rounds/supervision context endpoints under production load.
-- Scope: supporting indexes for query patterns used in App Router API handlers.
-- Note: SQL files in this repo are not auto-applied; run manually in Supabase SQL Editor.

create index if not exists idx_round_security_config_updated_at_desc
  on public.round_security_config (updated_at desc);

create index if not exists idx_station_officer_authorizations_officer_active_window
  on public.station_officer_authorizations (officer_user_id, is_active, valid_to, valid_from);

create index if not exists idx_users_manager_scope_status_role
  on public.users (manager_user_id, status, role_level);

create index if not exists idx_operation_catalog_active_operation_name
  on public.operation_catalog (is_active, operation_name);

analyze public.round_security_config;
analyze public.station_officer_authorizations;
analyze public.users;
analyze public.operation_catalog;
