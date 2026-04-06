# Production Smoke Checklist L1/L4

Objetivo: validar en menos de 10 minutos que el stack operativo L1/L4 sigue sano en producción después de una publicación.

URL base: `https://hoseguridad.com`

## Precondiciones
- Tener 1 usuario L4 activo.
- Tener 1 usuario L1 activo con:
  - base asignada válida
  - al menos 1 puesto autorizado en `Puestos`
  - PIN o credencial NFC configurada si el flujo lo exige
- Tener al menos 1 puesto activo en `Operaciones` con:
  - registro L1 operativo creado
  - `L1 activo`
- Tener al menos 1 ronda activa asociada a ese puesto.

## Paso 1: Acceso público
1. Abrir `/`.
   Resultado esperado: carga la pantalla de login sin error 404/500.
2. Abrir `/login`.
   Resultado esperado: renderiza formulario de acceso.
3. Abrir `/manifest.webmanifest`.
   Resultado esperado: responde JSON del manifiesto.

## Paso 2: Validación L4
1. Ingresar con usuario L4.
   Resultado esperado: entra al dashboard sin rebote al login.
2. Ir a `Operaciones`.
   Resultado esperado: lista de operaciones carga sin banner de error.
3. En el puesto objetivo, abrir acción `L1`.
   Resultado esperado: dialog muestra estado, etiqueta de dispositivo y notas.
4. Guardar el perfil L1 operativo del puesto sin cambiar datos.
   Resultado esperado: confirma guardado y cierra sin error.
5. En el mismo puesto, abrir `Oficiales`.
   Resultado esperado: lista de oficiales autorizables carga.
6. Guardar autorizaciones sin cambiar selección.
   Resultado esperado: confirma guardado sin error 500.
7. Ir a `Personal`.
   Resultado esperado: carga listado de usuarios.
8. En el oficial L1 de prueba, abrir acción `Puestos`.
   Resultado esperado: carga lista de puestos activos.
9. Guardar sin cambiar selección.
   Resultado esperado: confirma cantidad de puestos autorizados.
10. Ir a `Libro de Turno`.
    Resultado esperado: se ven tarjetas de puestos activos, quién está en rol, operaciones activas y horas laboradas.

## Paso 3: Validación L1
1. Cerrar sesión L4 e ingresar con usuario L1 de prueba.
   Resultado esperado: aterriza en `/station` (`Puesto Activo`).
2. Verificar tarjeta principal de puesto.
   Resultado esperado:
   - muestra puesto correcto
   - muestra estado L1 operativo
   - si existe, muestra etiqueta de dispositivo y notas
3. Abrir panel de turno.
   Resultado esperado:
   - lista solo puestos autorizados para ese oficial
   - lista oficiales disponibles del puesto actual
   - no aparece mensaje de puesto no autorizado
4. Iniciar turno.
   Resultado esperado:
   - el oficial queda visible como activo
   - no oscila `entra/sale`
   - no aparece error 403/503
5. Ir a `Rondas`.
   Resultado esperado:
   - solo se ven rondas del puesto actual
   - si falta contexto operativo, aparece aviso claro y no lista rondas ajenas
6. Iniciar una ronda activa del puesto.
   Resultado esperado: sesión inicia sin error de autorización o de perfil L1.
7. Ir a `Libro de Turno`.
   Resultado esperado:
   - muestra turno activo del puesto consultado
   - el oficial en rol coincide con el que inició turno
8. Regresar a `Puesto Activo` y cerrar turno.
   Resultado esperado:
   - el turno se cierra sin error
   - historial se refresca

## Paso 4: Validación IA y control de armas
1. Ingresar otra vez con L4 o L2 autorizado.
2. Probar asistente IA con una nota interna simple:
   Prompt sugerido: `crear nota interna puesto: Casa Pavas prioridad alta detalle: prueba de humo post deploy`
   Resultado esperado: responde `Nota interna creada correctamente`.
3. En `Control de armas`, hacer una reasignación válida dentro del alcance permitido.
   Resultado esperado: operación exitosa sin error de permisos.

## Paso 5: Criterios de salida
Marcar la publicación como sana solo si:
- login público carga
- L4 puede guardar perfil L1 operativo
- L4 puede guardar autorizaciones por puesto
- L4 puede guardar puestos por oficial
- L1 puede abrir y cerrar turno
- L1 puede iniciar ronda del puesto correcto
- Libro de Turno refleja oficial y puesto correctos
- asistente IA crea nota interna

## Si falla algo
- Error `503` sobre esquema faltante:
  correr `supabase/verify_l1_operational_stack.sql`
- Error de acceso o RLS:
  correr `supabase/verify_access_hardening.sql`
- Error general de plataforma o unhealthy:
  seguir `docs/SUPABASE_INCIDENT_RUNBOOK.md`