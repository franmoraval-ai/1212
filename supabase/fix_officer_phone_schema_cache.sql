-- Ejecutar en Supabase SQL Editor.
-- Corrige columnas faltantes y refresca la cache de esquema de PostgREST.

alter table if exists public.supervisions
  add column if not exists officer_phone text;

alter table if exists public.management_audits
  add column if not exists officer_phone text;

-- Columnas nuevas para evidencia y trazabilidad (modo offline + antifraude).
alter table if exists public.supervisions
  add column if not exists evidence_bundle jsonb,
  add column if not exists geo_risk jsonb;

alter table if exists public.incidents
  add column if not exists evidence_bundle jsonb,
  add column if not exists geo_risk_level text,
  add column if not exists geo_risk_flags text[],
  add column if not exists estimated_speed_kmh double precision;

-- Fuerza a PostgREST a recargar metadata del esquema.
notify pgrst, 'reload schema';

-- Verificacion rapida
select column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name in ('supervisions', 'management_audits') and column_name = 'officer_phone')
    or (table_name = 'supervisions' and column_name in ('evidence_bundle', 'geo_risk'))
    or (table_name = 'incidents' and column_name in ('evidence_bundle', 'geo_risk_level', 'geo_risk_flags', 'estimated_speed_kmh'))
  )
order by table_name, column_name;
