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

## URL de producción (App Hosting)
- **Backend**: `app-ho-2026` (proyecto `app-ho-72367`)
- **URL**: https://t-417988823---app-ho-2026-dozgqbjlea-uc.a.run.app  
- El tráfico puede llegar vía dominio (ej. `https://hoseguridad.com`).

## Despliegue en Firebase (App Hosting)

### Opción 1: Desde Firebase Console (recomendado)

1. **Sube el código a GitHub**
   - Crea un repositorio en [github.com](https://github.com) y sube este proyecto (o conéctalo con `git remote add origin ...` y `git push -u origin main`).

2. **Abre Firebase Console**
   - Entra en [Firebase Console](https://console.firebase.google.com) y selecciona tu proyecto (ej. `poised-bot-488618-s3`).

3. **Activa App Hosting**
   - En el menú izquierdo: **Build** → **App Hosting**.
   - Pulsa **Get started** (el proyecto debe estar en plan **Blaze** para App Hosting).

4. **Conecta GitHub**
   - Elige **Connect to GitHub** y autoriza Firebase para acceder a tu cuenta/repositorio.
   - Selecciona el repositorio donde está este código.
   - **Rama en vivo**: `main` (o la que uses).
   - **Directorio raíz**: deja vacío si la app está en la raíz del repo; si está en una carpeta, indica la ruta (ej. `app-ho`).
   - **Nombre del backend**: por ejemplo `ho-seguridad`.

5. **Variables de entorno**
   - En la configuración del backend, añade las que necesites (ya tienes algunas en `apphosting.yaml`):
     - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
     - `NEXT_PUBLIC_MAPBOX_TOKEN` (para los mapas).
   - Puedes editarlas también en **App Hosting** → tu backend → **Environment variables**.

6. **Desplegar**
   - Pulsa **Finish and deploy**. Cada push a la rama en vivo (ej. `main`) generará un nuevo despliegue automático.

7. **URL**
   - Firebase te dará una URL tipo:  
     `https://<backend-id>--<project-id>.us-central1.hosted.app`  
   - Si configuraste dominio (ej. hoseguridacr.com), podrás usarlo cuando lo apuntes a ese hosting.

### Opción 2: Firebase CLI (sin GitHub)

1. Instala la CLI: `npm install -g firebase-tools`
2. Inicia sesión: `firebase login`
3. En la raíz del proyecto: `firebase init` (o usa el flujo que te indique la consola para App Hosting).
4. Para desplegar: desde la [documentación de App Hosting](https://firebase.google.com/docs/app-hosting) revisa el comando actual (p. ej. `firebase apphosting:backends:create` o enlace desde la consola).

### Reglas de Firestore

Después del primer despliegue, publica las reglas de Firestore desde la consola (**Firestore** → **Reglas**) o con:

```bash
firebase deploy --only firestore:rules
```

En este proyecto ya existe `firebase.json` y `.firebaserc` (proyecto por defecto: `poised-bot-488618-s3`). Para publicar solo las reglas desde tu máquina:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules
```