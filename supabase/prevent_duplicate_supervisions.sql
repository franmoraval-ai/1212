-- Ejecutar en Supabase SQL Editor para entornos existentes.
-- Bloquea inserciones duplicadas de supervision en una ventana de 90 segundos.

create or replace function public.prevent_duplicate_supervisions()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.supervisions s
    where s.id <> new.id
      and coalesce(lower(trim(s.supervisor_id)), '') = coalesce(lower(trim(new.supervisor_id)), '')
      and coalesce(lower(trim(s.operation_name)), '') = coalesce(lower(trim(new.operation_name)), '')
      and coalesce(lower(trim(s.officer_name)), '') = coalesce(lower(trim(new.officer_name)), '')
      and coalesce(lower(trim(s.type)), '') = coalesce(lower(trim(new.type)), '')
      and coalesce(lower(trim(s.review_post)), '') = coalesce(lower(trim(new.review_post)), '')
      and abs(extract(epoch from (coalesce(s.created_at, now()) - coalesce(new.created_at, now())))) <= 90
  ) then
    raise exception using
      errcode = '23505',
      message = 'duplicate supervision submission detected';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_duplicate_supervisions on public.supervisions;
create trigger trg_prevent_duplicate_supervisions
before insert on public.supervisions
for each row
execute function public.prevent_duplicate_supervisions();
