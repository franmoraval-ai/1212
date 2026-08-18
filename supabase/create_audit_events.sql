-- Bitacora de acciones administrativas sensibles. Solo el servidor con service role inserta eventos.
create extension if not exists pgcrypto;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id text not null,
  actor_email text not null,
  actor_role_level integer not null,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  source_path text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_created_at on public.audit_events (created_at desc);
create index if not exists idx_audit_events_actor_created_at on public.audit_events (actor_user_id, created_at desc);
create index if not exists idx_audit_events_resource_created_at on public.audit_events (resource_type, resource_id, created_at desc);

alter table public.audit_events enable row level security;

-- There are deliberately no authenticated-table policies: reads are served by an L4 API and writes by the server only.
create or replace function public.prevent_audit_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events are append-only';
end;
$$;

drop trigger if exists audit_events_append_only on public.audit_events;
create trigger audit_events_append_only
before update or delete on public.audit_events
for each row execute function public.prevent_audit_event_mutation();