-- Deja UNICAMENTE a francisco@hoseguridad.com como nivel 4.
-- Este script tambien inserta el usuario si no existe en public.users.

begin;

-- 1) Baja a nivel 3 a cualquier otro usuario que este en nivel 4.
update public.users
set role_level = 3
where coalesce(role_level, 1) = 4
  and lower(trim(coalesce(email, ''))) <> 'francisco@hoseguridad.com';

-- 2) Sube a francisco a nivel 4 (si ya existe su fila).
update public.users
set role_level = 4,
    status = coalesce(status, 'Activo')
where lower(trim(coalesce(email, ''))) = 'francisco@hoseguridad.com';

-- 3) Si no existe fila para ese correo, crearla.
insert into public.users (email, first_name, role_level, status, assigned, created_at)
select 'francisco@hoseguridad.com', 'Francisco', 4, 'Activo', '', now()
where not exists (
  select 1
  from public.users
  where lower(trim(coalesce(email, ''))) = 'francisco@hoseguridad.com'
);

commit;

-- Verificacion rapida: debe retornar solo una o mas filas del mismo correo en L4.
select email, role_level, created_at
from public.users
where coalesce(role_level, 1) = 4
order by email, created_at desc;
