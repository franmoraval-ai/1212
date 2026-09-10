create table if not exists public.whatsapp_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  to_phone text not null,
  to_user_id uuid references public.users(id) on delete set null,
  message text not null,
  context text,
  status text not null default 'pending',
  last_error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  check (status in ('pending', 'claimed', 'sent', 'failed'))
);

create index if not exists idx_whatsapp_outbound_pending
  on public.whatsapp_outbound_messages (created_at)
  where status = 'pending';

alter table public.whatsapp_outbound_messages enable row level security;
-- Intentionally no policies: this queue is only read/written by the service role (API + bot), same pattern as push_subscriptions.
