-- Campos de telefono para auditorias al oficial.
alter table if exists public.supervisions
  add column if not exists officer_phone text;

alter table if exists public.management_audits
  add column if not exists officer_phone text;
