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
