-- Remediacion de rendimiento RLS para public.incidents
-- Evita re-evaluacion por fila de auth.role() usando (select auth.role()).

alter table public.incidents enable row level security;

drop policy if exists "Allow all for authenticated" on public.incidents;
create policy "Allow all for authenticated"
  on public.incidents
  for all
  to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');
