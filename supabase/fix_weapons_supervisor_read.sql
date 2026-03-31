-- Permite a supervisores L2 leer el catalogo de armas para el formulario de supervision.
-- Mantiene alta/edicion/borrado solo para L3+.

alter table public.weapons enable row level security;

drop policy if exists weapons_select_manager on public.weapons;

create policy weapons_select_manager on public.weapons
for select to authenticated
using (public.app_is_active_user() and public.app_is_role(2));