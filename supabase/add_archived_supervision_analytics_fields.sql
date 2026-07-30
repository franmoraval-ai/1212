-- Preserve the complete analytical supervision payload in future archive runs.
alter table if exists public.archived_supervisions
  add column if not exists officer_phone text,
  add column if not exists evidence_bundle jsonb,
  add column if not exists geo_risk jsonb,
  add column if not exists operation_catalog_id uuid;