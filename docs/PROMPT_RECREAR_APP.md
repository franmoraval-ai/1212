# Prompt para recrear la app HO Seguridad en Firebase / estudio

Copia y pega este bloque completo cuando te pidan recrear la aplicación (por ejemplo en Firebase Studio o en un asistente IA).

---

## INSTRUCCIONES: Recrear aplicación web "HO Seguridad - Mando y Control"

Crea una aplicación web completa con las siguientes especificaciones.

### 1. Propósito y contexto

- **Nombre:** HO Seguridad - Mando y Control.
- **Cliente:** Empresa de seguridad privada (Costa Rica).
- **Uso:** Dashboard operativo para gerentes y supervisores (nivel 4): gestión de rondas, incidentes, supervisión de campo, auditoría gerencial, armamento, personal, visitantes y alertas SOS.

### 2. Stack técnico obligatorio

- **Framework:** Next.js 15 (App Router).
- **UI:** React 19, TypeScript, Tailwind CSS.
- **Componentes:** Radix UI / shadcn-style (Button, Card, Dialog, Table, Select, Input, Tabs, AlertDialog, etc.).
- **Backend/datos:** Firebase (Auth + Firestore). Sin API propia; todo desde el cliente con reglas de seguridad.
- **Mapas:** Mapbox GL JS (token vía `NEXT_PUBLIC_MAPBOX_TOKEN`).
- **IA:** Genkit con Google GenAI para priorización de incidentes (Critical/High/Medium/Low).
- **Exportación:** Excel (ExcelJS) y PDF (jsPDF + jspdf-autotable).
- **Gráficos:** Recharts (barras, etc.).
- **Iconos:** Lucide React.

### 3. Autenticación y roles

- Login con Firebase Auth (email/contraseña o el método que ya use el proyecto).
- Los permisos se basan en un documento por usuario en Firestore en la colección `users`, con campo numérico `role_level` (1 a 4):
  - **L1:** Oficial.
  - **L2:** Supervisor (lectura/crear en supervisions, etc.).
  - **L3:** Gerente (lectura/crear en management_audits).
  - **L4:** Director (lectura/escritura/borrado en todo lo que no esté restringido).
- La función de reglas `getRole()` lee `users/$(request.auth.uid).role_level`; si no existe el documento, se asume 4. Definir helpers: `isSignedIn()`, `isNivel4()`, `isGerente()`, `isSupervisor()` y usarlos en las reglas.

### 4. Colecciones Firestore y estructura de datos

- **users:** `firstName`, `email`, `role_level` (number), `status` ("Activo"|"Inactivo"), `assigned`, `createdAt`. Document ID puede ser el UID de Auth o un ID auto-generado según tu diseño.
- **rounds:** `name`, `post`, `status` ("Activa"|"Inactiva"), `frequency`, `lng`, `lat`, `checkpoints` (array opcional de `{ name, lat, lng }`).
- **incidents:** `description`, `incidentType`, `location`, `time` (Timestamp), `priorityLevel` ("Critical"|"High"|"Medium"|"Low"), `reasoning`, `reportedBy`, `status` ("Abierto"|"En curso"|"Cerrado").
- **supervisions:** `operationName`, `officerName`, `type`, `idNumber`, `weaponModel`, `weaponSerial`, `reviewPost`, `gps` ({ lat, lng }), `checklist` (objeto clave-valor boolean), `checklistReasons`, `observations`, `status`, `photos` (array de URLs), `createdAt` (Timestamp).
- **management_audits:** `operationName`, `officerName`, `officerId`, `postName`, `officerEvaluation`, `postEvaluation` (objetos clave-valor boolean), `administrativeCompliance` ({ billingCorrect, rosterUpdated, documentationInPlace }), `findings`, `actionPlan`, `managerId`, `createdAt` (Timestamp).
- **weapons:** `model`, `serial`, `type` ("Pistola"|"Revolver"|"Escopeta"), `status` ("Bodega"|"Asignada"|"Mantenimiento"), `assignedTo`, `location` ({ lat, lng }), `lastCheck` (Timestamp).
- **alerts:** `type` ("sos"), `userId`, `userEmail`, `location` opcional ({ lat, lng }), `createdAt` (Timestamp).
- **visitors:** `name`, `documentId`, `visitedPerson`, `entryTime` (Timestamp), `exitTime` (Timestamp, null hasta registro de salida).

### 5. Reglas de seguridad Firestore (resumen)

- **users:** read si autenticado; write si Nivel4 o si `request.auth.uid == uid`.
- **supervisions:** read/create si Supervisor; update/delete si Nivel4.
- **management_audits:** read/create si Gerente (L3+); update/delete si Nivel4.
- **incidents:** read/create si autenticado; update si Supervisor; delete si Nivel4.
- **rounds:** read si autenticado; write si Supervisor.
- **weapons:** read si Supervisor; write si Nivel4.
- **alerts:** read/create si autenticado; update/delete si Supervisor.
- **visitors:** read si autenticado; create/update si Supervisor; delete si Nivel4.

Implementar las reglas completas en un archivo `firestore.rules` usando las funciones anteriores.

### 6. Páginas y rutas (dashboard detrás de layout protegido)

- **/login** – Inicio de sesión (público).
- **/** – Redirigir a /overview o /login según auth.
- **/overview** – Dashboard: tarjetas con totales (rondas, incidentes, supervisions, weapons), gráfico de barras de incidentes por prioridad, panel de alertas SOS recientes, mapa táctico con marcadores (armas, HQ). Botón flotante con enlaces rápidos (Armamento, Mando).
- **/revision** – Revisión agrupada (contenido según diseño existente).
- **/personnel** – Gestión de usuarios: búsqueda por nombre/email, filtro por nivel (L1–L4), tarjetas por nivel, tabla con nombre, email, nivel (select editable), estado (select editable), eliminar. Alta con diálogo (nombre, email, nivel, estado).
- **/weapons** – Control de armamento: búsqueda por serie/modelo/asignado, filtro por estado (Bodega/Asignada/Mantenimiento), tarjetas Total/Asignadas/Bodega/Mantenimiento, tabla con modelo/serie, tipo, responsable (input editable onBlur), estado (select editable), última revisión (mostrar fecha + botón "Registrar revisión"), eliminar. Diálogo alta: modelo, serie, tipo, estado, asignado a (si Asignada), ubicación en mapa (Mapbox, clic para fijar).
- **/map** – Maestro de rondas: lista y mapa; crear ronda con nombre, puesto, frecuencia, estado, ubicación en mapa y puntos de control opcionales (array { name, lat, lng }). En mapa mostrar marcadores de rondas y de checkpoints (color distinto). Export Excel/PDF, eliminar con confirmación.
- **/incidents** – Incidentes: filtros por prioridad y por estado (Abierto/En curso/Cerrado), tabla con fecha, tipo/descripción, prioridad, estado (select editable), eliminar. Crear con diálogo: tipo, ubicación, descripción; al guardar llamar a Genkit para priorización y guardar en Firestore con status "Abierto". Export Excel/PDF con lista filtrada.
- **/supervision** – Supervisión de campo: pestañas "Historial" y "Nueva fiscalización". Historial: tabla con fecha, oficial/puesto, arma, estatus, eliminar. Nueva: formulario con operación, oficial, tipo, documento, arma (modelo/serie), puesto, GPS opcional, checklist (uniforme, equipo, puntualidad, servicio) con justificación si no cumple, fotos (URLs), observaciones. Export Excel/PDF.
- **/auditoria-gerencial** – Auditoría gerencial: pestañas listado y nuevo. Listado: cards con operación, oficial, puesto, evaluaciones, estado (cumplimiento/observaciones), eliminar. Nuevo: operación, oficial, puesto, evaluaciones de oficial y de puesto (checkboxes), cumplimiento administrativo, hallazgos, plan de acción. Export Excel/PDF.
- **/mandos** – Mando y control: vista de operaciones (datos de rounds), búsqueda/filtro, export Excel/PDF.
- **/visitors** – Registro de visitantes: tabla nombre, documento, a quién visita, entrada, salida; botón "Registrar entrada" (diálogo: nombre, documento, a quién visita); por fila botón "Registrar salida" (actualizar exitTime). Export Excel/PDF.

### 7. Componentes y comportamiento global

- **Layout dashboard:** sidebar fijo con logo "HO SEGURIDAD", badge "NIVEL 4", y enlaces a cada ruta. Header con breadcrumbs (Inicio > [ruta]), botón SOS (rojo, envía documento a `alerts` con tipo "sos", userId, userEmail, geolocalización si está disponible), icono notificaciones, icono configuración.
- **Botón SOS:** al pulsar, pedir geolocalización (opcional), crear doc en `alerts`, toast "Alerta SOS enviada".
- **Confirmación antes de borrar:** en todas las listas que tengan eliminar, usar AlertDialog "¿Eliminar...? Esta acción no se puede deshacer" con Cancelar y Eliminar.
- **Exportación:** en listas con export, botones Excel y PDF; usar lista filtrada si hay filtros activos; en caso de error mostrar toast con mensaje. Utilidades centralizadas: `exportToExcel` y `exportToPdf` (retornar `{ ok, error? }`).
- **Mapa (Mapbox):** componente reutilizable que acepte `markers` (array con lng, lat, color, title), `center`, `zoom`, `onLocationSelect` (clic en mapa). Si no hay `NEXT_PUBLIC_MAPBOX_TOKEN`, mostrar mensaje "MAPA NO CONFIGURADO" sin romper la app.
- **Estilo:** tema oscuro: fondo `#030303`, cards `#0c0c0c` con bordes `white/5`. Color primario amarillo (ej. `--primary` para botones y acentos). Tarjetas del overview con colores por módulo (amarillo rondas, rojo incidentes, azul auditorías, verde armamento). Tipografía en mayúsculas, tracking amplio, negrita donde corresponda.

### 8. Configuración Firebase y entorno

- Inicializar Firebase en el cliente con `initializeApp(firebaseConfig)`; los valores pueden venir de variables de entorno `NEXT_PUBLIC_FIREBASE_*` con fallbacks por defecto.
- Firestore y Auth desde el mismo proyecto. Proteger rutas del dashboard: si no hay usuario autenticado, redirigir a /login.
- Variables de entorno necesarias: `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_MAPBOX_TOKEN` (opcional; si falta, el mapa no se muestra pero la app sigue funcionando).

### 9. Detalles de implementación importantes

- **Hooks de datos:** usar suscripción en tiempo real a colecciones (onSnapshot) o hooks tipo `useCollection` que reciban una query memoizada (p. ej. con `useMemo` y dependencias estables) para evitar re-suscripciones innecesarias.
- **Genkit:** flujo que reciba descripción, tipo, ubicación, hora y devuelva `priorityLevel` y `reasoning`; el front guarda el incidente en Firestore con ese nivel y status "Abierto".
- **Rondas:** al crear/editar, permitir añadir puntos de control (nombre + lat/lng); guardar array `checkpoints` en el documento; en el mapa, pintar un marcador por ronda y uno por cada checkpoint (p. ej. otro color).
- **Incidentes:** nuevos con `status: "Abierto"`. Permitir cambiar estado (Abierto/En curso/Cerrado) desde la tabla (updateDoc). Dashboard: "X críticos abiertos" = incidentes con priorityLevel Critical y status != "Cerrado".
- **Armamento:** actualizar estado y asignado desde la tabla; botón "Registrar revisión" que haga updateDoc con `lastCheck: serverTimestamp()`.
- **Visitantes:** ordenar por `entryTime` desc; crear con `exitTime: null`; "Registrar salida" = updateDoc con `exitTime: serverTimestamp()`.
- **Breadcrumbs:** mostrar "Inicio > [segmento]" según pathname; ocultar en /overview. Etiquetas de ruta: overview→Dashboard, personnel→Personal, weapons→Armamento, map→Rondas, incidents→Incidencias, supervision→Supervisión, auditoria-gerencial→Auditoría Gerencial, mandos→Mando y Control, visitors→Registro Visitantes.

### 10. Archivos de proyecto sugeridos

- `firebase.json`: `{ "firestore": { "rules": "firestore.rules" } }`.
- `apphosting.yaml`: opcional; variables de entorno y runConfig (memory, cpu) para Firebase App Hosting.
- `.firebaserc`: proyecto por defecto para CLI.
- Dependencias npm: next 15, react 19, firebase, mapbox-gl, genkit, @genkit-ai/google-genai, exceljs, jspdf, jspdf-autotable, recharts, tailwindcss, radix-ui (o componentes tipo shadcn), lucide-react, date-fns, zod.

Genera la aplicación completa siguiendo esta especificación: estructura de carpetas Next.js App Router, páginas, componentes, hooks de Firebase, reglas Firestore, estilos y variables de entorno documentadas.
