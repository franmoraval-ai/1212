alter table if exists public.weapons
  add column if not exists ammo_count integer default 0;

update public.weapons
set ammo_count = 0
where ammo_count is null;