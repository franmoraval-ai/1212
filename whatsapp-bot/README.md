# WhatsApp Bot (entradas/salidas y reportes de puesto)

Proceso Node independiente (no corre en Vercel/Next.js) que se conecta a WhatsApp con una sesión normal (via `@whiskeysockets/baileys`), lee mensajes de los grupos autorizados y crea registros en `hoseguridad.com` a través de dos endpoints protegidos por secreto compartido.

## Formato de mensaje (fijo, dentro del grupo)

```
ENTRADA
Puesto: Torre Norte
Oficial: Juan Perez
```

```
SALIDA
Puesto: Torre Norte
Oficial: Juan Perez
```

```
REPORTE
Puesto: Torre Norte
Oficial: Juan Perez
Tipo: Novedad
Descripcion: Se reporta ...
```

`Oficial` acepta nombre o cédula; se valida contra los oficiales autorizados para ese puesto (`station_officer_authorizations` / catálogo de operaciones). Además se puede agregar una línea opcional `Cedula:` (en cualquiera de los tres formatos) para identificar sin ambigüedad cuando hay nombres parecidos o mal escritos — si se incluye, tiene prioridad sobre el nombre. Si hay ambigüedad o el oficial no está autorizado, el bot responde con el motivo en el mismo grupo.

## Variables de entorno

Ver `.env.example`:
- `STUDIO_API_BASE_URL`: URL base de la app (ej. `https://hoseguridad.com`).
- `WHATSAPP_BOT_SECRET`: debe coincidir con `WHATSAPP_BOT_SECRET` configurado en el servidor de studio-main.
- `WHATSAPP_GROUP_IDS`: lista separada por comas de JIDs de grupo autorizados (`123...@g.us`). Vacío = acepta cualquier grupo (no recomendado).
- `WHATSAPP_AUTH_DIR`: carpeta donde se persiste la sesión de WhatsApp (debe ser un volumen persistente en producción).
- `WHATSAPP_PHONE_NUMBER`: número (con código de país, solo dígitos) del WhatsApp que va a administrar los grupos. Si se define, el bot pide un código de vinculación de 8 caracteres en los logs en vez de un QR ASCII (más confiable en visores de logs web que envuelven líneas).

## Deploy recomendado: Railway

1. Crear un nuevo servicio en Railway apuntando a esta carpeta (`whatsapp-bot/`).
2. Agregar un volumen persistente montado en la ruta de `WHATSAPP_AUTH_DIR` (ej. `/data/auth_info`) para no perder la sesión en cada redeploy.
3. Configurar las variables de entorno de arriba.
4. Desplegar y revisar los logs: si definiste `WHATSAPP_PHONE_NUMBER`, aparece un código de 8 caracteres (`CODIGO DE VINCULACION`); en WhatsApp ve a Configuración > Dispositivos vinculados > Vincular con número de teléfono e ingresa ese código. Sin ese número, se imprime un QR ASCII para escanear (menos confiable en algunos visores de logs).
5. Agregar ese número a los grupos de puesto y confirmar los JIDs en `WHATSAPP_GROUP_IDS` (se pueden ver en los logs del bot al recibir el primer mensaje).

## En studio-main (servidor)

Agregar `WHATSAPP_BOT_SECRET` (el mismo valor que aquí) en las variables de entorno de Vercel. Sin esa variable, los endpoints `/api/integrations/whatsapp/*` rechazan todas las peticiones.
