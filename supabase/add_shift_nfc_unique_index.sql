alter table public.users
  add column if not exists shift_nfc_code text;

update public.users
set shift_nfc_code = upper(trim(shift_nfc_code))
where shift_nfc_code is not null;

create unique index if not exists idx_users_shift_nfc_code_unique
  on public.users (shift_nfc_code)
  where shift_nfc_code is not null and trim(shift_nfc_code) <> '';