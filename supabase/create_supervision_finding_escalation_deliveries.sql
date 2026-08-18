-- Persistent, service-role-only delivery ledger for overdue finding escalations.

create extension if not exists pgcrypto;

create table if not exists public.supervision_finding_escalation_deliveries (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.supervision_findings(id) on delete cascade,
  responsible_user_id uuid not null references public.users(id) on delete cascade,
  recipient_user_id uuid not null references public.users(id) on delete cascade,
  escalation_level text not null check (escalation_level in ('L3', 'L4')),
  escalation_reason text not null check (escalation_reason in ('L3_MANAGER', 'L4_NO_MANAGER', 'L4_48_HOURS')),
  due_at_snapshot timestamptz not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'SENT', 'RETRY', 'DEAD')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claim_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (finding_id, responsible_user_id, recipient_user_id, escalation_level, due_at_snapshot)
);

create index if not exists idx_supervision_finding_escalation_retry
  on public.supervision_finding_escalation_deliveries (status, next_attempt_at, lease_expires_at, created_at);

alter table public.supervision_finding_escalation_deliveries enable row level security;

create or replace function public.claim_supervision_finding_escalations(
  p_now timestamptz default now(),
  p_limit integer default 100,
  p_lease_minutes integer default 10,
  p_max_attempts integer default 5,
  p_l4_after_hours integer default 48
)
returns table (
  delivery_id uuid,
  claim_token uuid,
  finding_id uuid,
  responsible_user_id uuid,
  recipient_user_id uuid,
  escalation_level text,
  escalation_reason text,
  attempt_count integer
)
language plpgsql
volatile
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  max_attempts integer := greatest(1, least(coalesce(p_max_attempts, 5), 20));
  l4_after_hours integer := greatest(1, least(coalesce(p_l4_after_hours, 48), 720));
begin
  update public.supervision_finding_escalation_deliveries delivery
  set
    status = 'DEAD',
    claim_token = null,
    claimed_at = null,
    lease_expires_at = null,
    last_error = 'escalation_no_longer_eligible',
    updated_at = p_now
  where delivery.status in ('PENDING', 'PROCESSING', 'RETRY')
    and not exists (
      select 1
      from public.supervision_findings finding
      join public.users responsible on responsible.id = finding.responsible_user_id
      join public.users recipient on recipient.id = delivery.recipient_user_id
      left join public.users manager
        on manager.id = responsible.manager_user_id
        and manager.role_level = 3
        and lower(coalesce(manager.status, '')) in ('activo', 'active')
      where finding.id = delivery.finding_id
        and finding.status <> 'CERRADO'
        and finding.responsible_user_id = delivery.responsible_user_id
        and finding.due_at = delivery.due_at_snapshot
        and finding.due_at < p_now
        and lower(coalesce(recipient.status, '')) in ('activo', 'active')
        and (
          (
            delivery.escalation_level = 'L3'
            and responsible.role_level = 2
            and manager.id = delivery.recipient_user_id
          )
          or (
            delivery.escalation_level = 'L4'
            and recipient.role_level >= 4
            and (
              finding.due_at + make_interval(hours => l4_after_hours) <= p_now
              or (responsible.role_level = 2 and manager.id is null)
            )
          )
        )
    );

  update public.supervision_finding_escalation_deliveries delivery
  set
    status = case when delivery.attempt_count >= max_attempts then 'DEAD' else 'RETRY' end,
    claim_token = null,
    claimed_at = null,
    lease_expires_at = null,
    next_attempt_at = case
      when delivery.attempt_count >= max_attempts then p_now
      else p_now + make_interval(mins => least(360, 15 * power(2, least(greatest(delivery.attempt_count - 1, 0), 4))::integer))
    end,
    last_error = 'claim_lease_expired',
    updated_at = p_now
  where delivery.status = 'PROCESSING'
    and delivery.lease_expires_at <= p_now;

  insert into public.supervision_finding_escalation_deliveries (
    finding_id,
    responsible_user_id,
    recipient_user_id,
    escalation_level,
    escalation_reason,
    due_at_snapshot,
    status,
    next_attempt_at
  )
  select
    finding.id,
    responsible.id,
    manager.id,
    'L3',
    'L3_MANAGER',
    finding.due_at,
    'PENDING',
    p_now
  from public.supervision_findings finding
  join public.users responsible
    on responsible.id = finding.responsible_user_id
    and responsible.role_level = 2
  join public.users manager
    on manager.id = responsible.manager_user_id
    and manager.role_level = 3
    and lower(coalesce(manager.status, '')) in ('activo', 'active')
  where finding.status <> 'CERRADO'
    and finding.due_at is not null
    and finding.due_at < p_now
  on conflict (finding_id, responsible_user_id, recipient_user_id, escalation_level, due_at_snapshot)
  do nothing;

  insert into public.supervision_finding_escalation_deliveries (
    finding_id,
    responsible_user_id,
    recipient_user_id,
    escalation_level,
    escalation_reason,
    due_at_snapshot,
    status,
    next_attempt_at
  )
  select
    finding.id,
    responsible.id,
    director.id,
    'L4',
    case when responsible.role_level = 2 and manager.id is null then 'L4_NO_MANAGER' else 'L4_48_HOURS' end,
    finding.due_at,
    'PENDING',
    p_now
  from public.supervision_findings finding
  join public.users responsible on responsible.id = finding.responsible_user_id
  cross join public.users director
  left join public.users manager
    on manager.id = responsible.manager_user_id
    and manager.role_level = 3
    and lower(coalesce(manager.status, '')) in ('activo', 'active')
  where finding.status <> 'CERRADO'
    and finding.due_at is not null
    and finding.due_at < p_now
    and director.role_level >= 4
    and lower(coalesce(director.status, '')) in ('activo', 'active')
    and (
      finding.due_at + make_interval(hours => l4_after_hours) <= p_now
      or (responsible.role_level = 2 and manager.id is null)
    )
  on conflict (finding_id, responsible_user_id, recipient_user_id, escalation_level, due_at_snapshot)
  do nothing;

  return query
  with candidates as (
    select delivery.id
    from public.supervision_finding_escalation_deliveries delivery
    where delivery.status in ('PENDING', 'RETRY')
      and delivery.next_attempt_at <= p_now
      and delivery.attempt_count < max_attempts
    order by delivery.next_attempt_at asc, delivery.created_at asc, delivery.id asc
    for update of delivery skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ), claimed as (
    update public.supervision_finding_escalation_deliveries delivery
    set
      status = 'PROCESSING',
      attempt_count = delivery.attempt_count + 1,
      claim_token = gen_random_uuid(),
      claimed_at = p_now,
      lease_expires_at = p_now + make_interval(mins => greatest(1, least(coalesce(p_lease_minutes, 10), 60))),
      last_error = null,
      updated_at = p_now
    from candidates
    where delivery.id = candidates.id
    returning
      delivery.id,
      delivery.claim_token,
      delivery.finding_id,
      delivery.responsible_user_id,
      delivery.recipient_user_id,
      delivery.escalation_level,
      delivery.escalation_reason,
      delivery.attempt_count
  )
  select
    claimed.id,
    claimed.claim_token,
    claimed.finding_id,
    claimed.responsible_user_id,
    claimed.recipient_user_id,
    claimed.escalation_level,
    claimed.escalation_reason,
    claimed.attempt_count
  from claimed;
end;
$$;

create or replace function public.complete_supervision_finding_escalation(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_delivered boolean,
  p_error text default null,
  p_max_attempts integer default 5,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  affected integer;
begin
  update public.supervision_finding_escalation_deliveries
  set
    status = case
      when p_delivered then 'SENT'
      when attempt_count >= greatest(1, coalesce(p_max_attempts, 5)) then 'DEAD'
      else 'RETRY'
    end,
    delivered_at = case when p_delivered then p_now else null end,
    next_attempt_at = case
      when p_delivered or attempt_count >= greatest(1, coalesce(p_max_attempts, 5)) then p_now
      else p_now + make_interval(mins => least(360, 15 * power(2, least(greatest(attempt_count - 1, 0), 4))::integer))
    end,
    claim_token = null,
    claimed_at = null,
    lease_expires_at = null,
    last_error = case when p_delivered then null else left(coalesce(nullif(trim(p_error), ''), 'delivery_failed'), 500) end,
    updated_at = p_now
  where id = p_delivery_id
    and claim_token = p_claim_token
    and status = 'PROCESSING';

  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on table public.supervision_finding_escalation_deliveries from public, anon, authenticated;
grant select, insert, update, delete on table public.supervision_finding_escalation_deliveries to service_role;

revoke execute on function public.claim_supervision_finding_escalations(timestamptz, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_supervision_finding_escalations(timestamptz, integer, integer, integer, integer) to service_role;

revoke execute on function public.complete_supervision_finding_escalation(uuid, uuid, boolean, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_supervision_finding_escalation(uuid, uuid, boolean, text, integer, timestamptz) to service_role;

comment on table public.supervision_finding_escalation_deliveries is
  'Mutable service-role delivery ledger for deduplicated overdue finding escalations.';
