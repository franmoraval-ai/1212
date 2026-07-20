-- Suscripciones Web Push por usuario (alertas supervisor -> oficial y del sistema).
-- Solo se escribe/lee vía service-role desde /api/push/*; el cliente nunca la toca directo.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  user_email text,
  endpoint text not null,
  p256dh text,
  auth text,
  user_agent text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id)
  where active;

alter table public.push_subscriptions enable row level security;

-- RLS habilitado sin políticas: solo el service-role (API interna) accede.
-- Las políticas de acceso viven en supabase/harden_access_policies.sql si se
-- necesita lectura directa desde el cliente; por diseño aquí no se requiere.
