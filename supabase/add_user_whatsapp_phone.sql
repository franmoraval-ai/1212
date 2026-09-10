alter table public.users add column if not exists whatsapp_phone text;

comment on column public.users.whatsapp_phone is 'Numero de WhatsApp (solo digitos, con codigo de pais) para notificaciones directas via el bot de WhatsApp.';
