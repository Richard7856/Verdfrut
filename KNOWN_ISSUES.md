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

### #11 — Doble apertura del invite/recovery link consume el token
**Severidad:** importante
**Fase afectada:** 2
**Síntoma:** Cuando el admin manda el invite link por WhatsApp/iMessage, el preview link del cliente de mensajería precarga la URL en background. Eso consume el token de un solo uso. Cuando el chofer hace clic, ve "Link inválido o expirado".
**Solución propuesta:** Migrar `verifyOtp`/`exchangeCodeForSession` a PKCE flow con verificador en localStorage del browser; el preview no completa el handshake porque no tiene el verifier. Alternativa rápida: añadir botón "Regenerar link" prominente cuando aparece el error.
**Estado:** abierto

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

### #14 — Allow-list de Redirect URLs no automatizada per tenant
**Severidad:** importante
**Fase afectada:** 2 / 6
**Síntoma:** Cada nuevo tenant requiere editar manualmente la allow-list en Supabase Dashboard → Auth → URL Configuration. `provision-tenant.sh` no la configura.
**Solución propuesta:** Agregar paso al provision script que llame Supabase Management API (`PATCH /v1/projects/{ref}/config/auth`) para setear las redirect URLs.
**Estado:** abierto

### #15 — Sin auto-logout por inactividad en driver PWA
**Severidad:** importante
**Fase afectada:** 2
**Síntoma:** Si el chofer presta el teléfono o lo pierde, la sesión permanece activa indefinidamente. No hay timeout de inactividad.
**Solución propuesta:** Hook que escuche `visibilitychange` + `focus` y haga `signOut` tras N horas inactivas. Considerar 8-12 h (jornada típica). Persistir last-active timestamp.
**Estado:** abierto

### #16 — Reconciliación de auth.user huérfanos
**Severidad:** importante
**Fase afectada:** 2 / 6
**Síntoma:** Si `inviteUser` falla a mitad del flujo (entre `inviteUserByEmail` y `INSERT user_profiles`), el rollback es best-effort. Puede quedar `auth.user` sin profile correspondiente. Login posterior con ese email da "Perfil no configurado".
**Solución propuesta:** Job nocturno que detecte `auth.users` sin row correspondiente en `user_profiles` (creados >1h atrás) y los elimine o alerte. También: envolver el flow en RPC con savepoint en Postgres.
**Estado:** abierto

### #17 — Sin cola offline (IndexedDB outbox) en flujo entrega
**Severidad:** importante
**Fase afectada:** 2
**Síntoma:** Si el chofer pierde red en medio del flujo (subway, semáforo en zona muerta, tienda en sótano), las server actions fallan con errores de red. El `currentStep` queda en el último persistido pero las fotos/datos no suben hasta retomar la red. UX: el chofer ve error y puede pensar que su trabajo no quedó guardado.
**Solución propuesta:** Cola IndexedDB con shape `{ id, type: 'patch'|'evidence'|'advance'|'submit', payload, attempts, lastError, createdAt }`. Worker que reintenta con backoff cuando vuelve la red. UI muestra badge "X cambios pendientes" y permite retry manual.
**Estado:** abierto

### #18 — Carrito de incidencias en flujo entrega es stub
**Severidad:** importante
**Fase afectada:** 2
**Síntoma:** El step `incident_cart` solo registra un placeholder genérico en `incident_details`. El chofer no puede declarar productos, cantidades, tipos de incidencia (rechazo/faltante/sobrante/devolución). El encargado tiene que pedir el detalle por chat/voz.
**Solución propuesta:** UI completa con buscador de productos del catálogo (cuando exista), cantidad, unidad, tipo de incidencia, motivo. Persistir en `incident_details` jsonb estructurado. Después abrir chat con encargado pre-poblando el contexto.
**Estado:** abierto

### #19 — OCR de tickets pendiente (waste_ticket_review, receipt_review)
**Severidad:** importante
**Fase afectada:** 2 / 4
**Síntoma:** Los steps de revisión post-foto sólo muestran un mensaje "todo bien, continuar". El chofer no ve datos extraídos (número, fecha, total) y no hay validación contra montos esperados. La columna `ticket_data` queda NULL.
**Solución propuesta:** Integrar `@verdfrut/ai` extractTicket en server action que dispara después del upload. Mostrar UI de revisión con campos editables, botón "confirmar" que setea `ticket_extraction_confirmed=true`.
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

## Resumen

| Categoría | Abiertos |
|---|---|
| Críticos | 0 |
| Importantes | 16 (#11–#19, #22, #24, #25, #31, #32, #33) |
| Cosméticos | 9 (#9, #10, #20, #23, #26, #27, #28, #34, #35) |

**Última actualización:** 2026-05-02, tras implementar GPS broadcast + UI asignación chofer (ADR-013, ADR-014).
**Resueltos en este ciclo:** #21 (GPS broadcast), #24 (drag-drop reorder de paradas — multi-route map view + sortable stops).
**Issues nuevos:** #31 (iOS watchPosition), #32 (replay tardío), #33 (TTL breadcrumbs), #34 (interpolación marker), #35 (reasignar en PUBLISHED).
**Total acumulado resuelto:** 6 críticos + 10 importantes + 4 fixes runtime = 20 issues cerrados.
