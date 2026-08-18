-- Account-scoped L2 -> L3 hierarchy for finding escalation routing.

create table if not exists public.l2_account_manager_assignments (
  id uuid primary key default gen_random_uuid(),
  operation_catalog_id uuid not null references public.operation_catalog(id) on delete cascade,
  l2_user_id uuid not null references public.users(id) on delete cascade,
  l3_user_id uuid not null references public.users(id) on delete cascade,
  assigned_by_user_id uuid references public.users(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operation_catalog_id, l2_user_id),
  check (l2_user_id <> l3_user_id)
);

create index if not exists idx_l2_account_manager_l2_active
  on public.l2_account_manager_assignments (l2_user_id, is_active, operation_catalog_id);

create index if not exists idx_l2_account_manager_l3_active
  on public.l2_account_manager_assignments (l3_user_id, is_active, operation_catalog_id);

alter table public.l2_account_manager_assignments enable row level security;

drop policy if exists l2_account_manager_assignments_select_authenticated
  on public.l2_account_manager_assignments;
create policy l2_account_manager_assignments_select_authenticated
  on public.l2_account_manager_assignments
  for select
  to authenticated
  using (public.app_is_active_user());

drop policy if exists l2_account_manager_assignments_insert_l4
  on public.l2_account_manager_assignments;
create policy l2_account_manager_assignments_insert_l4
  on public.l2_account_manager_assignments
  for insert
  to authenticated
  with check (public.app_is_active_user() and public.app_is_role(4));

drop policy if exists l2_account_manager_assignments_update_l4
  on public.l2_account_manager_assignments;
create policy l2_account_manager_assignments_update_l4
  on public.l2_account_manager_assignments
  for update
  to authenticated
  using (public.app_is_active_user() and public.app_is_role(4))
  with check (public.app_is_active_user() and public.app_is_role(4));

drop policy if exists l2_account_manager_assignments_delete_l4
  on public.l2_account_manager_assignments;
create policy l2_account_manager_assignments_delete_l4
  on public.l2_account_manager_assignments
  for delete
  to authenticated
  using (public.app_is_active_user() and public.app_is_role(4));

-- Preserve any existing global L2 -> L3 hierarchy for accounts already authorized to that L2.
insert into public.l2_account_manager_assignments (
  operation_catalog_id,
  l2_user_id,
  l3_user_id,
  assigned_by_user_id,
  is_active
)
select
  station_auth.operation_catalog_id,
  l2.id,
  l2.manager_user_id,
  null,
  true
from public.users l2
join public.users l3
  on l3.id = l2.manager_user_id
  and l3.role_level = 3
  and lower(coalesce(l3.status, '')) in ('activo', 'active')
join public.station_officer_authorizations station_auth
  on station_auth.officer_user_id = l2.id
  and station_auth.is_active = true
  and (station_auth.valid_from is null or station_auth.valid_from <= now())
  and (station_auth.valid_to is null or station_auth.valid_to >= now())
where l2.role_level = 2
on conflict (operation_catalog_id, l2_user_id) do nothing;

-- L2 hierarchy is account-scoped from this point forward. Keeping this value would grant global team scope.
update public.users
set manager_user_id = null
where role_level = 2
  and manager_user_id is not null;

create or replace function public.resolve_finding_account_l3(p_finding_id uuid)
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select assignment.l3_user_id
  from public.supervision_findings finding
  join public.supervisions supervision on supervision.id = finding.supervision_id
  join public.l2_account_manager_assignments assignment
    on assignment.operation_catalog_id = supervision.operation_catalog_id
    and assignment.l2_user_id = finding.responsible_user_id
    and assignment.is_active = true
  join public.users l2
    on l2.id = assignment.l2_user_id
    and l2.role_level = 2
    and lower(coalesce(l2.status, '')) in ('activo', 'active')
  join public.users l3
    on l3.id = assignment.l3_user_id
    and l3.role_level = 3
    and lower(coalesce(l3.status, '')) in ('activo', 'active')
  where finding.id = p_finding_id
  limit 1;
$$;

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
      left join public.users account_manager
        on account_manager.id = public.resolve_finding_account_l3(finding.id)
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
            and account_manager.id = delivery.recipient_user_id
          )
          or (
            delivery.escalation_level = 'L4'
            and recipient.role_level >= 4
            and (
              finding.due_at + make_interval(hours => l4_after_hours) <= p_now
              or (responsible.role_level = 2 and account_manager.id is null)
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
    account_manager.id,
    'L3',
    'L3_MANAGER',
    finding.due_at,
    'PENDING',
    p_now
  from public.supervision_findings finding
  join public.users responsible
    on responsible.id = finding.responsible_user_id
    and responsible.role_level = 2
  join public.users account_manager
    on account_manager.id = public.resolve_finding_account_l3(finding.id)
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
    case
      when responsible.role_level = 2 and account_manager.id is null then 'L4_NO_MANAGER'
      else 'L4_48_HOURS'
    end,
    finding.due_at,
    'PENDING',
    p_now
  from public.supervision_findings finding
  join public.users responsible on responsible.id = finding.responsible_user_id
  cross join public.users director
  left join public.users account_manager
    on account_manager.id = public.resolve_finding_account_l3(finding.id)
  where finding.status <> 'CERRADO'
    and finding.due_at is not null
    and finding.due_at < p_now
    and director.role_level >= 4
    and lower(coalesce(director.status, '')) in ('activo', 'active')
    and (
      finding.due_at + make_interval(hours => l4_after_hours) <= p_now
      or (responsible.role_level = 2 and account_manager.id is null)
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

revoke all on function public.resolve_finding_account_l3(uuid) from public, anon, authenticated;
grant execute on function public.resolve_finding_account_l3(uuid) to service_role;

revoke all on table public.l2_account_manager_assignments from anon;
grant select on table public.l2_account_manager_assignments to authenticated;
grant select, insert, update, delete on table public.l2_account_manager_assignments to service_role;

comment on table public.l2_account_manager_assignments is
  'One active L3 manager per L2 and operation catalog account; an L2 may serve different L3 managers across accounts.';
