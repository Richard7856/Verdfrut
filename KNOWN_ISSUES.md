# Known Issues — VerdFrut

Documento vivo. **Cuando se resuelve un issue, se quita de aquí** (no se marca, se elimina). El resumen al pie cuenta los abiertos por categoría.

Formato:
```
### #N — Título
**Severidad:** crítico | importante | cosmético
**Fase afectada:** N
**Síntoma:** descripción del bug
**Solución propuesta:** cómo arreglar
**Estado:** abierto | en progreso
```

---

## Críticos (bloquean Fase 2 o causan corrupción de datos)

> Sección vacía. Todos resueltos antes de Fase 2.

---

## Importantes (no bloquean, mejoran calidad / UX)


### #12 — TTL fijo de 24h en links sin renegociación
**Severidad:** importante
**Fase afectada:** 2
**Síntoma:** Si el chofer tarda en abrir el link más de 24h, debe pedir uno nuevo. No hay alerta proactiva al admin de "link a punto de expirar".
**Solución propuesta:** Cron diario que liste invites no usados >18h, mande Slack/email al admin. Permitir extensión manual desde UI.
**Estado:** abierto

### #13 — Validación débil de contraseña en set-password
**Severidad:** importante
**Fase afectada:** 2
**Síntoma:** Sólo valida `length >= 8`. Permite `12345678`, `password`, `qwerty12`. Riesgo: chofer pone contraseña trivial, atacante la prueba.
**Solución propuesta:** Integrar `zxcvbn` (cliente) o lista top-1000 de contraseñas comunes. Bloquear score < 2.
**Estado:** abierto




### #20 — Sin compresión defensiva si canvas falla en iOS Low-Power Mode
**Severidad:** cosmético
**Fase afectada:** 2
**Síntoma:** En iOS con Low-Power Mode activo, `canvas.toBlob` puede tardar mucho o devolver imagen sin comprimir. El chofer ve "Subiendo…" eternamente.
**Solución propuesta:** Timeout de 5s en `compressImage`, fallback a subir la imagen original sin comprimir.
**Estado:** abierto

### #22 — Importador CSV upload pendiente (solo descarga implementada)
**Severidad:** importante
**Fase afectada:** 2 / 6
**Síntoma:** Las plantillas CSV son descargables (`/api/templates/[entity]`) pero el upload con preview, validación per-row, dry-run y commit transaccional no existe. El admin debe preparar el archivo y aplicarlo vía SQL.
**Solución propuesta:** Endpoint POST `/api/import/[entity]` que parsea CSV (papaparse), valida por row contra el mismo schema que las server actions individuales, devuelve `{ valid: [...], invalid: [{ row, errors }] }`. UI con dropzone + tabla de resultados + botón "Aplicar todo" que envuelve INSERTs en transacción.
**Estado:** abierto

### #23 — Plantillas CSV no auto-sincronizadas con schema
**Severidad:** cosmético
**Fase afectada:** 2
**Síntoma:** Si se agrega una columna a `stores`/`vehicles`/etc, la plantilla en `/api/templates/[entity]/route.ts` no se actualiza automáticamente. Riesgo: admin sube CSV sin la columna nueva.
**Solución propuesta:** Generar las plantillas a partir del tipo TS (`Tables<'stores'>['Insert']`) con un comentario por columna. O test unitario que falla si las keys del template no matchean las del schema.
**Estado:** abierto

### #24 — Sin UI para reordenar/editar paradas post-optimización
**Severidad:** importante
**Fase afectada:** 1 (mejora UX dispatcher)
**Síntoma:** Después de optimizar, el dispatcher solo puede aprobar tal cual o re-optimizar. Si VROOM le asigna una parada en mal orden por una restricción que no modelamos, no hay forma de corregir manualmente sin volver a empezar.
**Solución propuesta:** Drag-and-drop en `/routes/[id]` para reordenar `stops.sequence` (la query `reorderStop` ya existe). También botón "Quitar" por parada (status='skipped' antes de publicar) y "Editar ETA manual" (override de `planned_arrival_at`).
**Estado:** abierto

### #25 — Optimizer usa OSRM público (no Mapbox Directions Matrix)
**Severidad:** importante
**Fase afectada:** 1 (calidad de optimización)
**Síntoma:** Sin `matrix` precomputada, VROOM cae a OSRM público que (a) es lento, (b) tiene rate limits, (c) usa OpenStreetMap que en México puede tener calles incorrectas. Resultado: ETAs poco confiables.
**Solución propuesta:** Antes de llamar a VROOM, hacer una request a Mapbox Directions Matrix API con todas las coords (vehículos + tiendas) y pasar la matriz de duraciones/distancias en el campo `matrix` del request al optimizer. Cache por (lat, lng) ordenadas con TTL de horas.
**Estado:** abierto

### #26 — Costos por km/hora no expuestos en vehículos
**Severidad:** cosmético (Fase 1)
**Fase afectada:** 1 / 5
**Síntoma:** El optimizer minimiza distancia+tiempo pero no costo monetario. Una flota mixta (Kangoos + camiones grandes) idealmente usaría siempre Kangoos para zonas pequeñas porque cuestan menos.
**Solución propuesta:** Columnas `cost_fixed`, `cost_per_hour`, `cost_per_km` en vehicles. Pasarlas en `costs` del payload VROOM.
**Estado:** abierto

### #27 — CEDIS no se preselecciona al crear vehículo
**Severidad:** cosmético
**Fase afectada:** 2
**Síntoma:** Cuando una zona tiene un solo CEDIS (caso 90% de los clientes V1), el admin igual lo selecciona en cada vehículo. Trabajo repetitivo.
**Solución propuesta:** Columna `zones.default_depot_id` (FK opcional a depots). Al crear vehículo, si zone.default_depot_id está set, se preselecciona en el form. Migración trivial.
**Estado:** abierto

### #28 — Combustible / costo estimado no aparecen en dashboard
**Severidad:** cosmético
**Fase afectada:** 5 (dashboard)
**Síntoma:** El dashboard muestra distancia, duración y paradas pero no costo estimado de la jornada. KPI clave para el cliente.
**Solución propuesta:** Columna `vehicles.liters_per_km` (consumo). Computar costo = distancia × consumo × precio_diesel (env var) + horas × costo/hora del chofer. Mostrar en /routes/[id] y agregar al dashboard.
**Estado:** abierto

### #29 — Mapbox Matrix limita 25 coords; rutas grandes caen a haversine
**Severidad:** importante (cuando aparezcan rutas con >23 paradas)
**Fase afectada:** 1
**Síntoma:** Plan dev de Mapbox Directions Matrix API limita 25 coords por request. 1 vehículo (start+end = 2) + 23 paradas = 25. Rutas más grandes loggean warning y caen a haversine, perdiendo calidad.
**Solución propuesta:** Implementar chunking: partir coords en bloques de 25, hacer N requests, combinar matrices. O subir plan paid (100 coords). O cachear matrices entre tiendas frecuentes.
**Estado:** abierto

### #30 — Polyline cache 5min muestra geometría vieja tras reoptimize
**Severidad:** cosmético
**Fase afectada:** 1
**Síntoma:** Endpoint `/api/routes/[id]/polyline` cachea `private, max-age=300`. Si re-optimizas, la UI puede dibujar polyline anterior por hasta 5 min.
**Solución propuesta:** Versionar cache key con `route.version` o invalidar via revalidate.
**Estado:** abierto

### #31 — iOS Safari mata watchPosition al bloquear pantalla
**Severidad:** importante (operativo en iOS)
**Fase afectada:** 3
**Síntoma:** Cuando el chofer iOS bloquea pantalla o cambia a otra app, `Geolocation.watchPosition` deja de emitir. El supervisor ve "GPS perdido". Wake Lock atenúa pero Apple no garantiza siempre concedido.
**Solución propuesta corta:** Indicador visible al chofer + recordatorio "no bloquees la pantalla durante la ruta". Recall periódico vía Notification quede pendiente.
**Solución propuesta larga:** Migrar driver app a nativa (Expo) — ADR-004 ya lo anticipa para Fase 7.
**Estado:** abierto

### #32 — Sin replay del recorrido cuando supervisor entra tarde al mapa
**Severidad:** importante (cuando el supervisor abre el mapa media jornada)
**Fase afectada:** 3
**Síntoma:** Si el supervisor abre `/routes/[id]` cuando el chofer ya tiene 2 horas de ruta, NO ve dónde estuvo el chofer antes — solo desde ese momento.
**Solución propuesta:** Al montar `<LiveRouteMap>`, leer las últimas N filas de `route_breadcrumbs` para esa ruta y dibujar un "trail" anterior con menor opacidad.
**Estado:** abierto

### #33 — route_breadcrumbs sin TTL — tabla crece sin tope
**Severidad:** importante (a 6 meses de operación)
**Fase afectada:** 3 / 5
**Síntoma:** No hay job que archive/elimine breadcrumbs viejos. 50 choferes × 8h × 1/90s × 30 días = ~480K rows/mes. A 6 meses ~3M rows. Sin TTL la tabla crece linealmente.
**Solución propuesta:** Cron mensual (n8n o Supabase scheduled function) que mueva rows >90 días a `route_breadcrumbs_archive` o las borre. Considerar partitioning por fecha si crece más.
**Estado:** abierto

### #34 — Marker del chofer no interpola movimiento entre broadcasts
**Severidad:** cosmético
**Fase afectada:** 3
**Síntoma:** Cada 8s el marker salta a la nueva posición. Visualmente brusco, da sensación de "pixelado" en lugar de movimiento real.
**Solución propuesta:** Animar transición con `requestAnimationFrame` interpolando entre posición anterior y nueva durante el intervalo de 8s. Library `mapbox-gl-animation` o custom.
**Estado:** abierto

### #35 — Re-asignar chofer en PUBLISHED no permitido (UX faltante)
**Severidad:** cosmético (cuando aparezca el caso real)
**Fase afectada:** 1
**Síntoma:** Si el chofer no llega o se reporta enfermo después de publicada la ruta, no hay UI para reasignar — la ruta queda con el chofer original asignado pero inutilizado.
**Solución propuesta:** Botón "Reasignar chofer" en PUBLISHED con confirmación. Server action: cancela push del anterior, asigna nuevo, manda push nuevo.
**Estado:** abierto

### #36 — Off-route detection usa distancia al vértice, no al segmento
**Severidad:** cosmético
**Fase afectada:** 2 (turn-by-turn)
**Síntoma:** En curvas cerradas (vértices muy juntos) puede falsa-positivar el "te desviaste" cuando el chofer va por la calle correcta. Mitigación actual: 3 updates seguidos lejos antes de marcar off-route.
**Solución propuesta:** Calcular distancia perpendicular al SEGMENTO más cercano del polyline. Trigonometría simple, ~15 líneas de código en `use-turn-by-turn.ts`.
**Estado:** abierto

### #37 — Hydration mismatch en StopCard (probable extensión del browser)
**Severidad:** cosmético (no afecta funcionalidad — React regenera)
**Fase afectada:** 2
**Síntoma:** Console muestra "Hydration failed because the server rendered HTML didn't match the client" apuntando al `<Link>` dentro de `<StopCard>`. React regenera el árbol y la UI funciona normal.
**Solución propuesta:** Reproducir en incógnito sin extensiones — si desaparece, era extensión (probable). Si persiste, agregar `suppressHydrationWarning` al Link como último recurso.
**Estado:** abierto

### #38 — Voz turn-by-turn en iOS Safari no garantiza es-MX
**Severidad:** cosmético
**Fase afectada:** 2
**Síntoma:** Web Speech API en iOS Safari puede no tener voz `es-MX` instalada — cae a `es-ES` o `es` genérica. Acento distinto, instrucción igual de comprensible.
**Solución propuesta:** Si el caso aparece, integrar TTS provider externo (Azure Speech, ElevenLabs) con voz consistente. Costo extra, requiere acuerdo con cliente.
**Estado:** abierto

---

## Cosméticos (futuro, no urgente)

### #9 — Distancias sin separador de miles
**Severidad:** cosmético
**Síntoma:** `1234.5 km` se ve raro. Mejor `1,234.5 km`.
**Solución propuesta:** `Intl.NumberFormat('es-MX').format(km)`.
**Estado:** abierto

### #10 — Rate limiting del optimizer
**Severidad:** cosmético (hasta que llegue carga real)
**Fase afectada:** 5+ (cuando haya múltiples tenants concurrentes)
**Síntoma:** Sin protección contra abuse — un atacante puede mandar 10K stops y bloquear el container.
**Solución propuesta:** Middleware en FastAPI con `slowapi`. Cap input size en el wrapper TS.
**Estado:** abierto

---

## Riesgos / asumptions descubiertos en Sprint 18 (ADR-032)

> Estos NO son bugs confirmados — son áreas de riesgo y assumptions a vigilar
> conforme la app entre en uso real. Se ascienden a "issue" si se manifiestan.

### #50 — AI mediator: clasificación errónea = mensaje real escalado como trivial
**Severidad:** importante
**Sprint:** S18.8
**Síntoma:** Claude Haiku con few-shots puede equivocarse — un chofer escribe "todo está bien, ya casi" cuando en realidad acaba de tener un accidente leve. AI clasifica trivial → admin no recibe push → problema escala sin que nadie atienda.
**Mitigaciones aplicadas:** sesgo a 'unknown' (escala), confidence guardado, audit completo en `chat_ai_decisions`.
**Solución futura:** revisar `SELECT category, COUNT(*) FROM chat_ai_decisions GROUP BY category` quincenal. Si % unknown > 20% o reportan caso real mal clasificado → ajustar prompt/few-shots. Considerar threshold de confidence mínimo (e.g., trivial solo si confidence > 0.85).
**Estado:** abierto

### #51 — visibilitychange iOS Safari puede no dispararse → gap event eterno
**Severidad:** importante
**Sprint:** S18.4
**Síntoma:** Si el chofer cierra abruptamente la PWA (kill app o crash), el listener `visibilitychange` puede no dispararse. Resultado: row en `route_gap_events` sin `ended_at`, queda activo indefinidamente. El admin ve al chofer en gris para siempre.
**Mitigación parcial:** cleanup del effect cierra gap con `end_reason='route_completed'` si la ruta termina.
**Solución propuesta:** cron horario que cierre gaps con `started_at < NOW() - INTERVAL '2 hours'` y `ended_at IS NULL` con `end_reason='timeout'`.
**Estado:** abierto

### #52 — route_transfer NO usa transacción Postgres → estado inconsistente posible
**Severidad:** importante
**Sprint:** S18.7
**Síntoma:** Server action `transferRouteRemainderAction` hace 5 inserts/updates sin transacción. Si falla a mitad (ej. Supabase cae después de crear ruta nueva pero antes de mover stops), queda con ruta nueva + stops en ruta vieja → inconsistencia operativa.
**Mitigación actual:** best-effort rollback (delete ruta nueva) en errores conocidos.
**Solución propuesta:** mover la lógica a una función SQL plpgsql con BEGIN/COMMIT real. O al menos un savepoint Postgres. Sprint 19+.
**Estado:** abierto

### #53 — chat_ai_decisions table crece sin tope (TTL faltante)
**Severidad:** cosmético (escala temporalmente)
**Sprint:** S18.8
**Síntoma:** Cada mensaje del chofer con texto crea un row de audit. ~50 choferes × 5 mensajes/día = 250 rows/día = 7.5K/mes = 90K/año.
**Solución propuesta:** función `archive_old_chat_ai_decisions(retention_days)` similar a la de breadcrumbs. Cron mensual.
**Estado:** abierto

### #54 — No validación de capacity en route transfer destino
**Severidad:** cosmético (V1 — capacity tracking ya es laxo)
**Sprint:** S18.7
**Síntoma:** Admin transfiere 8 paradas a un Kangoo (capacity 6 cajas). El sistema acepta la transferencia sin warning. Chofer destino recibe ruta imposible de cumplir.
**Solución propuesta:** validar `SUM(stops.demand[2]) <= vehicle.capacity[2]` y mostrar warning en el modal antes de confirmar.
**Estado:** abierto

### #55 — Trigger calc_route_actual_distance puede ser lento con 10K+ breadcrumbs
**Severidad:** cosmético
**Sprint:** S18.6
**Síntoma:** El trigger BEFORE UPDATE on routes itera todos los breadcrumbs de la ruta para calcular distancia haversine. Para una ruta de 12 horas con breadcrumb cada 90s = ~480 rows. Aceptable. Pero si en el futuro bajamos a 30s = 1440 rows → trigger empieza a tardar segundos en COMPLETE.
**Solución propuesta:** mover el cálculo a un job async (cron post-completion en lugar de trigger BEFORE UPDATE). O usar PostGIS ST_LineLength.
**Estado:** abierto

### #56 — Sound API requiere user interaction previa en iOS Safari
**Severidad:** cosmético
**Sprint:** S18.3
**Síntoma:** El primer beep tras cargar la página puede fallar silenciosamente en iOS Safari (autoplay policy — requiere interaction primero).
**Mitigación implícita:** después del primer click del admin, los beeps subsecuentes funcionan.
**Solución futura:** detectar autoplay policy + mostrar hint "click en cualquier parte para activar sonido" si la primera reproducción falla.
**Estado:** abierto

### #57 — Push browser puede entregar notif duplicada si chofer manda spam
**Severidad:** cosmético
**Sprint:** S18.3
**Síntoma:** Si chofer envía 5 mensajes en 10s, push fanout dispara 5 notifs. Admin recibe 5 chimes seguidos → ruido.
**Solución propuesta:** debounce de push fanout: si el último push fue <30s atrás para el mismo report, no disparar.
**Estado:** abierto

### #58 — zone_manager actual con sesión activa NO redirige al cambiar V2
**Severidad:** cosmético (transitorio)
**Sprint:** S18.1
**Síntoma:** Si un zone_manager tenía sesión activa antes de deploy de S18.1 y estaba en /map cuando llega el deploy, va a ver UI antigua hasta que recargue. Al recargar redirige a /incidents/active-chat.
**Mitigación:** transitorio, autoresuelve con refresh.
**Estado:** cerrado por naturaleza

### #59 — Falta columna `region` en stores para agrupar sub-regiones operativas
**Severidad:** importante
**Sprint:** backlog (post Sprint 19)
**Contexto:** ADR-033 consolidó tiendas Toluca bajo zone CDMX porque comparten CEDIS (CEDA). Se perdió el agrupador visual "Toluca/CDMX" en el UI. Por ahora solo trazable por prefijo `code='TOL-*'` o dirección.
**Síntoma:** Reportes de cliente que agrupen por región (ej. "ventas/entregas Toluca vs CDMX") tienen que parsear `code` o `address`. UI no permite filtrar tiendas por región operativa al crear ruta.
**Solución propuesta:** migración 028 que agregue `stores.region TEXT NULL` (o FK a tabla `regions` si crece la complejidad). Backfill: TOL-* → 'TOLUCA', CDMX-* → 'CDMX'. Update UI: filtro de region en `/routes/new` form. Update queries: `listStores({ region })`.
**Triggers para ejecutar:** cliente alcanza 50+ tiendas O agrega 2da región operativa O pide reportes por región.
**Estado:** abierto, parked

### #60 — Optimizer Railway necesita redeploy para que el fix `distance=0` aplique
**Severidad:** importante (bloqueante para field test)
**Sprint:** S19 (ADR-034)
**Contexto:** El fix Python (`profile=car` + `_backfill_distances_from_matrix`) está en `services/optimizer/main.py` local. Las rutas creadas hoy seguirán teniendo `total_distance_meters=0` hasta que Railway reciba el redeploy.
**Síntoma:** UI muestra "0 km · re-optimizar" en rutas creadas pre-deploy.
**Solución:** push branch + auto-deploy Railway. Después, re-optimizar rutas existentes que tengan `total_distance_meters=0` (resetToDraft + re-correr optimizer). Las rutas históricas COMPLETED no se tocan (snapshot histórico).
**Estado:** pendiente de deploy

### #61 — Reorder del chofer NO notifica al admin por push
**Severidad:** importante
**Sprint:** backlog
**Contexto:** ADR-035 implementó reorder en admin (notifica chofer) y reorder en chofer (NO notifica admin). Razón pragmática: un admin típicamente no está pegado al UI 24/7, y los reorders del chofer suelen ser pequeños (1-2 stops). Pero si el admin quiere reaccionar a un cambio del chofer (ej. coordinar con cliente), no se entera.
**Síntoma:** admin abre `/routes/[id]` 1 hora después y ve orden distinto sin saber cuándo cambió. El audit en `route_versions` lo dice, pero hay que ir a buscarlo.
**Solución propuesta:** crear `notifyAdminOfDriverReorder(routeId, driverName)` análogo al de chat (push al admin con tag específico). Reutilizar el sistema de `push_subscriptions` admin que ya existe.
**Estado:** abierto

### #62 — Reorder concurrente admin↔chofer no tiene lock optimista
**Severidad:** cosmético (probabilidad baja)
**Sprint:** backlog
**Contexto:** ADR-035: si admin y chofer reordenan en ventana de segundos, el último write gana. No hay version check ni transacción.
**Síntoma:** chofer reordena (versión 2). Antes de propagarse, admin reordena (versión 3). Se pierde el cambio del chofer (admin sobrescribe).
**Probabilidad:** baja en operación real (1 admin + 1 chofer + cambios espaciados).
**Solución propuesta:** agregar `?version=N` al payload de `reorderStopsAction`/`reorderStopsByDriverAction`. Server compara con BD y rechaza si hay diferencia ("La ruta cambió, recarga"). Versión actual se devuelve en cada select.
**Estado:** abierto

### #63 — Driver action escribe `route_versions` con service_role bypass de RLS
**Severidad:** importante (security audit)
**Sprint:** backlog
**Contexto:** ADR-035: `reorderStopsByDriverAction` usa `createServiceRoleClient()` para INSERT en `route_versions` y UPDATE en `routes.version`, porque las RLS de esas tablas son solo admin. El `created_by` es `auth.uid()` del chofer (correcto), pero la escritura efectiva no respeta RLS.
**Síntoma:** un atacante que logre RCE en el servidor podría escribir cualquier `route_versions` con cualquier reason/user. Las RLS no lo protegen.
**Solución propuesta:** agregar policy `route_versions_insert_driver` que permita INSERT cuando `created_by = auth.uid()` Y `route_id IN (SELECT routes.id WHERE drivers.user_id = auth.uid())`. También policy `routes_update_version_only` que permita UPDATE solo de la columna `version` y `updated_at` para chofer dueño. Migrar el action a usar sesión del chofer en vez de service_role.
**Estado:** abierto, security review

### #64 — Chofer puede reordenar paradas en orden absurdo sin validación geo
**Severidad:** cosmético (mitigación implícita: audit captura)
**Sprint:** backlog
**Contexto:** ADR-035: el reorder del chofer acepta cualquier permutación de paradas pendientes. No validamos contra distancias geo o "razonabilidad" de la ruta resultante.
**Síntoma:** chofer malicioso o por error mueve paradas a un orden subóptimo (zigzag, retorno innecesario). Aumenta combustible y tiempo. El admin solo lo ve post-mortem en el dashboard.
**Solución propuesta:** comparar la distancia total del nuevo orden (calculada con haversine rápido) vs el orden original. Si crece >50%, mostrar warning al chofer ("¿Seguro? El nuevo orden recorre 22 km más"). NO bloquear — el chofer puede tener razón válida.
**Estado:** abierto, baja prioridad

### #66 — No se pueden agregar paradas a rutas PUBLISHED/IN_PROGRESS
**Severidad:** importante
**Sprint:** backlog
**Contexto:** ADR-036 agregó `addStopToRouteAction` pero solo permite DRAFT/OPTIMIZED/APPROVED. Si la ruta ya está publicada y el dispatcher quiere agregar una tienda urgente, no hay flujo.
**Solución propuesta:** extender el action para PUBLISHED/IN_PROGRESS con: bump version + audit + push al chofer (similar a admin reorder ADR-035). El stop se agrega al final, sin ETA.
**Estado:** abierto

### #67 — AddStopButton carga TODAS las tiendas de la zona sin paginación/búsqueda
**Severidad:** cosmético (escala con tenant)
**Sprint:** backlog
**Contexto:** ADR-036 — el `<select>` puede tener 200+ tiendas si el cliente crece. Scroll inutilizable.
**Solución propuesta:** combobox con búsqueda por code/nombre (autocomplete). Reuse del componente que ya usa `/dispatches/[id]/route-stops-card.tsx` para mover paradas entre rutas.
**Estado:** abierto

### #68 — Modal de unassigned debería ser pre-creation (no post-creation con rollback)
**Severidad:** importante (UX correcto)
**Sprint:** S20
**Contexto:** ADR-036 fix #1 hizo cancel = borrar rutas. Funcional pero genera writes innecesarios cada vez que user cancela. El flujo correcto es preview ANTES de crear.
**Solución propuesta:** agregar `dryRun: boolean` a `createAndOptimizeRoute`. Si `dryRun=true`, ejecuta optimizer sin persistir y devuelve `{ preview, unassigned }`. UI corre dryRun primero, muestra modal, y solo si user acepta llama segunda vez con `dryRun=false`.
**Riesgo:** duplica costo de optimizer (Mapbox + Railway). Mitigación: cache en server action por hash de params (route, vehicles, stores) por 60s.
**Estado:** abierto

### #65 — Total turno calcula `totalShiftSeconds` desde Date.parse — sensible a TZ del server
**Severidad:** cosmético
**Sprint:** backlog
**Contexto:** ADR-034: el cálculo de "Total turno" en `/routes/[id]/page.tsx` usa `new Date(route.estimatedEndAt).getTime() - new Date(route.estimatedStartAt).getTime()`. Funciona porque ambos timestamps están en UTC con offset, pero si Postgres devuelve un formato no estándar (sin tz), Date.parse podría interpretar como local time.
**Síntoma:** en server con TZ distinta a UTC, el total podría off por horas. Hoy todo corre en UTC en Vercel, así que no se ve. Pero migrar a otro hosting podría romper.
**Solución propuesta:** usar `formatDuration` con segundos calculados explícitamente desde ISO strings parseados con `Temporal` o `date-fns` con TZ explícita.
**Estado:** abierto, latente

---

## Posibles bugs latentes (introducidos en este ciclo S19 pre-deploy)

### Bug-#L1 — Versión de ruta puede saltar si admin y chofer corren `incrementRouteVersion` simultáneamente
- **Cuándo:** caso #62 — race condition.
- **Síntoma:** version en BD = 5, luego dos UPDATEs casi simultáneos (chofer y admin) → ambos leen 5, ambos escriben 6. Una de las dos versiones del audit `route_versions` no corresponde con el snapshot real de stops.
- **Mitigación inmediata:** apoyarse en el timestamp `created_at` de route_versions para reconstruir orden.
- **Fix proper:** issue #62 (lock optimista).

### Bug-#L2 — `_backfill_distances_from_matrix` puede fallar silenciosamente si VROOM cambia el shape de `steps`
- **Cuándo:** Railway recibe nueva versión de pyvroom que omite `location_index`.
- **Síntoma:** suma de distancias se queda en 0 (try/except absorbe IndexError). Volvemos al bug original.
- **Mitigación:** monitorear logs de Railway con `[optimizer]` keyword. Agregar metric `route.distance_was_backfilled` para alertar si pasa frecuentemente.

### Bug-#L3 — `notifyDriverOfRouteChange` reusa el mismo `tag` que `notifyDriverOfPublishedRoute`
- **Cuándo:** chofer recibe push "Nueva ruta asignada", luego admin reordena → llega push "Tu ruta cambió" que SUSTITUYE la anterior. Si el chofer aún no había clickeado la primera, pierde el contexto.
- **Mitigación:** comportamiento aceptable (la nueva push tiene la URL correcta). Si confunde a usuarios, dar tags distintos.

### Bug-#L4 — Admin reorder POST-PUBLISH NO invalida métricas (distance/duration/ETAs)
- **Cuándo:** admin reordena PUBLISHED. Las ETAs siguen siendo las del orden original.
- **Síntoma:** la app driver muestra "ETA 09:48" en una parada que ahora va a llegar a las 11:00.
- **Mitigación:** decisión consciente (ADR-035) — re-optimizar invalidaría confianza del chofer en el orden recibido. Documentar que "ETA es referencia, no compromiso".
- **Fix futuro:** botón opcional "Re-calcular ETAs sin re-optimizar" que solo re-corre haversine sobre el nuevo orden.

### Bug-#L5 — Driver action de reorder NO valida que la ruta esté del día actual
- **Cuándo:** chofer tiene ruta hoy IN_PROGRESS y otra PUBLISHED para mañana. El query `routes.eq('date', today)` filtra correctamente, pero si el chofer tiene 2 rutas el mismo día (escenario edge: un día de transferencias múltiples), `.maybeSingle()` daría error.
- **Mitigación:** raro; constraint UNIQUE(driver_id, date) sobre rutas activas existe (idx_routes_vehicle_date_active sobre vehicle, no driver). Verificar si hay equivalente para driver.

---

## Attack vectors / Security review (pre-deploy S19)

### AV-#1 — Chofer puede impersonar otro chofer si compromete cookie
- **Vector:** robo de session cookie del chofer A → atacante reordena las paradas de la ruta de A.
- **Impacto:** baja-media. Solo afecta una ruta del día. Audit en `route_versions` registra el evento (created_by = chofer A), no captura el robo.
- **Mitigación actual:** Supabase Auth tiene token expiry; cookies con httpOnly/secure.
- **Mejora:** rate-limit del action `reorderStopsByDriverAction` (ej. máx 10 reorders/hora). Aún no implementado.

### AV-#2 — Service role bypass en `reorderStopsByDriverAction`
- **Vector:** RCE en el servidor del driver app → atacante usa `createServiceRoleClient()` para escribir cualquier cosa en `route_versions`/`routes`.
- **Impacto:** alto. Service role bypass-ea TODA la RLS del proyecto.
- **Mitigación actual:** ninguna específica — el service role ya estaba expuesto al server side desde S18 (push fanout, chat AI mediator). Esto solo amplía la superficie.
- **Mejora:** issue #63 — migrar a sesión del chofer + agregar RLS específica para que el chofer pueda UPDATE solo `routes.version` propio.

### AV-#3 — Admin reorder sin verificación de "¿la ruta es de la zona del admin?"
- **Vector:** admin de zona X (¿zone_manager con permisos elevados?) reordena rutas de zona Y.
- **Impacto:** medio. Hoy `requireRole('admin','dispatcher')` no filtra por zona — un admin/dispatcher es global. Si en futuro hay "admin per zona" (zone_manager elevado), el action no lo enforce.
- **Mitigación actual:** modelo V2 actual (post-S18) no tiene "admin de zona". Toda la operación es 1 admin global hoy.
- **Mejora:** agregar zone check al action si se introduce el concepto.

### AV-#4 — Stops sequence puede usarse para inferir info de competidores
- **Vector:** atacante con cualquier rol authenticated lee stops por sequence → puede inferir patrones de ruta del cliente (qué tiendas son atendidas primero, etc.).
- **Impacto:** baja (solo dentro de un tenant; ADR-001 cada cliente tiene proyecto Supabase aislado).
- **Mitigación:** RLS `stops_select` ya restringe via `routes_select` policy. Driver solo ve su ruta. Zone manager solo ve su zona. No hay leak inter-zona.

### AV-#5 — `notifyDriverOfRouteChange` reason expuesto al chofer
- **Vector:** la razón pasada al push notif aparece literal en el body. Si admin escribe info sensible en el reason, el chofer lo ve.
- **Impacto:** bajo. Hoy el reason es hardcoded ("Las paradas pendientes fueron reordenadas").
- **Mitigación:** documentar que `reason` debe ser sanitizado si se expone a UI futura. No accept user input en el reason del push.

### AV-#6 — Geocoding Toluca con Nominatim NO usa HTTPS verification
- **Vector:** si Nominatim API queda en man-in-the-middle, atacante devuelve coords falsas.
- **Impacto:** medio. Ruta pasaría por coords erróneas; el chofer iría al lugar equivocado, anti-fraude geo (>1km de la tienda) lo detecta y no permite check-in.
- **Mitigación:** las coords están en BD. Cliente debería validar visualmente cada tienda en mapa antes de operar.
- **Mejora:** anotar coords como "geocoded" vs "verified" en stores; UI mostrar warning hasta que cliente verifique.

---

## Resumen

| Categoría | Abiertos |
|---|---|
| Críticos | 0 |
| Importantes | 12 (#12, #22, #25, #29, #31, #32, #33, #50, #51, #52) |
| Cosméticos | 18 (#9, #10, #20, #23, #26, #27, #28, #34, #35, #36, #37, #38, #53, #54, #55, #56, #57) |

**Última actualización:** 2026-05-02, tras Sprints 14-16 (Tiros ADR-024, Mover paradas ADR-025, Theme + Mapa en vivo ADR-026). Cierre limpio para nueva sesión. **26 ADRs, 20 migraciones, 13 importantes / 13 cosméticos abiertos.** Listo para Fase 3 (dashboard cliente).
**ADRs nuevos en este ciclo:** ADR-013 a ADR-018.
**Resueltos en este ciclo:** Push real, replay del recorrido, asignación inline de chofer, navegación in-app, turn-by-turn con voz.
**Issues nuevos:** #36 (off-route precision), #37 (hydration extension), #38 (es-MX voice fallback).
**Issues nuevos:** #31 (iOS watchPosition), #32 (replay tardío), #33 (TTL breadcrumbs), #34 (interpolación marker), #35 (reasignar en PUBLISHED).
**Total acumulado resuelto:** 6 críticos + 10 importantes + 4 fixes runtime = 20 issues cerrados.
