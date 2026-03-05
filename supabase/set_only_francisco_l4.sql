-- Deja UNICAMENTE a francisco@hoseguridad.com como nivel 4.
-- 1) Baja a nivel 3 a cualquier otro usuario que este en nivel 4.
update public.users
set role_level = 3
where role_level = 4
  and lower(email) <> 'francisco@hoseguridad.com';

-- 2) Asegura que francisco@hoseguridad.com quede en nivel 4.
update public.users
set role_level = 4,
    status = coalesce(status, 'Activo')
where lower(email) = 'francisco@hoseguridad.com';

-- Verificacion rapida
select email, role_level
from public.users
where role_level = 4
order by email;
