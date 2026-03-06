-- Ejecutar en Supabase SQL Editor.
-- Corrige columnas faltantes y refresca la cache de esquema de PostgREST.

alter table if exists public.supervisions
  add column if not exists officer_phone text;

alter table if exists public.management_audits
  add column if not exists officer_phone text;

-- Fuerza a PostgREST a recargar metadata del esquema.
notify pgrst, 'reload schema';

-- Verificacion rapida
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('supervisions', 'management_audits')
  and column_name = 'officer_phone'
order by table_name;
