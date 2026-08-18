-- Delivery ledger and atomic claim functions for supervision finding reminders.
-- All access is service-role only through server routes.

create extension if not exists pgcrypto;

create table if not exists public.supervision_finding_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.supervision_findings(id) on delete cascade,
  responsible_user_id uuid not null references public.users(id) on delete cascade,
  reminder_kind text not null check (reminder_kind in ('DUE_SOON', 'OVERDUE')),
  reminder_date date not null,
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
  unique (finding_id, responsible_user_id, reminder_kind, reminder_date, due_at_snapshot)
);

create index if not exists idx_supervision_finding_delivery_retry
  on public.supervision_finding_notification_deliveries (status, next_attempt_at, lease_expires_at, created_at);

alter table public.supervision_finding_notification_deliveries enable row level security;

create or replace function public.claim_supervision_finding_reminders(
  p_now timestamptz default now(),
  p_limit integer default 100,
  p_lease_minutes integer default 10,
  p_max_attempts integer default 5
)
returns table (
  delivery_id uuid,
  claim_token uuid,
  finding_id uuid,
  responsible_user_id uuid,
  reminder_kind text,
  category text,
  severity text,
  due_at timestamptz,
  operation_name text,
  review_post text,
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
begin
  update public.supervision_finding_notification_deliveries delivery
  set
    status = 'DEAD',
    claim_token = null,
    claimed_at = null,
    lease_expires_at = null,
    last_error = 'finding_no_longer_eligible',
    updated_at = p_now
  where delivery.status in ('PENDING', 'PROCESSING', 'RETRY')
    and not exists (
      select 1
      from public.supervision_findings finding
      where finding.id = delivery.finding_id
        and finding.status <> 'CERRADO'
        and finding.responsible_user_id = delivery.responsible_user_id
        and finding.due_at = delivery.due_at_snapshot
    );

  update public.supervision_finding_notification_deliveries delivery
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

  insert into public.supervision_finding_notification_deliveries (
    finding_id,
    responsible_user_id,
    reminder_kind,
    reminder_date,
    due_at_snapshot,
    status,
    next_attempt_at
  )
  select
    finding.id,
    finding.responsible_user_id,
    case when finding.due_at < p_now then 'OVERDUE' else 'DUE_SOON' end,
    (p_now at time zone 'UTC')::date,
    finding.due_at,
    'PENDING',
    p_now
  from public.supervision_findings finding
  where finding.status <> 'CERRADO'
    and finding.responsible_user_id is not null
    and finding.due_at is not null
    and finding.due_at <= p_now + interval '24 hours'
  on conflict (finding_id, responsible_user_id, reminder_kind, reminder_date, due_at_snapshot)
  do nothing;

  return query
  with candidates as (
    select delivery.id
    from public.supervision_finding_notification_deliveries delivery
    join public.supervision_findings finding
      on finding.id = delivery.finding_id
      and finding.status <> 'CERRADO'
      and finding.responsible_user_id = delivery.responsible_user_id
      and finding.due_at = delivery.due_at_snapshot
    where delivery.status in ('PENDING', 'RETRY')
      and delivery.next_attempt_at <= p_now
      and delivery.attempt_count < max_attempts
    order by delivery.next_attempt_at asc, delivery.created_at asc, delivery.id asc
    for update of delivery skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ), claimed as (
    update public.supervision_finding_notification_deliveries delivery
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
      delivery.reminder_kind,
      delivery.attempt_count
  )
  select
    claimed.id as delivery_id,
    claimed.claim_token,
    claimed.finding_id,
    claimed.responsible_user_id,
    claimed.reminder_kind,
    finding.category,
    finding.severity,
    finding.due_at,
    supervision.operation_name,
    supervision.review_post,
    claimed.attempt_count
  from claimed
  join public.supervision_findings finding on finding.id = claimed.finding_id
  join public.supervisions supervision on supervision.id = finding.supervision_id
  order by finding.due_at asc, finding.id asc;
end;
$$;

create or replace function public.complete_supervision_finding_reminder(
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
  update public.supervision_finding_notification_deliveries
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

revoke all on table public.supervision_finding_notification_deliveries from public, anon, authenticated;
grant select, insert, update, delete on table public.supervision_finding_notification_deliveries to service_role;

revoke execute on function public.claim_supervision_finding_reminders(timestamptz, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_supervision_finding_reminders(timestamptz, integer, integer, integer) to service_role;

revoke execute on function public.complete_supervision_finding_reminder(uuid, uuid, boolean, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_supervision_finding_reminder(uuid, uuid, boolean, text, integer, timestamptz) to service_role;

comment on table public.supervision_finding_notification_deliveries is
  'Mutable service-role delivery ledger for deduplicated supervision finding reminders.';
