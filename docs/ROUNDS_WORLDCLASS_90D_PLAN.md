# Plan técnico 90 días — Módulo de rondas (nivel global)

## 1) Objetivo de producto
Construir un módulo de rondas que sea:
- Funcional en campo (rápido para L1, incluso con mala conectividad).
- Serio para supervisión (alertas, trazabilidad, anti-trampa).
- Ejecutivo para cliente/gerencia (KPIs y reportes automáticos).

## 2) Base actual confirmada (no inventada)
### Frontend/UX actual
- Ejecución de ronda en `rounds/page.tsx` con QR + NFC + GPS track.
- Antifraude ya implementado: geofence, gaps sin escaneo, saltos GPS, alertas.
- Exportación PDF/Excel/GPX ya disponible sobre `round_reports`.
- Creación de checkpoints en `rounds/new/page.tsx` con captura QR/NFC/GPS.

### Datos actuales (Supabase)
- `rounds`: catálogo de rondas (incluye `checkpoints` JSONB).
- `round_reports`: bitácora consolidada por boleta (incluye `checkpoint_logs` JSONB).
- `round_security_config`: parámetros antifraude (radio geofence, gap máximo, salto máximo).

## 3) Brecha vs estándar global
Lo que falta para competir con suites enterprise no es el escaneo base, sino:
1. Centro de control en vivo (estado por oficial/ronda/checkpoint).
2. SLA operacional (vencimientos, escalamiento, reasignación).
3. Evidencia con cadena de custodia estructurada (no solo JSON libre).
4. Reportería automática programada por cliente/sitio.
5. KPIs históricos consistentes para decisiones (tendencia, ranking, riesgo).
6. Integraciones/API para ecosistema externo.

## 4) Arquitectura objetivo (incremental, sin romper lo actual)
## 4.1 Nuevas tablas

### A) `round_sessions`
Instancia en ejecución de una ronda (separada del reporte final).

Campos propuestos:
- `id uuid pk`
- `round_id uuid not null`
- `round_name text`
- `post_name text`
- `officer_id text not null`
- `officer_name text`
- `supervisor_id text null`
- `status text not null` (`pending`, `in_progress`, `completed`, `partial`, `aborted`)
- `started_at timestamptz`
- `ended_at timestamptz`
- `expected_end_at timestamptz`
- `checkpoints_total int default 0`
- `checkpoints_completed int default 0`
- `last_scan_at timestamptz`
- `last_location jsonb`
- `fraud_score int default 0`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

Índices:
- `(status, started_at desc)`
- `(officer_id, started_at desc)`
- `(round_id, created_at desc)`

### B) `round_checkpoint_events`
Evento granular por checkpoint (fuente de verdad auditable).

Campos propuestos:
- `id uuid pk`
- `session_id uuid not null`
- `round_id uuid not null`
- `checkpoint_id text not null`
- `checkpoint_name text`
- `event_type text not null` (`matched`, `unmatched`, `manual_override`, `nfc_match`)
- `token_hash text` (hash del valor escaneado, no token plano)
- `lat double precision`
- `lng double precision`
- `accuracy_meters double precision`
- `distance_to_target_meters double precision`
- `inside_geofence boolean`
- `fraud_flag text null`
- `captured_at timestamptz not null`
- `created_at timestamptz default now()`

Índices:
- `(session_id, captured_at)`
- `(round_id, captured_at desc)`
- `(fraud_flag, created_at desc)`

### C) `round_alert_events`
Alertas operacionales/escalamientos desacoplados del reporte final.

Campos propuestos:
- `id uuid pk`
- `session_id uuid`
- `round_id uuid`
- `officer_id text`
- `severity text not null` (`low`, `medium`, `high`, `critical`)
- `alert_type text not null` (`checkpoint_overdue`, `no_scan_gap`, `scan_outside_geofence`, `gps_jump`, `route_deviation`)
- `message text not null`
- `status text not null` (`open`, `ack`, `resolved`)
- `opened_at timestamptz not null default now()`
- `acked_at timestamptz`
- `resolved_at timestamptz`
- `acked_by text`
- `resolved_by text`
- `context jsonb`

Índices:
- `(status, severity, opened_at desc)`
- `(officer_id, opened_at desc)`
- `(alert_type, opened_at desc)`

### D) `round_report_subscriptions`
Programación automática de reportes por cliente/sitio.

Campos propuestos:
- `id uuid pk`
- `operation_name text not null`
- `post_name text null`
- `recipient_email text not null`
- `cadence text not null` (`daily`, `weekly`, `monthly`)
- `send_time text not null` (HH:mm local)
- `timezone text not null`
- `enabled boolean default true`
- `last_sent_at timestamptz`
- `created_by text`
- `created_at timestamptz default now()`

Índices:
- `(enabled, cadence, send_time)`
- `(operation_name, post_name)`

## 4.2 Vistas/KPIs
### `vw_round_kpis_daily`
Vista diaria por operación/sitio con:
- `rounds_started`
- `rounds_completed`
- `completion_rate`
- `on_time_checkpoint_rate`
- `manual_override_rate`
- `alerts_per_100_rounds`
- `median_checkpoint_scan_seconds`

## 5) Endpoints recomendados (Next route handlers)
Formato pensado para `src/app/api/rounds/...` y compatibilidad con cola offline existente.

1. `POST /api/rounds/sessions/start`
- Crea `round_sessions` al iniciar boleta.
- Input: `roundId`, `officerId`, `officerName`, `startedAt`, `expectedEndAt`.
- Output: `sessionId`, `status`.

2. `POST /api/rounds/sessions/{sessionId}/event`
- Registra evento granular en `round_checkpoint_events`.
- Input: `checkpointId`, `eventType`, `lat`, `lng`, `accuracy`, `insideGeofence`, `fraudFlag`, `capturedAt`.
- Output: `accepted`, `alertsTriggered[]`.

3. `POST /api/rounds/sessions/{sessionId}/heartbeat`
- Actualiza `last_location`, `last_scan_at`, `updated_at`.
- Input: `lat`, `lng`, `accuracy`, `recordedAt`.
- Output: `ok`.

4. `POST /api/rounds/sessions/{sessionId}/finish`
- Cierra sesión y consolida en `round_reports` (mantiene compatibilidad actual).
- Input: `endedAt`, `notes`, `status`.
- Output: `reportId`, `summary`.

5. `GET /api/rounds/live`
- Feed para centro de control en vivo.
- Query: `operation`, `post`, `status`.
- Output: sesiones activas + alertas abiertas + SLA vencidos.

6. `POST /api/rounds/alerts/{alertId}/ack`
- Acuse supervisor de alerta.
- Input: `ackBy`, `ackAt`.
- Output: `status`.

7. `POST /api/rounds/reports/schedule`
- Crea/actualiza suscripción de reporte automático.
- Input: datos de `round_report_subscriptions`.
- Output: `subscriptionId`.

8. `POST /api/rounds/reports/run`
- Job manual/cron para envío de PDF/Excel por operación/sitio.
- Input: `dateFrom`, `dateTo`, `operation`, `post`.
- Output: `sentCount`, `failedCount`.

## 6) Historias de usuario prioritarias
## 6.1 L1 (oficial de campo) — prioridad máxima
1. Como L1, quiero iniciar una ronda y registrar checkpoint en <= 3 toques para no perder tiempo operativo.
2. Como L1, quiero seguir trabajando offline sin perder evidencia para evitar caídas en turno.
3. Como L1, quiero feedback inmediato de checkpoint válido/inválido para corregir en el momento.

Criterios de aceptación:
- Tiempo mediano de registro por checkpoint <= 8 s.
- Ratio de guardados offline recuperados >= 99%.

## 6.2 L2/L3 (supervisión)
1. Como supervisor, quiero ver en vivo qué rondas están atrasadas para intervenir antes del incumplimiento.
2. Como supervisor, quiero confirmar (ack) alertas críticas y dejar trazabilidad.

Criterios de aceptación:
- Detección de checkpoint vencido <= 60 s.
- Tiempo mediano de ack de alerta crítica < 5 min.

## 6.3 L4/Gerencia
1. Como gerencia, quiero recibir reportes automáticos por cliente/sitio con KPIs semanales.
2. Como gerencia, quiero comparar sitios por cumplimiento y riesgo.

Criterios de aceptación:
- Reporte automático entregado en ventana horaria > 98%.
- KPIs diarios consistentes (desviación de conteo < 1%).

## 7) KPIs y fórmulas (tablero ejecutivo)
- `Completion Rate` = rondas completadas / rondas iniciadas.
- `On-time Checkpoint Rate` = checkpoints a tiempo / checkpoints planificados.
- `Manual Override Rate` = validaciones manuales / checkpoints completados.
- `Fraud Alert Density` = alertas fraude * 100 / rondas iniciadas.
- `Median Scan Cycle` = mediana(segundos entre checkpoints consecutivos).
- `Supervisor Response Time` = mediana(acked_at - opened_at).

Metas 90 días:
- Completion Rate >= 92%
- On-time Checkpoint Rate >= 90%
- Manual Override Rate <= 8%
- Fraud Alert Density <= 12 por 100 rondas
- Supervisor Response Time <= 4 min

## 8) Plan 30/60/90 con entregables técnicos
## Día 0-30 (Quick wins + base en vivo)
- Crear `round_sessions` y `round_checkpoint_events`.
- Instrumentar endpoints `start`, `event`, `heartbeat`, `finish`.
- En UI, agregar estado en vivo mínimo (tarjetas: en curso / atrasadas / alertas).
- Mantener `round_reports` como salida final para no romper exportes.

Definition of done:
- Nueva boleta guarda sesión + eventos granulares + reporte final.
- Lint/build en verde y migración reversible.

## Día 31-60 (SLA + escalamiento)
- Crear `round_alert_events` con motor de reglas (gap, geofence, overdue).
- Añadir flujos `ack/resolved` de alertas.
- Tablero supervisor con filtros por operación, puesto y severidad.

Definition of done:
- Alerta crítica visible en < 60 s.
- Historial completo de estado de alerta (`open/ack/resolved`).

## Día 61-90 (valor ejecutivo + automatización)
- Crear `round_report_subscriptions` y job de envío automático.
- Implementar `vw_round_kpis_daily` + dashboard de tendencias.
- Ranking de operaciones/sitios por cumplimiento y riesgo.

Definition of done:
- Reporte programado activo por operación.
- KPIs diarios disponibles para gerencia y auditables desde eventos.

## 9) Riesgos y mitigación
1. Riesgo: duplicidad por reintentos offline.
- Mitigación: idempotencia por `event_id` cliente + índice único por sesión/evento.

2. Riesgo: crecimiento alto de eventos GPS.
- Mitigación: partición temporal o purga por política (ej. > 180 días en frío).

3. Riesgo: ruido de alertas (fatiga operativa).
- Mitigación: umbrales configurables por operación en `round_security_config`.

4. Riesgo: regresión UX L1 por sobrecarga visual.
- Mitigación: UI L1 mínima; detalles avanzados solo para supervisor/gerencia.

## 10) Orden de implementación recomendado (siguiente sprint)
1. Migraciones SQL: `round_sessions` + `round_checkpoint_events`.
2. Endpoints `start/event/finish` con idempotencia.
3. Integración en `rounds/page.tsx` manteniendo flujo actual.
4. KPI diario básico (vista SQL) y una tarjeta nueva en overview.
5. Después: alertas SLA y centro de control completo.

---
Este plan conserva tu arquitectura actual, prioriza velocidad real para L1 y agrega la capa de supervisión/gerencia que exigen las plataformas líderes.