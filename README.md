# HO SEGURIDAD - Mando y Control Web

Sistema de Gestión de Seguridad Táctica de Nivel 4 desarrollado para **HO SEGURIDAD COSTA RICA**.

## Características Principales
- **Dashboard Global**: Monitoreo de rondas, incidentes y auditorías con mapas tácticos de Mapbox.
- **Control de Armamento**: Rastreo geoespacial de inventario y asignación de armas.
- **Supervisión de Campo**: Boletas de fiscalización técnica con evidencia fotográfica múltiple.
- **Auditoría Gerencial**: Módulo estratégico para Gerentes de Cuenta con KPIs de satisfacción.
- **Arquitectura de Seguridad**: Protección de rutas basada en niveles de responsabilidad táctica (1-4).
- **Resumen IA de Boletas**: Generación de resumen operativo y acciones sugeridas desde historial de rondas.

## Variables de entorno (IA)
- `OPENAI_API_KEY`: API key del proveedor IA (requerido para `/api/ai/round-summary`).
- `OPENAI_MODEL`: modelo a usar (opcional, default `gpt-4o-mini`).

## Configuración de Colores
- **Dorado Táctico**: `#C5A059`
- **Azul Táctico**: `#1E3A8A`
- **Fondo Corporativo**: `#0A0A0A`

## Dominio Institucional
`hoseguridacr.com`

## URL de producción
- Dominio principal: https://hoseguridad.com
- Plataforma de despliegue: Vercel

## Despliegue en Vercel

### Opción 1: despliegue desde CLI

1. Instala Vercel CLI:

```bash
npm install -g vercel
```

2. Inicia sesión:

```bash
vercel login
```

3. Vincula el proyecto (solo la primera vez):

```bash
vercel link
```

4. Despliega a producción:

```bash
vercel --prod --yes
```

### Opción 2: despliegue automático por Git

1. Conecta el repositorio en Vercel.
2. Define la rama de producción (normalmente `main`).
3. Cada push a esa rama generará un despliegue automático.

### Variables de entorno (Vercel)

Configúralas en Vercel Project Settings > Environment Variables.

Variables mínimas típicas:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (opcional)
- `NEXT_PUBLIC_MAPBOX_TOKEN` (si usas mapas)

Monitoreo de errores (Sentry, opcional — inerte si se omite):
- `NEXT_PUBLIC_SENTRY_DSN` (activa la captura de errores cliente/servidor)
- `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (solo build: subir source maps)

Notificaciones push (Web Push, opcional — inerte si se omite):
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (llave pública VAPID; sin ella la UI de push no aparece)
- `VAPID_PRIVATE_KEY` (llave privada VAPID; solo servidor, nunca exponer)
- `VAPID_SUBJECT` (opcional, `mailto:` de contacto; por defecto `mailto:soporte@hoseguridad.com`)
- Generar el par con: `npx web-push generate-vapid-keys`

Nota:
- Este proyecto ya no usa Firebase/App Hosting como flujo de despliegue.