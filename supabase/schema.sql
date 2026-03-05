-- Ejecutar en Supabase: SQL Editor → New query → Pegar y Run
-- Crea las tablas necesarias para la app HO Seguridad

-- Habilitar auth anónimo (en Dashboard: Authentication → Providers → Anonymous: Enable)

-- Tablas (nombres en minúsculas para Supabase; la app usa useCollection con estos nombres)
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  first_name text,
  role_level int default 4,
  status text default 'active',
  assigned text,
  display_name text,
  created_at timestamptz default now()
);

create table if not exists public.supervisions (
  id uuid primary key default gen_random_uuid(),
  operation_name text,
  officer_name text,
  type text,
  id_number text,
  weapon_model text,
  weapon_serial text,
  review_post text,
  lugar text,
  gps jsonb,
  checklist jsonb,
  checklist_reasons jsonb,
  property_details jsonb,
  observations text,
  photos jsonb,
  supervisor_id text,
  status text,
  created_at timestamptz default now()
);

create table if not exists public.management_audits (
  id uuid primary key default gen_random_uuid(),
  operation_name text,
  officer_name text,
  officer_id text,
  post_name text,
  officer_evaluation jsonb,
  post_evaluation jsonb,
  administrative_compliance jsonb,
  findings text,
  action_plan text,
  manager_id text,
  created_at timestamptz default now()
);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  title text,
  description text,
  incident_type text,
  location text,
  "time" timestamptz,
  priority_level text,
  reasoning text,
  reported_by text,
  status text,
  created_at timestamptz default now()
);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  name text,
  post text,
  status text,
  frequency text,
  lng float,
  lat float,
  checkpoints jsonb,
  operation_id text,
  puesto_base text,
  instructions text,
  created_at timestamptz default now()
);

create table if not exists public.weapons (
  id uuid primary key default gen_random_uuid(),
  serial text,
  model text,
  type text,
  status text,
  assigned_to text,
  location jsonb,
  last_check timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  type text,
  message text,
  user_id text,
  user_email text,
  location jsonb,
  created_at timestamptz default now()
);

create table if not exists public.visitors (
  id uuid primary key default gen_random_uuid(),
  name text,
  document_id text,
  visited_person text,
  entry_time timestamptz default now(),
  exit_time timestamptz,
  created_at timestamptz default now()
);

-- RLS: permitir todo a usuarios autenticados (anon o email)
alter table public.users enable row level security;
alter table public.supervisions enable row level security;
alter table public.management_audits enable row level security;
alter table public.incidents enable row level security;
alter table public.rounds enable row level security;
alter table public.weapons enable row level security;
alter table public.alerts enable row level security;
alter table public.visitors enable row level security;

create policy "Allow all for authenticated" on public.users for all using (auth.role() = 'authenticated');
create policy "Allow all for authenticated" on public.supervisions for all using (auth.role() = 'authenticated');
create policy "Allow all for authenticated" on public.management_audits for all using (auth.role() = 'authenticated');
create policy "Allow all for authenticated" on public.incidents for all using (auth.role() = 'authenticated');
create policy "Allow all for authenticated" on public.rounds for all using (auth.role() = 'authenticated');
create policy "Allow all for authenticated" on public.weapons for all using (auth.role() = 'authenticated');
create policy "Allow all for authenticated" on public.alerts for all using (auth.role() = 'authenticated');
create policy "Allow all for authenticated" on public.visitors for all using (auth.role() = 'authenticated');
