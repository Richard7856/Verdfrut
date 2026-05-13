# DECISIONS — VerdFrut

Registro de decisiones técnicas no triviales. Cada entrada documenta el contexto, la decisión, alternativas consideradas, riesgos y oportunidades de mejora.

> Formato ADR (Architectural Decision Record). Las decisiones se agregan al final, nunca se editan retroactivamente — si una decisión cambia, se crea una nueva entrada que la supersede y se enlaza.

---

## [2026-04-30] ADR-001: Multi-tenant — Un proyecto Supabase por cliente

**Contexto:** VerdFrut sirve a empresas distribuidoras competidoras (OXXO, Neto). Una fuga de datos entre tenants por mala configuración de RLS sería catastrófica (legal, comercial, reputacional). Además, cada cliente espera aislamiento operativo: que un problema con un cliente no afecte a otro.

**Decisión:** Cada cliente tiene su propio proyecto Supabase. VerdFrut tiene un proyecto separado (control plane) con datos agregados (sin PII). Las zonas dentro de un cliente se separan con RLS por columna `zone_id`.

**Alternativas consideradas:**
- *Un solo proyecto con `tenant_id` + RLS:* descartado por riesgo de leak entre competidores. Una sola política mal escrita expone datos de todos.
- *Un proyecto por zona:* descartado por carga operativa. Un cliente con 30 zonas = 30 proyectos a mantener, migrar y monitorear.
- *DB compartida con schemas separados (PostgreSQL `SCHEMA`):* descartado porque Supabase no expone bien esta abstracción y complica el uso de Auth/Realtime.

**Riesgos / Limitaciones:**
- Migraciones cross-tenant: cada cambio de schema debe correrse en N proyectos. Mitigación: script central que itera sobre todos los proyectos en `scripts/migrate-all-tenants.sh`.
- Carga operativa de provisioning: crear un cliente requiere crear proyecto, correr migraciones, configurar storage, crear admin. Mitigación: script desde día 1 (`scripts/provision-tenant.sh`), automatización con n8n a 5+ clientes.
- Costo: Supabase Pro cuesta ~$25/mes/proyecto. A 10 clientes = $250/mes. Aceptable porque el cliente paga el costo.

**Oportunidades de mejora:**
- Si Supabase libera "organizations" con billing por org pero proyectos hijos compartiendo recursos, evaluar consolidación.
- Considerar Supabase Branching para staging compartido entre tenants.

---

## [2026-04-30] ADR-002: Optimizador self-hosted (FastAPI + VROOM)

**Contexto:** El motor de optimización de rutas es el corazón del producto. Las opciones managed (Google Routes Optimization API) cobran por shipment, generando costos lineales con el uso. A 10 clientes × 200 paradas/día × 30 días = 60,000 shipments/mes × $0.01 = $600/mes solo en optimización, escalando sin control.

**Decisión:** FastAPI service en Python que envuelve VROOM (binario C++ libre y rápido). Corre como Docker container sibling de las apps Next.js en el mismo VPS. Costo fijo ($0 por request).

**Alternativas consideradas:**
- *Google Routes Optimization API:* alta calidad pero costo lineal incontrolable. Descartado.
- *OpenRouteService (hosted):* free tier con límites ambiguos, dependencia externa. Descartado.
- *OR-Tools puro:* más flexible para restricciones complejas pero más lento (200ms-2s vs ~50ms de VROOM). Considerado como fallback futuro.
- *Algoritmo propio (Greedy/Hill Climbing):* descartado, reinventar la rueda con peor calidad que VROOM.

**Riesgos / Limitaciones:**
- VROOM no soporta restricciones complejas tipo "este camión debe visitar A antes que B por refrigeración". Mitigación: cuando aparezca el caso, agregar OR-Tools como fallback detrás del mismo API de FastAPI.
- Operativa de mantener un servicio adicional. Mitigación: Docker container, monitoreo básico vía Traefik.
- Calidad de matriz de distancias afecta calidad de ruta. Empezamos con Mapbox Directions API; si crece costo, OSRM self-hosted.

**Oportunidades de mejora:**
- Cache de matriz de distancias entre paradas frecuentes (mismas tiendas día tras día).
- Precomputar matriz nocturna para todas las tiendas activas del cliente.

---

## [2026-04-30] ADR-003: GPS via Supabase Realtime Broadcast (no DB writes)

**Contexto:** GPS tracking continuo de choferes activos. 50 choferes × 1 update/5s × 8h jornada = 288K mensajes/día/cliente. Si cada update es un INSERT a Postgres, en un mes son 8.6M filas/cliente, colapsando el plan Pro de Supabase (8GB) y degradando performance.

**Decisión:** Usar Supabase Realtime Broadcast channels para datos transitorios. El chofer publica posición a `gps:{route_id}` y los listeners (encargado de zona, panel logístico) reciben en tiempo real. SIN escritura a DB. Solo se escribe a DB en eventos discretos: inicio/fin de ruta, llegada/salida de parada, alerta de desviación.

**Alternativas consideradas:**
- *Postgres Changes (DB triggers):* descartado, escribe cada update a DB.
- *Custom WebSocket server (Node + ws):* 2-3 semanas de trabajo, cero beneficio sobre lo que Supabase ofrece gratis.
- *HTTP polling:* añade carga al server Next.js, lag de 5s en supervisión, no es realmente "realtime".
- *MQTT broker:* infra adicional, sin justificación para nuestra escala.

**Riesgos / Limitaciones:**
- Broadcast no persiste mensajes — si un listener se desconecta, pierde los GPS de ese intervalo. Mitigación: aceptable, el listener volverá a recibir desde el momento de reconexión, y el dato histórico no es crítico (el chofer ya pasó por ahí).
- Para análisis post-hoc de ruta (ej. "¿el chofer se desvió?"), necesitamos algunos breadcrumbs guardados. Mitigación: chofer escribe en lote cada N minutos a tabla `route_breadcrumbs` (~10-20 puntos por ruta).
- Límite de mensajes Broadcast en Supabase (varía por plan). Monitorear y subir plan si necesario.

**Oportunidades de mejora:**
- Si en el futuro se requiere replay completo de ruta, agregar batching más agresivo a `route_breadcrumbs`.

---

## [2026-04-30] ADR-004: PWA primero, nativa si hace falta

**Contexto:** El chofer usa la app en su teléfono móvil. iOS mata service workers de PWAs agresivamente y limita GPS background. Una app nativa resolvería esto pero añade 2-3 meses al timeline (React Native/Expo, App Store/Play Store, dos código bases o framework cross-platform).

**Decisión:** Empezar con PWA Next.js 16 + Serwist. Diseñar UX para minimizar dependencia de background (Wake Lock API para mantener pantalla encendida, navegación fullscreen para que el chofer no salga de la app). Migrar a Expo en Fase 7 SOLO si iOS deteriora la operación a punto de afectar negocio.

**Alternativas consideradas:**
- *Nativa desde día 1 con Expo:* retraso de 2-3 meses sin certeza de necesidad. Descartado para V1.
- *Solo PWA sin plan B:* riesgo si iOS bloquea la operación. Mitigación: el plan incluye Fase 7 con criterios claros.
- *Wrapper nativo simple (Capacitor):* considerado, pero añade complejidad de stores sin resolver fundamentalmente el problema de background si Apple endurece políticas.

**Riesgos / Limitaciones:**
- Si todos los choferes están en iOS y el supervisor pierde tracking continuo, la operación puede degradarse. Mitigación: el modelo asume que llegada/salida de parada son los datos confiables (reportados manualmente), no el GPS continuo.
- PWAs son menos descubribles que apps nativas. Mitigación: el cliente onboardea a sus choferes, no es un canal de adquisición.

**Oportunidades de mejora:**
- Fase 7 con Expo reutilizando `packages/types`, `packages/supabase`, `packages/flow-engine`.
- Considerar TWA (Trusted Web Activity) para Android como paso intermedio si solo Android necesita publicación en store.

---

## [2026-04-30] ADR-005: Platform = una sola app Next.js con route groups

**Contexto:** El panel logístico, el dashboard de ventas y el panel de configuración del cliente comparten la misma autenticación, el mismo tenant, los mismos datos de DB. Separarlos en apps independientes duplica config, deploy, y client setup.

**Decisión:** Una sola app Next.js (`apps/platform`) con route groups del App Router:
- `(auth)/` — login, registro
- `(logistics)/` — crear/optimizar/aprobar/publicar rutas
- `(dashboard)/` — KPIs, métricas, reportes
- `(settings)/` — tiendas, camiones, usuarios, zonas

El acceso por rol se valida en middleware.

**Alternativas consideradas:**
- *Apps separadas (logistics, dashboard, settings):* triplica deploys, environment config, build pipelines. Sin beneficio claro.
- *Microfrontends:* over-engineering brutal para este tamaño.

**Riesgos / Limitaciones:**
- Si el bundle crece mucho, todos los usuarios bajan código que no usan. Mitigación: Next.js code-splitting por ruta es automático.
- Si en el futuro un equipo distinto opera el dashboard, podría justificarse separar. Por ahora, somos uno.

---

## [2026-04-30] ADR-006: Mapas con Mapbox GL JS

**Contexto:** Necesitamos renderizado de mapa con tracking de flota en tiempo real para el supervisor de zona, vista de rutas para el chofer, y visualización de rutas optimizadas en el panel logístico. Las dos opciones serias son Mapbox y Google Maps.

**Decisión:** Mapbox GL JS. 50K free map loads/mes (suficiente hasta ~30 tenants), tiles vectoriales (mejor experiencia de pan/zoom para fleet tracking que raster), $5/1K overage (40-50% más barato que Google), opción futura de self-host con OpenMapTiles.

**Alternativas consideradas:**
- *Google Maps Platform:* mejor geocoding en México, Street View útil para verificación visual de tienda. Más caro a escala (~$7/1K vs $5/1K).
- *Leaflet + OSM:* gratis pero raster tiles sin la suavidad necesaria para tracking continuo.

**Riesgos / Limitaciones:**
- Geocoding de direcciones mexicanas es ligeramente peor en Mapbox que en Google. Mitigación: en Fase 1 usar Mapbox para todo; si geocoding es problema, usar Google solo para esa función específica detrás del wrapper de `packages/maps`.

**Oportunidades de mejora:**
- Si crece el costo, self-host de OpenMapTiles + OSRM elimina dependencia y costo de Mapbox.

---

## [2026-05-01] ADR-007: GRANT EXECUTE explícito a `authenticated` en funciones helper de RLS

**Contexto:** La migración `011_security_hardening` hizo `REVOKE EXECUTE ... FROM PUBLIC` en las funciones `current_user_role()` y `is_admin_or_dispatcher()` por defensa en profundidad, pero no re-grantó `EXECUTE` al rol `authenticated`. Como las RLS policies de `user_profiles` (y otras tablas) invocan estas funciones, todo SELECT de un usuario logueado real fallaba con `permission denied for function is_admin_or_dispatcher`. No se detectó hasta el primer login real (los queries vía MCP/scripts usan `service_role`, que tiene `EXECUTE` por default).

**Decisión:** Agregar migración `014_grant_rls_helper_execute` que hace `GRANT EXECUTE ... TO authenticated` en ambas funciones. Las funciones son seguras de exponer:
- `current_user_role()` es `SECURITY DEFINER` y sólo devuelve el rol del propio `auth.uid()` — no hay leak entre usuarios.
- `is_admin_or_dispatcher()` sólo delega en la anterior.

**Alternativas consideradas:**
- *Mover toda la lógica de RLS a expresiones inline (sin funciones helper):* descartado, duplica código y empeora mantenibilidad. Las funciones existen precisamente para centralizar la lógica de roles.
- *Hacer las funciones SECURITY DEFINER + GRANT EXECUTE a PUBLIC:* descartado, `PUBLIC` incluye `anon` (usuarios no logueados) y no hay razón para que `anon` evalúe roles.
- *No revocar de PUBLIC en la 011 desde el inicio:* en retrospectiva, la 011 fue overkill. La 014 corrige sin volver atrás.

**Riesgos / Limitaciones:**
- Cualquier nueva función helper de RLS que se agregue en el futuro debe explícitamente `GRANT EXECUTE ... TO authenticated`. Mitigación: documentar en `09_helper_functions.sql` y en este ADR.
- Si en el futuro necesitamos helpers que NO deban ser callable directo por usuarios (ej: una función que devuelva información sensible), no usar este patrón — usar policies inline.

**Oportunidades de mejora:**
- Agregar test de smoke en CI: `SET ROLE authenticated; SELECT 1 FROM user_profiles WHERE id = '...';` con un user fixture, para detectar regresiones de este tipo antes de prod.
- Convención: toda función helper de RLS termina en `_for_rls()` y vive en un schema `rls_helpers` con GRANT estándar al crear el schema.

---

## [2026-05-01] ADR-008: Onboarding de usuarios — invite con set-password forzado + admin override

**Contexto:** El primer flujo "invite by email" de Supabase mandaba magic link, pero la driver app no tenía página de callback que recibiera el token y permitiera al chofer establecer una contraseña. Resultado: el chofer abría el link, era llevado al login normal, le pedían contraseña que nunca creó. Operativamente, además, los choferes pueden no tener email funcional en el teléfono (Gmail desactualizado, sin acceso, en spam), lo que rompe cualquier flujo dependiente del email para onboardear.

**Decisión:** Implementar dos canales paralelos:
1. **Canal estándar (Opción B):** Supabase manda email con invite link. El link apunta a `{driver_app}/auth/callback`, que intercambia el token por sesión y redirige a `/auth/set-password`. El usuario establece su contraseña permanente y puede operar.
2. **Canal alterno (Opción C):** Junto con la invitación email, el platform genera un invite link copiable que el admin puede pegar en WhatsApp/SMS para entregárselo al chofer en bodega. Mismo flujo de set-password al abrirlo.

Adicionalmente:
- Columna `user_profiles.must_reset_password BOOLEAN DEFAULT FALSE` (migración 016).
- `requireDriverProfile()` en la driver app redirige a `/auth/set-password` si flag=TRUE.
- Botón "Reset" en `/settings/users` que setea el flag y devuelve un recovery link copiable (caso "chofer olvidó contraseña" o "credenciales comprometidas").
- El admin bootstrapeado a mano (yo, primer admin) tiene `must_reset_password=FALSE` por default y no se ve afectado.

**Alternativas consideradas:**
- *Magic link puro sin contraseña:* descartado, frágil para choferes sin email funcional confiable.
- *Admin asigna contraseña inicial directamente desde el dash de Supabase:* funciona como escape hatch puntual pero no escala — viola separación de responsabilidades (admin no debería conocer contraseñas de choferes), y el admin del cliente (ej: jefe de logística de Neto) no debería tener que entrar al dashboard de Supabase para esto.
- *Código numérico (PIN) en vez de contraseña:* descartado por simplicidad — usar contraseña estándar permite reusar todo el flujo de Supabase Auth (recovery, security settings, etc).
- *Auto-asignar password aleatoria al invitar y mostrarla al admin:* descartado, mismo problema de separación que la anterior.

**Riesgos / Limitaciones:**
- El recovery link tiene TTL (default 24 h en Supabase). Si el admin lo genera y el chofer no lo abre en ese tiempo, hay que regenerar. Mitigación: el botón "Reset" se puede invocar las veces necesarias.
- El link tiene un solo uso. Si el chofer lo abre dos veces (o se previsualiza por algún antivirus que sigue links), el segundo intento falla.
- Si el admin pierde el link copiado y no hay email, debe regenerar.
- `must_reset_password=TRUE` aplica a TODOS los logins, no solo al primero. Si el admin invita pero antes de que abra el link cambia algo, mantiene el flag — esto es correcto: hasta que NO haya un set-password exitoso, el flag baja. Sin race conditions.

**Oportunidades de mejora:**
- Agregar `last_password_changed_at` para forzar reset cada N días en clientes que requieran rotación.
- Permitir 2FA opcional para roles admin/dispatcher en Fase 5+.
- En Fase 6 (control plane), hacer que el invite del primer admin de cada tenant también pase por este flow (hoy es manual con SQL).

---

## [2026-05-01] ADR-009: Server-side `verifyOtp` en vez de `action_link` para callbacks de auth

**Contexto:** Al implementar el flujo de invite/recovery (ADR-008), usamos directamente el `action_link` que devuelve `supabase.auth.admin.generateLink()`. Ese link apunta al endpoint público `/auth/v1/verify` de Supabase, que verifica el token y redirige a nuestro `redirect_to` con los tokens **en el HASH** (`#access_token=...&refresh_token=...`). El fragmento de URL nunca llega al servidor (lo procesa solo el browser), así que un Route Handler server-side recibe la request sin token y devuelve "Link inválido o expirado".

**Decisión:** En vez de usar el `action_link` directamente, extraer `hashed_token` + `verification_type` de las propiedades devueltas por `generateLink` y construir nuestro propio link `{redirectTo}?token_hash=X&type=Y`. El Route Handler `/auth/callback` llama `supabase.auth.verifyOtp({ token_hash, type })` server-side, lo que verifica el token, marca como usado, y crea sesión via SSR cookies. Patrón oficial recomendado por Supabase para PKCE/SSR (`https://supabase.com/docs/guides/auth/server-side/email-based-auth-with-pkce-flow`).

Implementado en `users.ts:buildServerCallbackLink()`. Aplica a `inviteUser` y `generateRecoveryLink` (y por extensión `forcePasswordReset`).

**Alternativas consideradas:**
- *Mover el procesamiento al cliente (Client Component que lee el hash):* funciona pero rompe el patrón de server-side auth, requiere page hydration extra antes de redirigir, y peor UX (flash de pantalla).
- *Cambiar el flow type del proyecto Supabase:* afectaría también el SDK cliente (`signInWithPassword`, etc), riesgo amplio para arreglar un caso puntual.
- *Dejar el `action_link` y agregar una página intermedia de JS que lea el hash:* duplica código y agrega un round-trip innecesario.

**Riesgos / Limitaciones:**
- `token_hash` queda en query string → puede aparecer en logs de access (Vercel, Traefik, browser history). Mitigación: el token es de un solo uso y TTL 24h, no es persistente.
- Si Supabase deprecia el formato `token_hash` (han cambiado cosas en el pasado), hay que migrar. Mitigación: el callback también acepta `?code` (PKCE) como fallback.

**Oportunidades de mejora:**
- Migrar a `?code` puro con PKCE flow completo cuando todos los flujos del proyecto lo usen.
- Loggear los `verifyOtp` exitosos/fallidos a una tabla de audit en vez de solo `console.error`.

---

## [2026-05-01] ADR-010: Flujo entrega — máquina de pasos centralizada en `@tripdrive/flow-engine`, persistencia en `delivery_reports.current_step`

**Contexto:** El flujo de entrega del chofer tiene 14 pasos lineales con bifurcaciones (incident_check → cart o product_arranged; waste_check → waste_ticket o receipt_check; etc.). La lógica de "¿cuál es el siguiente paso?" puede vivir en (a) la UI cliente, (b) el server, o (c) un package compartido. Tomar la decisión incorrecta lleva a duplicación o a inconsistencias entre quién manda al chofer al siguiente paso vs quién persiste el estado.

Además, el chofer puede cerrar la app a la mitad (sin red, batería muerta, llamada). Al volver debe resumir donde estaba.

**Decisión:**
- **Lógica de transiciones** vive en el package puro `@tripdrive/flow-engine` (`nextEntregaStep(currentStep, ctx)`). Funciones determinísticas, testeables sin DB ni browser.
- **Estado actual del flujo** se persiste en `delivery_reports.current_step` (string, validado en runtime contra los enums TS). Al volver al detalle, el server lee este campo y la UI renderiza el step correspondiente.
- **Contexto del flujo** (`hasIncidents`, `hasMerma`, etc.) vive en memoria del cliente para calcular el next, y SOLO los flags que el encargado debe ver (ej. `has_merma`) se persisten en columnas dedicadas. Los demás se infieren del estado del JSON `evidence` y `incident_details`.
- Cada step es un componente cliente independiente que recibe `report`, `route`, `store`, helpers para mutar (`onSaveEvidence`, `onPatch`, `onSubmit`), y `advanceTo(next)`. Aislados — agregar un nuevo step solo requiere tocar el package + un nuevo componente.
- Componente orquestador `StopDetailClient` mapea `current_step` → componente correspondiente. El switch es exhaustivo gracias a `EntregaStep` discriminated union.

**Alternativas consideradas:**
- *Toda la lógica en un solo componente con `useReducer`:* archivo gigante, difícil de testear, transiciones acopladas a renderizado.
- *Server-side flow runner con server-rendered steps puros:* cada interacción es full reload, peor UX en móvil con red intermitente.
- *State machine via XState:* potente pero overkill para 14 pasos lineales. Reusable solo si crecen los flujos a 50+ steps con paralelismo.
- *Persistir el ctx (`hasIncidents`, etc.) en metadata jsonb:* viable pero acumula deuda — el ctx local se reconstruye de los datos persistidos al recargar.

**Riesgos / Limitaciones:**
- Si el chofer cierra la app entre completar un step y persistir el next, al volver puede recalcular un next distinto (porque el `ctx` se perdió). Mitigación: la próxima vez que pasa por `incident_check` ve la pregunta de nuevo y elige.
- El componente `StopDetailClient` reúne ~14 imports — no es problema funcional pero el bundle del chofer crece. Mitigación: code-splitting por step si se vuelve un issue (`React.lazy()`).
- El `currentStep` en DB es `text`, no enum SQL. Si alguien lo escribe a mano fuera del flujo (admin, encargado), puede dejar al chofer en un step inválido. Mitigación: ningún path de la app permite escribirlo arbitrariamente; agregar CHECK constraint si en algún momento.

**Oportunidades de mejora:**
- Tests unitarios de `nextEntregaStep` para cubrir todas las combinaciones de ctx.
- Migrar `current_step` a un ENUM SQL específico por type (entrega/cerrada/báscula) si el churn se reduce.
- Soporte para "back" (retroceder un step para corregir). Hoy es lineal forward-only.
- Cola offline IndexedDB: en lugar de fallar si no hay red, encolar las mutaciones (advance, patch, evidence) y reintentar. Pendiente para sprint siguiente.

---

## [2026-05-01] ADR-011: Tabla `depots` (CEDIS) como entidad de primera clase + plantillas CSV

**Contexto:** Hasta hoy, el "punto de partida y regreso" de cada vehículo vivía como columnas `depot_lat/depot_lng` en `vehicles`. Para una operación con 30 camiones que comparten un solo CEDIS, eso significaba 30 lugares para actualizar si el CEDIS cambia de dirección. Además no había forma de listar/editar CEDIS independiente del vehículo.

Por otro lado, onboardear un cliente nuevo requería crear manualmente decenas o cientos de tiendas, vehículos y usuarios desde la UI uno por uno. Sin estructura para preparar datos en bulk en Excel/Sheets, los admins se atoraban.

**Decisión:**
1. **Tabla `depots`** (`code`, `name`, `address`, `lat`, `lng`, `contact_*`, `notes`, `zone_id`, `is_active`). FK opcional `vehicles.depot_id` que, si está set, sobrescribe `depot_lat/lng`. RLS por zona patrón consistente con `stores`.
2. **Resolución del depot en el optimizer**: nuevo parámetro `depotsById` en `OptimizeContext`. Si `vehicle.depotId` está set, se usan las coords del depot. Si no, fallback a `vehicle.depotLat/depotLng`. Si tampoco, `[0, 0]` (caso de error explícito). Backward compatible — los vehículos viejos siguen funcionando sin migración de datos.
3. **Endpoint genérico `/api/templates/[entity]`** que devuelve un CSV con headers correctos + 1-3 filas de ejemplo + comentarios `#` con notas operativas. Incluye BOM UTF-8 para Excel/Sheets. Solo accesible para `admin`.
4. **Botón `<TemplateDownloadButton entity="…">`** reutilizable en cada `/settings/[entity]` para descarga rápida.

**Alternativas consideradas:**
- *Mantener depot per-vehículo:* descartado, escalabilidad operativa pésima.
- *Tabla `depots` con FK obligatoria desde vehicles:* descartado, rompe vehículos existentes y obliga a crear un depot antes de poder agregar el primer vehículo. La FK opcional permite onboarding gradual.
- *Importador CSV con upload + parser + validación visual:* es la siguiente fase natural, pero el bulk import end-to-end es 2-3x más trabajo. La plantilla descargable desbloquea preparación de datos sin bloquear el sprint.
- *Plantillas estáticas en `/public/`:* descartado, admins no autorizados podrían descargar estructura interna del schema.

**Riesgos / Limitaciones:**
- Si en el futuro el optimizer requiere multi-depot por ruta (ej. salir de A, recargar en B, regresar a A), este modelo se queda corto. Mitigación: añadir campo `intermediate_depots` cuando llegue.
- El parser de CSV upload aún no existe — los admins deben preparar el archivo y un humano lo aplica vía SQL. Pendiente para sprint siguiente.
- El template incluye headers "human-readable" (`zone_code`, `depot_code`) que el importador eventual debe resolver a UUIDs. La traducción es trivial pero hay que escribirla.
- Las plantillas son estáticas — si el schema cambia (nueva columna), hay que actualizar el route handler. Mitigación: tests unitarios del template generator + recordatorio en cada migración.

**Oportunidades de mejora:**
- Importador CSV con preview, validación per-row, dry-run y commit transaccional.
- Plantillas auto-generadas desde el tipo TS para que estén siempre sincronizadas.
- UI de "asignar múltiples vehículos a un CEDIS de golpe" desde `/settings/depots`.
- Multi-CEDIS por zona con distribución automática de vehículos según geografía.

---

## [2026-05-01] ADR-012: Mapbox Directions/Matrix API con fallback haversine + visualización en /routes/[id]

**Contexto:** Dos problemas relacionados:
1. El optimizer VROOM por default consulta OSRM (servicio externo de routing) en `localhost:5000` para calcular tiempos/distancias entre puntos. No tenemos OSRM levantado y consumir el OSRM público viola sus ToS para uso comercial. Sin matrix de calidad, las ETAs son ficticias.
2. El usuario que aprueba la ruta solo ve una lista de paradas — no puede juzgar visualmente si la secuencia tiene sentido (paradas cerca, detours obvios, etc.).

**Decisión:**
1. **Adapter `lib/mapbox.ts`** server-only que llama:
   - **Directions Matrix API** para construir la matriz N×N de duraciones/distancias respetando calles reales y `driving-traffic` (tráfico estimado). Costo: ~$2/1k req, free tier 100k/mes.
   - **Directions API** para obtener el GeoJSON LineString de la ruta completa, usado para dibujar polyline en el mapa.
2. **`lib/optimizer.ts`** ahora llama `buildOptimizerMatrix()` que:
   - Si `MAPBOX_DIRECTIONS_TOKEN` está configurado → Mapbox Matrix.
   - Si no → fallback haversine + factor de detour 1.4× + velocidad 30 km/h.
   - Si Mapbox falla (rate limit, red, 5xx) → fallback haversine. **No bloquea la operación**.
3. **Componente `<RouteMap>`** renderiza depot, paradas numeradas (color por status), polyline real si hay geometría o líneas rectas dasharray como fallback.
4. **Endpoint `/api/routes/[id]/polyline`** server-side que llama Mapbox Directions y devuelve geometría. Cache 5 min.

**Alternativas consideradas:**
- *Levantar OSRM con extract de México:* ~700MB de datos OSM + 30 min preprocess + ~5GB disco + servicio adicional. Overkill para 1-3 clientes V1.
- *Solo haversine:* ETAs optimistas, secuencias subóptimas en topología compleja (CDMX).
- *Google Maps Distance Matrix:* mejor geocoding México pero costo lineal sin tope.

**Riesgos / Limitaciones:**
- Mapbox Matrix limita 25 coords por request (100 en paid). Rutas >23 stops caen a haversine — abierto issue de chunking.
- Polyline asume depot → stops → depot. Si el camión termina en otro punto, recalcular.
- Token público (`NEXT_PUBLIC_MAPBOX_TOKEN`) queda expuesto al cliente; configurar URL restrictions en Mapbox dashboard.
- Cache 5 min puede mostrar polyline vieja tras re-optimize rápido — aceptable V1.

**Oportunidades de mejora:**
- Multi-vehicle map view en dashboard del supervisor.
- GPS del chofer en vivo encima de la polyline (Fase 3).
- Self-host tiles cuando crezca el costo.

---

## [2026-05-02] ADR-013: GPS broadcast en vivo via Supabase Realtime + breadcrumbs auditables

**Contexto:** Para cerrar el loop "ver vs ejecutar", el supervisor de zona y el dispatcher necesitan ver al chofer moviéndose en el mapa cuando una ruta está IN_PROGRESS. ADR-003 ya estableció que el GPS continuo NO debe escribirse a DB (saturaría Postgres). Hay que decidir cómo orquestar broadcast + audit + UI.

**Decisión:**
1. **Hook `useGpsBroadcast(routeId, driverId, enabled)`** en driver app. Cuando `enabled`:
   - Pide permiso `Geolocation.watchPosition` con `enableHighAccuracy: true`.
   - Cada update emite al canal Realtime `gps:{routeId}` con throttle de 8s.
   - Cada 90s persiste un row en `route_breadcrumbs` (audit trail).
   - Pide Wake Lock para mantener pantalla encendida (best-effort).
2. **GPS solo activo si `route.status === 'IN_PROGRESS'`** — no consume batería en PUBLISHED ni COMPLETED.
3. **`<GpsBroadcastController>`** muestra al chofer indicador discreto verde/rojo/gris con número de envíos.
4. **`<LiveRouteMap>`** en platform suscribe al canal y mueve un marker (🚐) en cada broadcast. Overlay "● En vivo · hace X seg".
5. **`/routes/[id]` switch automático**: IN_PROGRESS → LiveRouteMap, sino RouteMap estático.

**Alternativas consideradas:**
- *Polling HTTP cada 5s:* peor UX, más carga server, más costo. Realtime free hasta cierto volumen.
- *Postgres Changes:* acopla cadencia UI (8s) a la de breadcrumbs (90s). Broadcast permite cadencias distintas.
- *WebSocket custom o MQTT:* infra adicional sin justificación a esta escala.

**Riesgos / Limitaciones:**
- iOS Safari mata watchPosition al bloquear pantalla. Wake Lock atenúa pero Apple a veces rechaza. Mitigación: indicador visible al chofer + ADR-004 anticipa migración nativa.
- Realtime quotas: 1 chofer × 8s × 8h = 3,600 msgs/día. 50 choferes × 30 días = ~5.4M/mes. Plan Pro Supabase aguanta. Multi-tenant cada uno con su proyecto.
- `route_breadcrumbs` sin TTL — cron mensual a futuro para archivar >90 días.
- Marker no interpola entre updates (salta 8s). Mejorable con `requestAnimationFrame`.
- Sin replay histórico al entrar tarde — leer last N breadcrumbs al montar (issue).

**Oportunidades de mejora:**
- Replay del recorrido del día con timeline scrubber.
- Detección de desviación >500m de corredor previsto.
- Multi-driver dashboard del supervisor en tiempo real.

---

## [2026-05-02] ADR-015: Push notifications VAPID real + replay del recorrido — cierre Fase 2

**Contexto:** Para cerrar Fase 2 faltaban dos piezas:
1. Push real — `lib/push.ts` era stub. Al publicar ruta, el chofer no recibía notificación.
2. Replay del recorrido (#32): si el supervisor entra al `<LiveRouteMap>` tarde, no veía dónde había estado el chofer antes.

**Decisión:**

**Push VAPID:**
- Reemplazar stub con `web-push.sendNotification` real. La librería maneja JWT VAPID + encryption RFC 8030.
- Auto-pruning: si push service responde 404/410, borramos la subscription. Evita acumular zombies.
- TTL 1h por notificación: si el chofer no la recibe en 1h, el push service la descarta (la info ya no es útil).
- Endpoint `/api/push/subscribe` en driver app: UPSERT manual por `(user_id, endpoint)`.
- `<PushOptIn>` detecta estado (unsupported/default/denied/granted/subscribed) y muestra banner solo cuando aplica. No insiste si el chofer rechazó.
- En dev el SW está disabled → opt-in detecta unsupported. Para test real: `pnpm build && pnpm start`.

**Replay:**
- Endpoint `/api/routes/[id]/breadcrumbs` devuelve route_breadcrumbs cronológico, cap 500 (≈12h).
- `<LiveRouteMap>` carga trail al montar, dibuja línea roja dasharray semi-transparente. Cuando llega broadcast nuevo, concatena.
- Resultado visual: trail rojo (pasado) + marker (presente) + polyline verde (planeado).

**Alternativas consideradas:**
- *Cron de pruning de subs:* más complejo que pruning inline al primer fallo.
- *Push sin TTL:* notification horas después confunde — 1h es balance correcto.
- *Replay con scrubber temporal animado:* feature de auditoría posterior.

**Riesgos / Limitaciones:**
- `push_subscriptions` no tiene UNIQUE en `(user_id, endpoint)` — upsert manual con read+compare. Race teórica si dos requests concurrentes; probabilidad muy baja en práctica.
- Trail cap 500 — jornadas >12h no muestran inicio. Aceptable hasta que sea común.
- PWA reinstalada genera nuevo endpoint — sub vieja queda hasta primer fallo de push.

**Oportunidades de mejora:**
- UNIQUE `(user_id, endpoint)` en push_subscriptions para upsert atómico.
- Replay con scrubber temporal "ver dónde estaba a las HH:MM".
- Push enriquecida con thumbnail/actions usando Notification API.

---

## [2026-05-02] ADR-014: Asignación de chofer post-creación de ruta (UI inline)

**Contexto:** Una ruta se crea con o sin chofer asignado. La server action `assignDriverAction` ya existía pero NO había UI para invocarla. Si el dispatcher creaba 3 rutas sin choferes, no tenía forma de asignarlos después.

**Decisión:** Componente `<DriverAssignment>` inline en la card "Asignación" de `/routes/[id]`. Editable solo en DRAFT/OPTIMIZED/APPROVED; read-only en PUBLISHED+. Selector filtra por zona y `is_active=true`.

**Alternativas consideradas:**
- *Botón "Editar ruta" con formulario completo:* over-engineered para 1 dropdown.
- *Permitir cambio en PUBLISHED:* requiere flujo de cancelación de push + nuevo push — diferido.

**Riesgos / Limitaciones:**
- Cambiar chofer post-OPTIMIZED no re-corre el optimizer. Hoy sin constraints chofer-específicas no aplica; cuando lleguen, sugerir re-optimize.

**Oportunidades de mejora:**
- Reasignación en PUBLISHED con manejo de push doble.
- Bulk assign matrix N rutas × N choferes.

---

## [2026-05-02] ADR-016: Tipo de visita al llegar + validación geo anti-fraude

**Contexto:** El flujo del prototipo Verdefrut original tiene 3 tipos de visita que el chofer escoge al llegar a la tienda: **entrega normal**, **tienda cerrada**, **báscula no funciona**. Cada uno arranca un flow distinto. En VerdFrut hasta ahora `arriveAtStop` siempre asumía `type='entrega'` con un único botón "Llegué a la tienda". Además, sin validación de proximidad GPS, un chofer podría reportar "tienda cerrada" desde su casa y cobrar la jornada sin haberse movido.

**Decisión:**
1. **`<ArrivalTypeSelector>`** con 3 botones contextuales que reemplaza el botón único pre-arrival.
2. **`arriveAtStop` exige `coords`** (lat/lng del chofer en el momento). Si no las recibe → rechaza con `reason='no_coords'`.
3. **Validación haversine server-side** contra `store.lat/lng`. Umbrales por tipo:
   - `entrega`: 300m (debe estar literalmente afuera)
   - `tienda_cerrada`: 1000m (más permisivo — puede estar reportando desde estacionamiento)
   - `bascula`: 300m
   Si excede umbral → rechaza con `reason='too_far'` + distancia exacta para que UI muestre "estás a 2.3km — acércate".
4. **Persistir coords del arrival en `delivery_reports.metadata`** para audit posterior + análisis de "lejanía típica" del chofer en cada tipo.
5. **Steps `facade`, `scale`, `chat_redirect`, `tienda_abierta_check`** implementados (la flow-engine ya tenía las transiciones, faltaban componentes UI).
6. **`convertToEntregaAction(reportId)`**: cuando el chofer (o comercial) determina que la tienda sí abrió o báscula sí funciona, convierte el report a `type='entrega'` reusando la foto previa (facade/scale) como `arrival_exhibit`. NO requiere foto duplicada del mueble.
7. **`submitNonEntregaAction(reportId, resolution)`**: cierra reportes de cerrada/báscula sin entrega. Stop queda `skipped`. Distinto de `submitReport` porque no exige tickets.
8. **`<ChatRedirectStep>` STUB** hasta Sprint 9 (chat realtime). Por ahora muestra mensaje "comunícate por WhatsApp/llamada con el comercial" + botón continuar.

**Alternativas consideradas:**
- *Validación GPS solo client-side:* atacante modifica el frontend y envía `coords` falsas. El server debe validar siempre.
- *Sin umbrales diferenciados por tipo:* mismo umbral para los 3 → fricción innecesaria en cerrada (chofer puede estar legítimamente en estacionamiento del centro comercial sin estar pegado a la tienda).
- *Hard-block sin opción de re-intentar:* causa frustración legítima si el GPS tiene mala precisión. Mostrar distancia + threshold permite al chofer entender y acercarse.

**Riesgos / Limitaciones:**
- **Tiendas dentro de centros comerciales o plazas grandes:** el polígono real puede estar a 200m de la coord registrada (cuya lat/lng apunta al centro de masa del building). Solución: si el caso aparece, ajustar coords manualmente al punto de recepción.
- **GPS con accuracy >100m:** la lectura puede ubicar al chofer a 500m de donde está realmente. Si está en un sótano o área techada, el rechazo puede ser injusto. Mitigación: chofer puede salir al exterior y reintentar. Si crónico, pedir manualmente desactivar el lock para esa tienda específica.
- **Atacante con jailbroken phone que falsea geo:** la API acepta lo que el OS le dé. Mitigación operativa, no técnica — auditar via breadcrumbs (el GPS broadcast continuo debería coincidir con que esté avanzando por calles reales).
- **Conversión `tienda_cerrada → entrega` reutiliza fachada como arrival_exhibit:** si la fachada es lo único visible (cortina cerrada), la "evidencia del mueble al llegar" no existe — cuando la tienda abrió, el mueble probablemente ya estaba dentro. El flujo entrega normalmente pide DOS fotos de arrival_exhibit; aquí queda con una. Aceptable como compromiso para no exigir foto duplicada al chofer que ya esperó.

**Oportunidades de mejora:**
- **Threshold por tienda:** algunas tiendas en plazas grandes podrían necesitar 600m en lugar de 300m. Columna opcional `stores.arrival_threshold_meters` para override.
- **Acuracy-aware:** si GPS reporta `accuracy=200m` y la distancia es 250m, técnicamente el chofer puede estar dentro del umbral. Considerar `effective_distance = max(0, distance - accuracy)`.
- **Audit de patrones sospechosos:** alert si un chofer reporta `tienda_cerrada` >3 veces por semana en la misma tienda — patrón de fraude.

---

## [2026-05-02] ADR-017: Navegación in-app — el chofer no sale de la PWA

**Contexto:** El chofer típicamente recibía la lista de paradas y abría Google Maps externo para navegar — interrumpiendo el flujo, perdiendo contexto y arriesgando que olvide volver a VerdFrut para reportar entregas. Además sin red en zonas muertas, los reportes fallan al instante en lugar de encolarse.

**Decisión:**
1. **Pantalla `/route/navigate` fullscreen** con mapa Mapbox, marker animado del chofer (`watchPosition`), polyline de la ruta planeada (Directions API cargada al inicio, queda en memoria toda la jornada), y card flotante abajo con la próxima parada.
2. **Auto-detección de arrival (<100m)** con vibración táctil tipo tap-tap + highlight verde + texto "Estás aquí" + botón destacado "✓ Iniciar entrega". El chofer no tiene que adivinar cuándo decir "llegué" — la app lo sabe por GPS local.
3. **Auto-follow del marker** que se desactiva si el chofer hace pan/zoom (botón "📍 Centrar en mí" para volver). Patrón estándar de apps de navegación.
4. **Indicador GPS visible** en header (●/✕/◌) — el chofer sabe si está siendo trackeado.
5. **Polyline + tiles cacheados** una vez al inicio. La navegación sigue funcionando sin red para ver dónde está y cuál es la próxima parada. Lo que requiere red es solo subir reportes — para eso la cola offline (#17) que viene después.
6. **Botón "🧭 Iniciar navegación"** en `/route` (lista) lleva a la pantalla full. La lista queda como overview/respaldo.

**Alternativas consideradas:**
- *Embed Google Maps Directions:* turn-by-turn de calidad nativa pero requiere abrir la app de Google → contradice el objetivo "no salir de la app".
- *Mapbox Navigation SDK:* es para nativo (React Native/iOS/Android), no PWA.
- *Reemplazar `/route` directamente con el mapa:* perdería el contexto rápido de "ver lista de paradas" que el chofer necesita en algunos momentos. Mejor tener ambos modos.
- *Self-host OSRM + tiles:* infra pesada para una mejora marginal a esta escala.

**Riesgos / Limitaciones:**
- **Polyline se cargó al inicio y no se refresca:** si el dispatcher re-optimiza la ruta mientras el chofer navega, el marker sigue la polyline vieja hasta recargar. Mitigación: detectar `route.updated_at` y mostrar banner "Tu ruta cambió, recarga".
- **Sin tiles cacheados de la zona:** si el chofer arranca jornada con red mala, los tiles del mapa pueden quedar parciales. Una mejora futura: precachear tiles del bbox de la ruta al cargar.
- **Wake Lock no garantizado en iOS:** el GPS puede pararse al bloquear pantalla (#31 ya documentado). Para navegación es CRÍTICO — Apple Safari es el riesgo principal. Mitigación: Wake Lock attempt + indicador GPS visible + ADR-004 anticipa migración nativa.
- **Auto-arrival threshold fijo en 100m:** algunas tiendas en plazas grandes pueden requerir 150-200m. Override por tienda futura (#27 menciona algo similar para CEDIS default).
- **Sin turn-by-turn voice instructions:** sólo polyline visual. Para chofer experimentado en su zona es suficiente; para chofer nuevo o ruta nueva quizás necesite. Postergar.
- **Vibración háptica solo Android funcional:** iOS Safari ignora `navigator.vibrate`. Mitigación: el highlight verde + texto "Estás aquí" es feedback visual igualmente claro.

**Oportunidades de mejora:**
- Precache de tiles del bbox de la ruta al inicio para tolerar pérdida de red.
- Voice-prompted turn-by-turn con Web Speech API (`speechSynthesis`).
- "Modo nocturno" del mapa cuando es de noche (saving battery + visibilidad).
- Override de `arrival_radius` por tienda (plazas grandes).
- Detección de "te desviaste de la ruta" → recalcular silenciosamente.

---

## [2026-05-02] ADR-018: Turn-by-turn navigation con Mapbox + Web Speech API

**Contexto:** Chofer pidió navegación turn-by-turn (instrucciones por voz "gira a la derecha en X calle") sin salir de la PWA. ADR-017 dejó el mapa fullscreen pero sin instrucciones. Tres opciones: Mapbox Navigation SDK (solo nativo), Mapbox Directions con `steps`+`voice_instructions` (PWA-compatible), Waze API (no es pública).

**Decisión:** Mapbox Directions con `steps=true&voice_instructions=true&language=es`. Cero requests extras (mismo endpoint, params adicionales). Web Speech API (`speechSynthesis`) lee instrucciones en español.

**Implementación:**
- `getMapboxDirections` aplana `legs[].steps[]` a `NavStep[]` con instruction/type/modifier/voiceInstructions.
- `useTurnByTurn(steps, position, onAnnounce)` calcula step actual, dispara anuncios según `distanceAlongGeometry`, detecta off-route a >50m durante 3 updates.
- `useSpeech` wrap de Web Speech API con voz `es-MX` (fallback `es-*`), toggle persist localStorage.
- `<TurnByTurnBanner>` arriba con flecha emoji + instrucción + distancia.
- Off-route → auto-recalc + anuncia "Recalculando ruta".
- Toggle 🔊/🔇 en header.

**Riesgos / Limitaciones:**
- Voz iOS Safari puede caer a es-ES si no hay es-MX (acento distinto, igual entendible).
- Off-route detection usa vértice más cercano (no segmento) — falso positivo posible en curvas. Mitigación: 3 updates seguidos.
- Sin SSML — voz robótica. TTS provider externo (ElevenLabs, Azure) si el cliente paga.
- Web Speech requiere gesto previo del user (autoplay policy) — cubierto porque el chofer toca "Iniciar navegación".

**Oportunidades de mejora:**
- `banner_instructions=true` para pictogramas oficiales en lugar de emojis.
- Lane guidance ("permanece en carril izquierdo").
- Speed limit display por segmento.
- TTS provider externo para voz natural.

---

## [2026-05-02] ADR-019: Cola offline IndexedDB (outbox genérico) para mutaciones del chofer

**Contexto:** El chofer trabaja en zonas con red intermitente (sótanos de tienda, semáforos rojos en zonas muertas, subway). Las server actions de hoy (`advanceStep`, `setReportEvidence`, `patchReport`, `submitReport`, upload a Storage) fallan al instante si no hay red — el chofer ve "Error" y no sabe si su trabajo quedó guardado. Issue #17 documentaba el riesgo. Además, los Sprints 11 (chat) y 12 (OCR) van a generar más mutaciones que también necesitan tolerar pérdida de red, así que la solución debe ser **genérica** desde el inicio para evitar retrofit.

**Decisión:**

1. **Outbox local en IndexedDB** que persiste todas las mutaciones del chofer entre sesiones (sobrevive a reload, cierre de pestaña, reinicio de teléfono). Ubicación: `apps/driver/src/lib/outbox/` (no es un paquete porque por ahora solo el driver app lo necesita; se extrae si la platform lo requiere).

2. **Shape de cada item** (extensible para Sprints 11/12):
   ```ts
   interface OutboxItem {
     id: string;                   // UUIDv4 generado en cliente — idempotency key
     type: OutboxOpType;           // discriminator: 'advance_step' | 'set_evidence' | ...
     payload: unknown;             // shape específico por type
     status: 'pending' | 'in_flight' | 'failed' | 'done';
     attempts: number;
     lastError: string | null;
     lastAttemptAt: number | null;
     createdAt: number;
   }
   ```

3. **Idempotency por UUID en el cliente.** El cliente genera el `id` antes de encolar; si el worker reintenta, el mismo `id` viaja como argumento al server. Para esta primera versión las server actions no almacenan IDs de operación, pero la naturaleza de las mutaciones tolera reintentos:
   - `advance_step`: idempotente (UPDATE current_step a un valor — si ya está ahí, no pasa nada).
   - `set_evidence`: read+merge+write — el último gana, OK con reintentos.
   - `patch_report`: UPDATE de columnas — idempotente.
   - `submit_report` / `submit_non_entrega`: el server ya tiene guard `WHERE status='draft'`. Un segundo intento devuelve error "ya enviado" → el outbox lo marca como `done` (semánticamente correcto).
   - `upload_photo`: bucket Storage usa `upsert: false`. Reintentos del mismo path fallan con "already exists" → marcamos `done`. El path lleva `Date.now()` en el nombre, así que rara vez chocan.

4. **Worker en main thread con backoff exponencial.** No es un Service Worker (Serwist se usa para precache/SW, no para esto). Un hook `useOutboxWorker()` corre `processOnce()` cada N segundos cuando `navigator.onLine === true`, en orden FIFO, una operación a la vez. Backoff: `min(1000 * 2^attempts, 30_000)` ms. Tras 10 intentos fallidos consecutivos pasa a `failed` y solo se reintenta con retry manual.

5. **UI: badge en el header del driver** (`<OutboxBadge>`) muestra `X cambios pendientes` cuando hay items no-`done`. Tap abre detail con lista y botón "Reintentar todo". Si hay items en `failed`, badge en rojo.

6. **Operaciones cubiertas en este sprint** (las nuevas vendrán en sprints siguientes):
   - `advance_step` — antes era `advanceStep(reportId, nextStep)` síncrono.
   - `set_evidence` — antes era `setReportEvidence(reportId, key, url)` síncrono.
   - `patch_report` — antes era `patchReport(reportId, patch)` síncrono.
   - `submit_report` / `submit_non_entrega` — terminales del flujo.
   - `convert_to_entrega` — del Sprint 8.
   - `upload_photo` — el Blob comprimido se persiste en IndexedDB y el worker lo sube a Storage cuando hay red. Tras éxito, se encadena con `set_evidence`.

7. **`arriveAtStop` NO va al outbox.** Requiere coords frescos para validación geo anti-fraude (ADR-016). Si no hay red en ese momento, el chofer simplemente no puede arrivar — pero no perdió trabajo porque aún no había generado nada.

**Alternativas consideradas:**
- *Background Sync API:* el browser dispara reintentos automáticamente cuando vuelve la red, incluso con la app cerrada. Atractivo pero (a) iOS Safari no lo soporta — y nuestro target principal incluye iOS, (b) requiere Service Worker activo, lo que en dev (`next dev`) no aplica. Postergado.
- *LocalStorage en lugar de IndexedDB:* simple pero no soporta Blobs (necesitamos almacenar fotos), tiene límite ~5MB y es síncrono (bloquea el hilo). Descartado.
- *Library `idb-keyval` o `dexie`:* `dexie` añade ~30KB; overkill para un store. `idb` (Mozilla, ~2KB) da una API limpia sobre IndexedDB sin opinions extra. **Elegido `idb`**.
- *Reescribir todo como mutations de TanStack Query con `persistQueryClient`:* tendría sense si ya usáramos React Query, pero el driver app usa server actions + `router.refresh`. Adoptar Query ahora es scope creep.
- *Service Worker que intercepta `fetch` y encola:* las server actions de Next.js usan POST a la propia ruta con un payload propietario. Interceptar y reenviarlas correctamente es frágil entre versiones de Next.

**Riesgos / Limitaciones:**
- **iOS Safari y storage eviction:** Safari puede borrar IndexedDB de PWAs no instaladas tras 7 días sin uso. Mitigación: ejecución diaria del chofer evita la ventana de eviction. Recomendación operativa: instalar la PWA al home screen ("Add to Home Screen" graduates la app a "installed" → eviction mucho más permisiva).
- **Re-aplicación de un advance que el chofer ya superó manualmente:** si el outbox tarda en subir un `advance_step` que dice "pasa a step X" cuando el chofer (post-`router.refresh`) ya está en step X+1, el server lo va a poner de vuelta en X. Mitigación: cuando el cliente enqueue un advance, antes de enviar el worker compara contra el server source of truth (read pre-write); si el server ya está adelante, marca `done`. Pendiente de implementar como hardening si aparece en la práctica.
- **Foto en IndexedDB ocupa espacio:** una foto comprimida pesa ~150-300KB. Una jornada con 30 paradas y 5 fotos por parada = ~30MB en IndexedDB peor caso. iOS Safari limita ~50MB por origin no-installed. Mitigación: limpiar items `done` agresivamente (TTL 24h), instalar PWA. Suficiente para V1.
- **Race entre upload y advance:** si el chofer toma foto y avanza step antes de que el upload termine, los handlers del outbox los procesan en orden FIFO. El advance no se aplica hasta que el upload (que va antes en la cola) termine. **Side effect deseado:** el chofer puede avanzar visualmente; el server ve los cambios en orden. Pero si el upload falla 10 veces y queda en `failed`, los advances posteriores quedan stuck. Mitigación: en el sprint, `failed` no bloquea el resto — el worker salta items `failed` y continúa con los `pending` siguientes. Documentar UX clara: "1 foto no se pudo subir — toca para reintentar".
- **Sin barrera tipo "no salgas del flujo si hay pendientes críticos":** un chofer impaciente puede salir de `/route/stop/X` con un advance encolado que aún no se aplicó. Aceptable porque al volver verá el state correcto del server.
- **Server actions importadas y llamadas desde un setInterval:** soportado por Next.js — son funciones async normales. `revalidatePath` corre dentro de la action y queda dentro de su contexto.

**Oportunidades de mejora:**
- Background Sync para Android (degrada elegante en iOS).
- Telemetría: enviar a un endpoint las operaciones que terminan en `failed` después de 10 intentos para detectar patrones (ej: "siempre se atora en `set_evidence` para X tienda").
- Unificar idempotency keys en el server (columna `client_op_id` en `delivery_reports` para no re-aplicar advance que el chofer ya superó).
- Compactar la cola: si hay 3 `advance_step` consecutivos para el mismo report, solo el último importa — droppear los anteriores.
- Migrar a paquete `@tripdrive/outbox` cuando platform/control-plane lo necesiten.

---

## [2026-05-02] ADR-020: IncidentCart real — texto libre + unidades cerradas, sin catálogo de productos

**Contexto:** En el flujo `entrega`, después de `incident_check` con "sí hay incidencia", el chofer llega al step `incident_cart`. Hasta ahora era un stub: insertaba un único `IncidentDetail` placeholder y avanzaba — el detalle real (producto, cantidad, tipo) se discutía con el comercial por chat fuera del sistema (issue #18). Para que Sprint 11 (chat) tenga contenido estructurado para mandar al comercial, y para que Fase 5 (dashboard) pueda agregar incidencias por producto/tipo, necesitamos data real.

V1 NO tiene catálogo de productos digital — los pedidos vienen pre-empacados con hoja física. Por tanto el chofer no puede "buscar" un producto. Hay que decidir cómo capturar productos sin catálogo.

**Decisión:**

1. **Producto = texto libre.** El chofer escribe "Manzana roja kg" o "Bolsa de zanahoria 1kg" como string. El campo `productId` queda undefined en V1. Cuando exista catálogo (Fase posterior), un job de reconciliación intentará mapear strings frecuentes a `product_id`.

2. **Unidades = lista cerrada.** Selector con opciones: `pcs`, `kg`, `caja`, `paquete`, `bolsa`, `lata`. Cubren el 95% de casos reales (verificado contra el prototipo Verdefrut). Si una incidencia requiere unidad fuera de la lista, el chofer la describe en `notes`. **Cerrada y no custom** porque (a) facilita agregaciones en dashboard, (b) evita variantes del mismo concepto ("kgs", "Kg", "kilo"), (c) Sprint 13 no es lugar para resolver normalización de unidades.

3. **Tipo = segmented buttons** con los 4 valores de `IncidentType` (rechazo / faltante / sobrante / devolución). Botones grandes, alta visibilidad porque cada tipo tiene tratamiento contable distinto en el dashboard del cliente.

4. **Cantidad = numeric input.** Permite decimales (ej. 1.5 kg). Validación: > 0. Sin tope superior — un pedido con 200 cajas faltantes es válido aunque raro.

5. **Notas = textarea opcional.** Para contexto que no cabe en producto/cantidad ("estaba en mal estado, jaba 3 cajas dañadas").

6. **Lista de incidencias agregadas en cards apiladas** con botón "✕" para quitar y tap para editar. El chofer puede agregar 1, 5 o 20 incidencias en la misma parada.

7. **Persistencia:** al tap "Continuar" el componente llama `onPatch({ incidentDetails })` que el outbox encola. La lista completa viaja como JSON, no incremental — es <1KB típico, no vale la pena diferenciar.

8. **Validación mínima:** lista no vacía + cada item con producto.length>=2 + cantidad > 0. Sin esquema de validación (zod) en V1 — la TS-tipa la shape, los runtime checks son simples.

9. **Auto-save de drafts entre re-renders:** el state es local del componente. Si el chofer sale del step (back), pierde el draft no guardado — porque el último `onPatch` se hizo cuando él decidió "Continuar". Aceptable: típicamente el chofer agrega 2-3 items y sigue sin pausa.

**Alternativas consideradas:**
- *Buscador de productos contra catálogo seedeado:* sin catálogo en V1, no hay qué buscar. Construirlo solo para este step es scope fuera de fase.
- *Solo productName + notes (sin tipo/cantidad estructurados):* el dashboard de Fase 5 perdería la dimensión "qué porcentaje de incidencias son rechazos vs faltantes" — métrica clave.
- *Permitir unidad custom (input text):* mata la agregabilidad. Si la unidad es desconocida, el chofer escribe en notes y elige `pcs` (default).
- *Multi-step wizard (1 producto a la vez con un step shell por incidencia):* abruma al chofer. La mayoría de paradas tienen ≤3 incidencias, todas en una pantalla con scroll es más rápido.

**Riesgos / Limitaciones:**
- **Texto libre = baja calidad de datos.** "manzana", "Manzana", "manzanas", "Manzana Red Delicious" son el mismo SKU para el negocio pero strings distintos. Mitigación: cuando exista catálogo, normalización offline. Aceptable para V1 porque el destinatario inmediato es el comercial humano que entiende contexto.
- **Sin foto del producto en disputa (de momento):** si el chofer dice "rechazo de 5 kg de papa por estado", el comercial no tiene evidencia visual. Mitigación: el chat (Sprint 11) permite adjuntar foto. Sprint 13 NO incluye foto-por-incidencia.
- **No hay "unidad" para servicios (ej. transporte adicional).** Caso muy raro en operación de fruta/verdura — `pcs` con notes lo cubre.
- **Cantidad como `number` en JSON:** Postgres jsonb los preserva como `numeric`. Decimales precisos hasta 1e-15. OK.
- **No hay límite de N incidencias por reporte:** un chofer malicioso podría meter 1000 items para inflar el JSON. Riesgo bajo (es chofer autenticado, no público), pero a futuro un cap de 50 sería sano.

**Oportunidades de mejora:**
- Buscador con autocompletado contra el histórico del propio chofer (cache de strings que ya escribió).
- Foto por incidencia (subida via outbox, slot dinámico `incident_${index}_photo`).
- Sugerencias contextuales basadas en la tienda ("en esta tienda los rechazos típicos son: papa, jitomate").
- Cap de 50 items con mensaje "agrupa incidencias similares en notas".
- Cuando exista catálogo: campo `productId` con dropdown + fallback a texto libre.

---

## [2026-05-02] ADR-021: Chat realtime conductor↔comercial — Postgres changes en `messages`, sin canal broadcast separado

**Contexto:** Hasta hoy, `<ChatRedirectStep>` era un stub que mostraba una tarjeta "habla con tu comercial" sin un canal real. El flujo `tienda_cerrada`/`bascula` y el step `chat_redirect` post-`incident_cart` necesitan un chat persistente con timer de 20 minutos para escalación, push notification al comercial, foto adjunta, y resolución que cierra el caso. Tabla `messages` ya existía desde la migración 005 con `report_id`, `sender`, `text`, `image_url` — falta UI, realtime, hardening RLS, y barrera del timer.

**Decisión:**

1. **Realtime via Postgres changes (no Broadcast).** `ALTER PUBLICATION supabase_realtime ADD TABLE messages` — los clientes se suscriben a INSERT events filtrados por `report_id`. Razón: los mensajes ya tienen que persistir en DB (auditoría, dashboards, replay). Broadcast adicional sería un canal paralelo a mantener — fuente única de verdad gana.

2. **Filtrado client-side por `report_id`.** Cada chat suscribe `realtime:public:messages:report_id=eq.{id}`. Supabase Realtime aplica RLS al server, así que el chofer solo recibe mensajes de sus propios reports y el zone_manager solo los de su zona.

3. **Hardening RLS en `messages`.** El INSERT policy original solo verificaba `report_id IN (SELECT id FROM delivery_reports)` (delegado a RLS de reports). Eso permitía que un driver insertara con `sender='zone_manager'` (suplantación). Nueva policy:
   - `sender_user_id = auth.uid()` obligatorio
   - `sender='driver'` solo si `current_user_role()='driver'`
   - `sender='zone_manager'` si rol es `zone_manager` o `admin/dispatcher` (estos últimos pueden intervenir desde el panel)

4. **Trigger `tg_messages_open_chat` que setea `chat_opened_at`, `timeout_at` y `chat_status='open'` al primer INSERT.** Idempotente: si `chat_opened_at` ya está, no toca nada. Razón: mover esto al server elimina race conditions del cliente (driver y comercial entrando al chat al mismo tiempo) y centraliza la lógica de timer. El timer corre desde el primer mensaje, no desde "abrí la pantalla" — un chofer que abre y cierra sin escribir no consume tiempo.

5. **`timeout_at = chat_opened_at + 20 min` sin reset por respuestas.** Decisión de producto (memoria del proyecto): el timer mide "¿se llegó a un acuerdo dentro de 20 minutos?", no "¿hubo actividad reciente?". Si se cumplen los 20 minutos sin resolución, el caso pasa a `timed_out` y el chofer puede continuar la jornada — el comercial revisa después.

6. **Mensajes via outbox (op `send_chat_message`).** Texto y foto se encolan igual que las demás mutaciones (ADR-019). La foto comprimida en IDB sube a bucket `evidence` con slot `chat_${ts}`. Tras éxito el handler encola un `send_chat_message` con el `image_url` resultante. Ordering FIFO garantiza que el INSERT del mensaje suceda después de subir la foto.

7. **UI del chat: mismo componente `<ChatThread>` para driver y platform.** Diferencias por prop `viewerRole='driver'|'zone_manager'`. Reduce duplicación. El componente vive en `apps/driver/.../chat-thread.tsx` y se importa también desde el platform via path relativo (los apps comparten root pero NO compartimos `apps/driver/src/` desde platform — necesitaré moverlo a un paquete o duplicarlo).

   **Sub-decisión:** Para evitar inflar `@tripdrive/ui` con lógica de chat (no es UI primitiva), copio el componente a ambas apps con el mismo nombre y mantengo paridad manual. Si en una tercera fase aparece más reuso, se extrae a un paquete `@tripdrive/chat-ui`. YAGNI por ahora.

8. **Mensaje inicial auto-generado** desde `incident_details` (cierra issue #18). Cuando el chofer abre el chat por primera vez en flujo entrega y hay incident_details no vacío, el cliente envía como primer mensaje un summary tabular ("• 2 kg de Manzana — Rechazo", etc.). Esto va al outbox como `send_chat_message` normal.

9. **Push notification al comercial al primer mensaje del chofer.** Usa el mismo `web-push` ya integrado para la app de chofer. El primer INSERT con `sender='driver'` dispara una server action que busca a los `zone_manager` con `zone_id=report.zone_id` y manda push con el deep link `/incidents/{reportId}`.

   **Decisión secundaria:** evitamos enviar push en CADA mensaje (spam para el comercial que tiene el chat abierto). Solo el primero — el resto se sincroniza por Realtime mientras el comercial tenga la pestaña abierta.

10. **Resolución desde cualquier lado** — driver tap "Marcar resuelto" → `chat_status='driver_resolved'`; comercial tap "Cerrar caso" → `'manager_resolved'`. Ambos cierran el chat para edición pero permiten lectura. El cliente que NO inició la resolución ve la transición via Realtime (Postgres change en `delivery_reports.chat_status`).

**Alternativas consideradas:**
- *Broadcast nativo de Supabase Realtime:* fire-and-forget, sin persistencia automática. Requiere INSERT manual paralelo si queremos auditoría. Doble fuente de verdad.
- *WebSocket/SSE custom:* infraestructura adicional, no aprovecha Supabase Realtime que ya tenemos.
- *Pulling cada N segundos:* más simple pero peor UX y carga al server.
- *Compartir `<ChatThread>` via `@tripdrive/ui`:* el paquete UI es tokens + primitivas, no features completas con state management. Inflarlo aquí debilita la frontera.
- *Reset del timer con cada mensaje:* el timer se volvería un "watchdog" de actividad en lugar de un SLA. El comercial podría dejar el caso colgando indefinidamente con un mensaje cada 19 min.

**Riesgos / Limitaciones:**
- **Postgres changes scaling:** Supabase Realtime tiene límites de eventos/sec por proyecto. A 1 driver actualmente, irrelevante. Con 50 drivers en paralelo en chats activos, ~1-2 mensajes/sec — dentro del free tier.
- **RLS y Realtime:** los filtros por RLS ocurren en el broker de Realtime con cierta latencia comparada a `IN (SELECT...)` puro de Postgres. En la práctica imperceptible.
- **Trigger en SECURITY DEFINER:** corre con permisos elevados. Solo escribe `delivery_reports` con WHERE específico, no permite ataque del usuario insertando mensajes a reports ajenos porque la WHERE primero filtra y luego el caller ya pasó la RLS de INSERT en messages (que valida report_id IN reports visibles).
- **Sin "typing indicator":** el chat es lean, sin estado intermedio. Aceptable V1.
- **Sin "read receipts":** no sabemos si el otro lado leyó. Decisión consciente — el comercial revisa cuando puede; el chofer no debe esperar acuse.
- **iOS Safari y Realtime:** el cliente del chofer puede perder la suscripción si el OS pausa el WebSocket. Mitigación: al volver `online`/`focus`, refetch de mensajes.
- **Push duplicado:** si por algún bug `chat_opened_at` se setea con varios mensajes en milisegundos, podríamos disparar push 2 veces. Mitigación: el server action de push valida por `chat_opened_at IS NULL` antes de enviar.
- **Foto adjunta sin compresión adicional:** usa `compressImage` del flujo de evidencia, ya bajado a ~150KB. OK.

**Oportunidades de mejora:**
- Read receipts y typing indicators si el comercial los pide.
- Escalación automática post-`timed_out` a un dispatcher.
- Inline preview de la foto sin abrir modal (mejor UX).
- Búsqueda de mensajes en el panel del comercial (cuando crezcan los chats).
- Auto-respuestas de plantilla del comercial ("ok ya voy", "espera 5 min").
- Métricas: tiempo medio de primera respuesta, % casos resueltos en <20 min.

---

## [2026-05-02] ADR-022: OCR de tickets con Claude Vision — extracción server-side, edición + confirmación cliente

**Contexto:** Los steps `waste_ticket_review` y `receipt_review` eran placeholders ("foto cargada, continuar") sin extracción de datos. El paquete `@tripdrive/ai` ya tenía `extractTicketFromImageUrl` cableado a Claude Sonnet 4.6 con system prompt en español, pero ningún caller. Issue #19 documentaba la deuda. Para Fase 5 (dashboard del cliente con KPIs por tienda y export XLSX para ERP externo) los datos extraídos son entrada crítica — sin ellos, las paradas reportan distancia/duración pero no monto facturado/devoluciones.

**Decisión:**

1. **Extracción server-side via API route** `POST /api/ocr/extract-ticket` en el driver app. Body: `{ reportId, kind: 'receipt' | 'waste' }`. La route:
   - Lee la URL desde `delivery_reports.evidence['ticket_recibido']` (kind=receipt) o `evidence['ticket_merma']` (kind=waste).
   - Llama `extractTicketFromImageUrl(url)` (timeout 60s, 2 reintentos internos).
   - Persiste resultado en `ticket_data` o `return_ticket_data` (jsonb).
   - Devuelve `TicketData` al cliente.

   Por qué API route y NO server action: OCR puede tardar 3-8s, las server actions de Next bloquean el formulario; API route es fetch normal con AbortController, mejor UX.

2. **`ANTHROPIC_API_KEY` SOLO server-side.** No expone al cliente — la API route corre en el servidor del driver app.

3. **NO pasa por outbox.** Razones:
   - El OCR requiere red por definición (call a Anthropic). Sin red, no hay nada que diferir — se le dice al chofer "OCR no disponible, completa los datos a mano".
   - Re-procesar el mismo ticket dos veces gasta créditos de Anthropic — no queremos reintentos automáticos de la cola.
   - Si la API route falla, el cliente puede reintentar manualmente con un botón "Reintentar OCR".

4. **Edición del chofer + confirmación SÍ pasa por outbox.** Tras la extracción automática, el chofer ve un form editable con: `numero`, `fecha`, `total`, lista de `items[]`. Cuando toca "Confirmar y continuar", encolamos un `patch_report` con `{ ticketData, ticketExtractionConfirmed: true }` (o `returnTicketData` + `returnTicketExtractionConfirmed`). Esto tolera offline durante la edición — caso real cuando la red se cae mientras el chofer corrige un total mal leído.

5. **Extensión de `patchReport` server action.** Hoy soporta solo columnas planas (`hasMerma`, `noTicketReason`, etc.). Lo extiendo con `ticketData`, `returnTicketData`, `ticketExtractionConfirmed`, `returnTicketExtractionConfirmed`. La whitelist sigue siendo explícita en el server (no pasa-tal-cual cualquier patch).

6. **Trigger del OCR: automático al montar** el step de review. Si `ticket_data` ya existe (re-entrada al mismo step tras un back), se pre-popula el form sin re-llamar Anthropic. Estado:
   - `idle` → no se ha intentado.
   - `extracting` → spinner.
   - `extracted` → form pre-poblado, editable.
   - `error` → mensaje + botón "Reintentar OCR" + "Llenar manualmente".

7. **Confidence score visible.** El system prompt pide a Claude un `confidence` 0-1. Si <0.6, mostramos un banner amarillo "Datos con baja confianza, revísalos antes de confirmar". El chofer puede confirmar igual — la decisión final es del humano.

8. **Items editables.** El chofer puede agregar / quitar / editar filas. Sin esto, una OCR con 2 errores en items obliga a reintentarlo. Mejor confiar en el chofer como editor humano.

9. **Validación al confirmar:** `numero` no vacío, `fecha` parseable como ISO date, `total` > 0. El chofer puede dejar campos vacíos durante edición — solo bloqueamos al confirmar.

10. **Error path: chofer offline o Anthropic down.** Form vacío con todos los campos editables manualmente. Botón "Confirmar" sigue funcional — el chofer puede llenar a mano. La columna `ticket_extraction_confirmed` se setea igual; el `ticket_data.confidence` queda en 0 para señalar "fue manual".

**Alternativas consideradas:**
- *OCR client-side con Tesseract.js:* gratis pero calidad mucho menor en tickets impresos en papel térmico (recibos típicos). Claude Vision lee mejor.
- *OpenAI GPT-4 Vision:* equivalente en precisión, pero ya tenemos Anthropic key y el system prompt ya está afinado para español mexicano.
- *Hacer el OCR en background/cron tras la subida de la foto:* mejor UX (chofer no espera) pero dificulta la edición — el chofer ya pasó al siguiente step. Decisión: hacer al chofer esperar 3-8s con spinner es aceptable porque la corrección es del momento.
- *Upload + OCR en una sola llamada:* mezcla concerns. Mejor mantener Storage upload separado del OCR.
- *Encolar OCR en el outbox:* descartado en punto 3 — gasta créditos en reintentos automáticos.

**Riesgos / Limitaciones:**
- **Latencia 3-8s perceptible.** Mitigación: spinner claro + "puedes editar manualmente si tarda demasiado".
- **Cuota / rate limit de Anthropic:** sin manejo explícito. A un chofer haciendo 30 paradas/día y 2 fotos/parada = 60 calls/día/chofer. 50 choferes activos = 3000 calls/día. Anthropic Tier 1 permite ~50 RPM — cerca del límite si todos suben al mismo tiempo. Mitigación pendiente: queue server-side con rate limit (n8n o lambda).
- **Costo:** ~$0.005-0.01 por imagen con Sonnet 4.6 (input ~1500 tokens, output ~500). 3000/día ≈ $20-30/día por tenant. Aceptable para B2B.
- **JSON parsing falla si Claude devuelve ruido:** `parseTicketJson` usa regex `\{[\s\S]*\}` y JSON.parse. Si Claude envuelve en markdown (` ```json ... ``` `), el regex funciona. Si devuelve texto plano sin JSON, lanza — clasificado como error por el cliente.
- **Items extraídos pueden ser `null`:** si la imagen está borrosa o cortada, items[] viene vacío. Cliente lo muestra como "0 items detectados — agrégalos manualmente".
- **Idempotency: dos clicks rápidos al "Reintentar OCR"** disparan dos calls a Anthropic. Mitigación: el botón se deshabilita durante `extracting`.
- **Campo `confidence` puede ser inflado por Claude:** modelo no es siempre calibrado. Aceptable para V1 — el chofer ve los datos y juzga.

**Oportunidades de mejora:**
- Cache server-side por hash de imagen — si el chofer reentra al step, sirve la extracción cacheada sin volver a llamar Anthropic.
- Comparación contra monto esperado (de la hoja física del pedido) para alertar discrepancias.
- Multi-imagen (anverso + reverso del ticket) en un solo call.
- Prompt afinado por cliente (Neto, OXXO tienen layouts distintos).
- Telemetría: % tickets extraídos correctamente vs editados manualmente — para mejorar prompt.

---

## [2026-05-02] ADR-023: Hardening pass tras Sprints 10-13 — outbox, validaciones, rate limits, invalidación de datos

**Contexto:** Tras cerrar Sprints 10-13 (outbox, IncidentCart, chat realtime, OCR), los self-reviews identificaron 11 bugs/vectores de robustez antes de pasar a Fase 3. Esta ADR resume las decisiones tomadas en la sesión de hardening.

**Decisiones agrupadas:**

### 1. Outbox: `in_flight` interrumpido se resetea al mount (Bug A)
Si el worker procesa un item y el chofer recarga la app mid-await, el item queda como `in_flight` permanentemente — `nextProcessable` lo excluye y nunca se reintenta.

**Decisión:** Al inicio del hook `useOutboxWorker`, ejecutar `resetInFlight()` que pasa todos los `in_flight` a `pending` SIN incrementar `attempts` (no fue su culpa). Idempotente.

### 2. Outbox: timeout en `processItem` (Bug B)
Si el server cuelga sin responder, `processOnce` queda esperando indefinidamente bloqueando los siguientes ticks (item permanece `in_flight`).

**Decisión:** `Promise.race(processItem, sleep(60s) → timeout)`. Tras timeout, clasificar como `retry` con error `"timeout"` — el item vuelve a pending con backoff y se reintenta naturalmente.

### 3. Outbox: barrera por `reportId` antes de submit (Bug C)
Hoy el outbox procesa FIFO global. Si hay `upload_photo → set_evidence → submit_report` en cola, y el upload falla 10 veces (`failed`), los siguientes items NO se quedan stuck — se procesan igual. Resultado: `submit_report` puede aplicarse sin que las fotos hayan subido.

**Decisión:** En `nextProcessable`, cuando el siguiente item sea de tipo terminal (`submit_report` / `submit_non_entrega`), verificar que NO haya items previos con el mismo `reportId` en estado `pending` o `failed`. Si los hay, saltar el submit hasta que se resuelvan. Item terminal queda esperando.

### 4. Outbox: manejo de `QuotaExceededError` (Bug D)
IndexedDB en iOS no-instalado limita ~50MB. Si el blob de una foto rebasa, `idb.put` falla y la operación se pierde silenciosamente.

**Decisión:** En `enqueue`, try/catch del put. Si error es `QuotaExceededError` o `DOMException` con name match: ejecutar `gc()` agresivo (todos los `done`, no solo >24h), reintentar una vez. Si vuelve a fallar, propagar error al caller para que muestre UX clara ("Espacio agotado, sincroniza pendientes antes de tomar más fotos").

### 5. Outbox: invalidación al reemplazar foto (Bug E + #45)
Cuando el chofer reemplaza la foto del recibo o ticket_merma, el `ticket_data`/`return_ticket_data` con la extracción vieja persiste — el chofer puede confirmar datos que NO corresponden a la foto actual.

**Decisión:** En `PhotoInput`, cuando el slot es `ticket_recibido` o `ticket_merma` Y `existingUrl` está set (es reemplazo, no primera vez), encolar también `patch_report` con `ticketData: null, ticketExtractionConfirmed: false` (o `returnTicketData: null, returnTicketExtractionConfirmed: false`). Esto fuerza re-OCR al volver al review step.

### 6. IncidentCart: coma decimal mexicana (#39)
`Number('1,5')` → NaN. UX rota porque el chofer escribe naturalmente con coma.

**Decisión:** Normalizar `replace(',', '.')` antes de `Number()` en el validador del draft.

### 7. Validaciones de input — defensa en profundidad
Sin `maxLength`/cap el usuario adversarial (o cliente con bug) puede inflar JSON, mensajes, descripciones.

**Decisión (caps razonables):**
- IncidentCart: `productName` ≤ 200 chars, `notes` ≤ 500 chars, `quantity` 0 < x ≤ 100,000.
- Chat (driver y manager): `text` ≤ 2,000 chars (≈ 1 página).
- TicketReview: `numero` ≤ 64 chars, `items` ≤ 50 filas, item.description ≤ 200 chars.
- Cap visible al user con contador cuando se acerque al límite.

### 8. Mime type validation en uploads (#43)
`<input accept="image/*">` solo restringe el picker, NO valida el blob real. Un usuario adversarial puede subir SVG con scripts que se ejecutan al click directo.

**Decisión:** En `uploadBlobToStorage` (driver) y `uploadBlobToStorage` (platform), validar `blob.type` contra allow-list `['image/jpeg', 'image/png', 'image/webp']`. SVG queda fuera deliberadamente. Cap defensivo de 10 MB. Rechazar con error claro.

### 9. Cron de chat timeout (#40)
`chat_status='open'` no migra a `'timed_out'` cuando `timeout_at < now()`. Dashboard de Fase 5 fallaría queries por estado.

**Decisión:** Migración 019 con función SQL `mark_timed_out_chats()` que ejecuta el UPDATE. Programada con `pg_cron` cada 1 minuto. Si pg_cron no está habilitado en el proyecto, documentar fallback (n8n schedule cada minuto que invoca la función). Verificar primero si pg_cron está disponible.

### 10. Rate limit OCR + chat (#41 + #46)
Spam posible: 50 reintentos del OCR gastan créditos Anthropic; 1000 mensajes del chofer en 10s saturan al comercial.

**Decisión:** Rate limit en memoria (Map<userId, timestamps[]>) en cada API route / server action sensible:
- `/api/ocr/extract-ticket`: 6 req/min por user (suficiente para casos legítimos de re-extracción).
- `sendDriverMessage`: 30 msg/min por user (3 cada 6s — humano máximo).
- `sendManagerMessage`: 60 msg/min (oficinistas pueden ser más rápidos, varios con cliente al mismo tiempo).

Implementación simple, no usa Redis ni tabla DB — el rate state vive en process memory. Aceptable para V1 (un solo proceso por app). Cuando se escale a multi-proceso, migrar a Redis o `rate_limits` table.

### 11. Supuestos de datos: defensas runtime
Los self-reviews encontraron varios "supuestos sin validación":

**Decisión:**
- Mapper `mapDeliveryReport` y `mapMessage` validan presencia de campos críticos (id, report_id) y lanzan error claro si faltan.
- API route `/api/ocr/extract-ticket` valida `kind` contra enum.
- Server actions de chat ya rechazan `text && imageUrl` ambos null — verificado.

**Riesgos / Limitaciones:**
- Rate limits en memoria se pierden tras reinicio del process — un atacante puede hacer 6 req justo antes y 6 después. Aceptable para V1.
- `pg_cron` requiere habilitar la extensión en Supabase — si no está disponible, fallback manual.
- Caps de chars no protegen contra carácteres unicode multi-byte (un emoji de 4 bytes cuenta como 2 JS chars). Para V1 es OK.
- Bug C (barrera) puede atorar la cola si un upload entra en `failed` y el chofer no hace retry manual — el submit nunca se procesa. Mitigación: el badge rojo lo expone al chofer.

**Oportunidades de mejora:**
- Telemetría: cuántos items pasan por `failed`, cuántos timeouts, cuántas invalidaciones de ticket_data.
- Rate limit distribuido (Redis) cuando llegue la fase multi-tenant.
- Compactación de la cola: drop advance_step duplicados consecutivos para mismo report.

---

## [2026-05-02] ADR-024: Tiros (`dispatches`) como agrupador operativo de rutas

**Contexto:** Hoy `routes` es la unidad operativa: cada ruta es independiente, asignada a 1 camión y 1 zona, con su propio nombre/fecha/status. En la práctica, la operación VerdFrut sale en "tiros" — un día Pedro CDMX hace 1 "tiro" que consiste en cargar N camionetas (3 Kangoos) y mandarlas a sus respectivas zonas o sub-zonas. Las 3 rutas comparten día, depot, comercial supervisor y muchas veces se aprueban/publican juntas.

Sin agrupación, el dispatcher ve 30 rutas/semana sueltas y pierde contexto. Pidió que las rutas se agrupen por "tiro" (lote operativo) con vista del set completo.

**Decisión:**

1. **Nueva tabla `dispatches`** (tiros). Una fila = un lote operativo. Atributos:
   - `id`, `name` (ej. "Tiro CDMX matutino", "Test", "Pedido VIP Bodega Aurrera")
   - `date`, `zone_id`
   - `status`: `planning` | `dispatched` | `completed` | `cancelled` (status agregado del set)
   - `notes` (opcional)
   - `created_by`, `created_at`, `updated_at`
   - UNIQUE `(zone_id, date, name)` — evita tiros duplicados con mismo nombre el mismo día.

2. **`routes.dispatch_id` UUID nullable FK a dispatches.** Nullable por:
   - Back-compat: rutas existentes (las 3 actuales) tienen `dispatch_id=null` y se ven en la lista plana.
   - Casos edge: si por alguna razón quieren rutas independientes sin tiro (auditoría, prueba aislada).

3. **Status del tiro NO es UPDATE manual; se deriva.** Cuando la última ruta del tiro pasa a `COMPLETED`, el tiro se actualiza vía trigger a `completed`. Cuando alguna ruta pasa a `IN_PROGRESS`, el tiro pasa a `dispatched`. Beneficio: no hay drift entre status del tiro y de sus rutas.

4. **Operaciones a nivel tiro (V1):**
   - Crear tiro vacío.
   - Agregar rutas (un dispatcher puede crear N rutas dentro del mismo tiro, una por camión).
   - Optimizar individualmente cada ruta (no optimización conjunta en V1 — cada ruta tiene su camión propio, las restricciones no se cruzan).
   - Aprobar / publicar todo el tiro de una vez (botón "Publicar tiro" → llama publish a cada ruta).
   - Reordenar paradas dentro de cada ruta (la query existente `reorderStop` ya lo soporta).
   - Editar nombre/notas del tiro.

5. **UI:**
   - `/dispatches` reemplaza la home de logística como vista principal. Lista de tiros agrupados por fecha (hoy / mañana / semana). Card por tiro con summary: nombre, # rutas, # paradas, status agregado.
   - `/dispatches/[id]` detalle: mapa multi-route con leyenda (similar a la imagen actual de `/routes`), lista de rutas a la derecha con su estado, drag-drop de paradas dentro de cada ruta. Botones: "Agregar ruta", "Publicar todo", "Editar nombre/notas".
   - `/routes` se mantiene como "vista plana" — útil para búsqueda cross-tiro o auditoría. Con filtro nuevo "Tiro" para encontrar rutas sin tiro.
   - Al crear ruta, formulario opcional "Asignar a tiro" (dropdown de tiros del día); si no eliges, queda como ruta huérfana.

6. **No reemplazamos `routes` con `dispatches`.** Una ruta es la unidad de ejecución (chofer + camión + paradas + reportes). Un tiro es un agrupador organizativo. Mezclarlos rompe el modelo (¿cuál ruta tiene chofer asignado dentro del tiro?). Conservar ambos.

7. **RLS:** mismo patrón de routes — admin/dispatcher ven todos, zone_manager solo de su zona, driver no ve dispatches (no aplica para él).

**Alternativas consideradas:**
- *Solo agregar `routes.batch_name TEXT`:* sirve para visualización pero no permite metadata propia del tiro (notas, status agregado, audit). Desechado.
- *Hacer dispatches un VIEW computado:* simple pero no permite editar el grupo (renombrar tiro afectaría queries dependientes).
- *Reemplazar `routes` por `dispatches.routes JSONB`:* destruye RLS por ruta, joins, y todo lo construido. Rotundo no.
- *Optimización conjunta de todas las rutas del tiro:* tentador pero (a) cada Kangoo tiene su propio depot=CEDIS Vallejo, (b) el optimizer ya soporta multi-vehículo, lo cual sería el approach correcto si quisiéramos un solo gran VRP. Pendiente para V2 cuando la fricción lo amerite.

**Riesgos / Limitaciones:**
- **Rutas huérfanas** acumuladas pueden generar UI inconsistente (algunas en /dispatches, otras solo en /routes). Mitigación: en /routes filtro "sin tiro" para detectarlas.
- **Trigger de status agregado** corre en cada UPDATE de routes — riesgo mínimo de overhead, pero podría causar update loop si no es cuidadoso (UPDATE dispatches → no dispara trigger en routes, OK). Validar.
- **UNIQUE (zone_id, date, name)** asume que el nombre del tiro es único por zona/día. Si dos dispatchers crean "Test" el mismo día, choca. Aceptable: pedimos error y que renombren.
- **Borrar un tiro**: ON DELETE SET NULL para `routes.dispatch_id`, así borrar el tiro NO borra sus rutas (pueden quedar como huérfanas). Esa es la decisión segura.

**Oportunidades de mejora:**
- Optimización conjunta multi-vehículo (un tiro = un VRP).
- Templates de tiro (ej. "Tiro semanal CDMX matutino" preconfigurado con N rutas).
- Métricas agregadas por tiro: distancia total, tiempo, costo, # paradas exitosas.
- Notificaciones al chofer cuando "su" tiro se publique completo.
- Visualización Gantt de tiempo por ruta dentro del tiro.

---

## [2026-05-02] ADR-025: Mover paradas entre rutas dentro de un tiro (manual override)

**Contexto:** El optimizer VROOM minimiza distancia+tiempo total y NO balancea por número de paradas. Con la nueva capacidad realista (6 cajas/Kangoo, 1 caja/tienda), VROOM puede asignar 6 paradas a una camioneta y 3 a otra si geográficamente es óptimo. Esto es correcto, pero el dispatcher humano a veces sabe contexto que el optimizer no:
- Una tienda específica está más segura entregada por un chofer que la conoce.
- El chofer X tiene auxiliar / el Y va solo (importa para tiendas pesadas).
- Un cliente VIP debe estar en la primera ruta.

Necesitamos un override manual: mover una parada de Ruta A → Ruta B dentro del mismo tiro, sin re-correr el optimizer.

**Decisión:**

1. **Server action `moveStopToAnotherRouteAction(stopId, targetRouteId)`**.
   - Valida que ambas rutas estén editables: `DRAFT`, `OPTIMIZED`, `APPROVED`. Si están `PUBLISHED+`, rechaza (el chofer ya tiene la ruta en su PWA — no podemos moverle paradas sin avisar).
   - Valida que estén en el mismo tiro (`dispatch_id` igual) O ambas sin tiro. Mover entre tiros distintos requeriría re-validar zona/fecha — fuera de scope V1.
   - Append al final de la ruta destino (sequence = max+1). Si el dispatcher quiere otro orden, usa el drag-drop existente.
   - Re-numera sequence en ruta origen para no dejar huecos.

2. **NO recalcular `planned_arrival_at`/`planned_departure_at` del stop movido.** Quedan vivos los tiempos del optimizer original (que ya no son exactos). UI muestra warning "Re-optimiza el tiro para recalcular ETAs". El dispatcher decide si vale la pena.

3. **NO validar capacidad estricta.** Si mover una parada hace que la ruta destino exceda `vehicles.capacity[2]`, mostramos warning visual pero no bloqueamos — el dispatcher sabe que algo así es por excepción y puede ajustar después.

4. **UI en `/dispatches/[id]`:** cada ruta del tiro despliega su lista de paradas. Cada parada tiene un dropdown "Mover a → [otra ruta]" listando solo las hermanas editables.
   - Render compacto: solo si ya hay paradas optimizadas (status ≥ OPTIMIZED), ocultar para DRAFT vacíos.
   - Tras mover → router.refresh() para re-leer ambas rutas.

5. **No drag-drop entre rutas (V1).** Implementar drag-drop cross-list es ~5x más código que un select y la fricción del select es aceptable para dispatcher experimentado. Drag-drop entre rutas se puede agregar como mejora cuando el N de paradas/tiro crezca.

**Alternativas consideradas:**
- *Re-correr optimizer con paradas "lockeadas":* VROOM soporta `priority` y restricciones, pero requiere setup más complejo. Override manual cubre 95% de casos.
- *Permitir mover entre tiros:* tentador pero abre validaciones (zona/fecha distinta, ¿qué hacer con time windows?). YAGNI.
- *Drag-drop cross-list con dnd-kit:* mejor UX pero ~3 días de UX work. Diferido.

**Riesgos / Limitaciones:**
- **ETAs desfasados:** stop movido conserva `planned_arrival_at` del optimizer viejo. Visualmente los ETAs ya no concuerdan con el orden geográfico. Mitigación: warning visible + botón "Re-optimizar tiro" (futuro V2).
- **Capacity exceeded silencioso:** si dispatcher amontona 8 paradas en una Kangoo de capacity=6, no bloqueamos. El warning visual es suficiente para V1 — confiamos en el dispatcher.
- **Race con publish:** dispatcher A está moviendo paradas mientras dispatcher B publica el tiro. Mitigación: validamos status al inicio del action, pero entre el read y el write hay ventana ms — improbable en práctica.
- **Reorder dentro de la misma ruta** ya existe (drag-drop en `/routes/[id]`); aquí solo agregamos el cross-route.

**Oportunidades de mejora:**
- Re-optimizar la ruta destino tras un move (recalcular sequence + ETAs sin pedirle al dispatcher).
- Drag-drop cross-list con dnd-kit cuando el N crezca.
- Hint del optimizer: "Mover esta parada a Kangoo 2 ahorraría 8 km" — análisis post-hoc visible al dispatcher.
- Lock de paradas: marcar una parada como "obligada en ruta X" antes de optimizar, para que el optimizer respete la asignación.
- Bulk move (mover N paradas a la vez con multi-select).

---

## [2026-05-02] ADR-026: Tema dark/light con cookie + layout consola del Mapa en vivo

**Contexto:** El usuario validó un mockup de "Mapa en vivo" tipo consola operacional moderna: sidebar de choferes + mapa central + panel detalle, con paleta dark profunda y accent verde brillante. El sistema actual tenía:
- `data-theme="light"` hardcodeado en root layout (toggle no implementado).
- Tokens dark definidos pero sub-utilizados; sin contraste suficiente para look "consola".
- `/map` como `EmptyState` placeholder.

**Decisión:**

1. **Tema dark/light con cookie `vf-theme`.** Cookie escrita por `<ThemeToggle/>` (client) y leída en `RootLayout` server component vía `cookies()`. Beneficio: el SSR renderiza con `data-theme` correcto desde el primer byte — sin flash claro→oscuro.
   - Toggle muta `document.documentElement.setAttribute('data-theme', ...)` en runtime para feedback instantáneo y escribe cookie con max-age 1 año.
   - Sin server action — el toggle es 100% client. Cookie es el único persistor.

2. **Tokens dark refinados** (apps/platform `--vf-bg` 0.18→0.155, etc.) para matchear consolas operacionales: fondo cuasi-black, surfaces escalonados, accent verde más brillante (`--vf-green-700` sube de 0.42→0.55 lightness en dark mode). Sidebar siempre dark (heredado de identidad).

3. **`/map` como layout 3-columnas full-bleed** (no respeta el `max-w-7xl` ni el padding del shell):
   - Server component carga rutas con status `PUBLISHED`/`IN_PROGRESS`/`COMPLETED` del día, joina drivers + vehicles + zones + último breadcrumb (proxy de posición actual).
   - Client component renderiza grid `320px / 1fr / 360px`:
     - Sidebar choferes con tabs (Todos / En ruta / Con incidencia / Completados) + lista clickeable.
     - Mapa Mapbox con marcadores por chofer (selected más grande con glow), `dark-v11` style.
     - Panel detalle con avatar, status chip, métricas (camioneta, ruta, última señal, ETA), barra de progreso y card de próxima parada.

4. **Mecanismo "fullbleed" generalizable:** el shell layout aplica padding/max-width al `vf-main-inner` por default; páginas que necesiten edge-to-edge marcan su root con `data-fullbleed`. Una regla CSS con `:has()` neutraliza el padding cuando esa marca existe. Otras páginas no se afectan.
   - Soporte navegador: `:has()` está en Chrome/Edge/Safari/Firefox 121+ (todos los moderns). Aceptable para una app de oficina interna.

5. **Posición del chofer = último breadcrumb persistido** (no broadcast realtime, V1).
   - Limita la "frescura": si el chofer publicó hace 90s, el marker está 90s atrasado.
   - Trade-off consciente: aprovechamos la query existente de `route_breadcrumbs`. La integración con `gps:{routeId}` realtime channel queda para iteración cuando el caso operacional lo amerite — refresh cada 30s con un `setInterval` + revalidate también es opción.

6. **Tab "Con incidencia" cableado a 0** por ahora — falta query que cruza `delivery_reports.chat_status='open'` con la ruta. Pendiente menor.

**Alternativas consideradas:**
- *localStorage en lugar de cookie:* funciona en client pero no permite SSR con tema correcto → flash. Cookie gana.
- *system theme detection (`prefers-color-scheme`):* añadir como tercer modo "auto" es trivial pero el toggle simple cubre 95%. Diferido.
- *Mapbox Realtime markers conectados al canal `gps:`:* mejor UX pero ~2x más código y RLS de Realtime tendría que validar admin/dispatcher en lugar de driver. Posterior.
- *`negative margin` en `/map` para escapar padding:* funciona pero no escapa `max-w-7xl`. `:has()` es más limpio.

**Riesgos / Limitaciones:**
- **Flash en navegadores sin `:has()`:** Firefox <121 ignora la regla y `/map` queda con padding. Mitigación: `data-fullbleed` también marca la app como tal y se ve "constreñida pero funcional".
- **Posición desfasada:** N segundos de retraso vs realidad. Mitigación: timestamp visible "hace 12s".
- **Página `/map` carga N+1 queries** (1 por ruta para breadcrumbs + 1 por driver para profile). Aceptable con N≤20 rutas/día. Optimizar a 1 join compuesto cuando el dataset crezca.
- **Tokens dark afectan TODAS las apps**, incluyendo driver. Driver app forza `data-theme="light"` en `<html>` (legibilidad bajo el sol) — no se afecta. Verificado.

**Oportunidades de mejora:**
- Realtime marker movement con interpolación `requestAnimationFrame` (issue #34 ya documentado).
- Modo "auto" siguiendo `prefers-color-scheme`.
- Tab "Con incidencia" funcional (cruzar `chat_status='open'`).
- Filtro por zona en el sidebar (cuando haya >1 zona activa).
- Búsqueda global del topbar funcional (placeholder hoy).
- Cluster de markers cuando hay >20 choferes en una región.

---

## [2026-05-06] ADR-027: Parches de seguridad — Session timeout, invite landing page, orphan cleanup, redirect URLs

**Contexto:** Sesión de hardening de seguridad antes de Fase 3. Cuatro issues importantes que, aunque no bloquean en prueba, necesitan estar resueltos antes de producción real con choferes y datos reales.

**Decisión:**

*#15 — Auto-logout por inactividad (8h):*
Hook `useInactivityLogout` montado en el root layout del driver PWA via `<InactivityGuard />`. Escucha `touchstart`/`click`/`keydown` para refrescar timestamp en `localStorage`. En `visibilitychange` (app regresa al foreground) y en cada mount de página, verifica si `now - lastActive > 8h`. Si sí, llama `supabase.auth.signOut()` y redirige a `/login`. 8h cubre una jornada completa sin cerrar sesión a mid-delivery.

*#11 — Invite link no consumible por previews (WhatsApp):*
Links copiables de invite/recovery ahora apuntan a `/auth/invite?t=<token_hash>&type=<tipo>` en lugar de `/auth/callback?token_hash=...`. La nueva página es un Server Component que renderiza HTML estático con un botón. El token solo se consume cuando el chofer toca "Activar mi cuenta" (client-side `verifyOtp`). WhatsApp/iMessage no ejecutan JavaScript, por lo que el token sobrevive hasta el clic real.

*#16 — Reconciliación de auth.users huérfanos:*
Migración 021 agrega función SQL `get_orphan_auth_users()` (SECURITY DEFINER) que detecta `auth.users` sin `user_profiles` correspondiente (>1h). Endpoint cron `/api/cron/reconcile-orphan-users` (mismo patrón de auth que mark-timed-out-chats) llama la función y luego elimina cada huérfano via `admin.auth.admin.deleteUser()` (Admin API limpia cascading, no DELETE directo). Se ejecuta 1× por día desde n8n.

*#14 — Redirect URLs automáticas en provision:*
`provision-tenant.sh` ahora llama `PATCH /v1/projects/{id}/config/auth` inmediatamente después de aplicar las migraciones. Configura `site_url` (platform URL) y `additional_redirect_urls` (`/auth/callback`, `/auth/invite`, `/login`). Elimina la necesidad de edición manual en Supabase Dashboard por cada tenant nuevo.

**Alternativas consideradas:**

*#15:* Timeout de 12h (más laxo, más conveniente si el chofer hace jornadas largas). Elegimos 8h porque protege mejor el caso de "teléfono olvidado/robado fuera de jornada".

*#11:* PKCE completo (code_verifier en localStorage, code_challenge al servidor). Más robusto pero requiere cambiar el flow de `inviteUserByEmail` a OAuth-style PKCE — complejidad alta. La landing page logra la misma protección contra crawlers con 1/10 del código. PKCE queda como mejora futura si se necesita proteger también el link del email (no solo WhatsApp).

*#16:* Envolver `inviteUser()` en una RPC de Postgres con SAVEPOINT para rollback atómico. Más correcto a largo plazo pero requiere reescribir el flujo de invitación. El job nocturno es la net de seguridad adecuada para la escala actual.

*#14:* Dejar como tarea manual documentada. Descartado — un tenant mal configurado bloquea el primer invite y nadie entiende por qué. Automatizar es la única opción confiable.

**Riesgos / Limitaciones:**

- *#15:* `localStorage` no está disponible en SSR — el hook es `'use client'` y solo corre en browser. Correcto por diseño.
- *#15:* Si el chofer usa la app con pantalla encendida durante >8h sin tocar nada (GPS activo), la sesión se cerrará. Mitigación: el GPS broadcast y el outbox worker generan actividad indirecta, pero no tocan el DOM — no actualizan el timestamp. Opción futura: que el outbox worker también refresque el timestamp de inactividad.
- *#11:* El email enviado por Supabase directamente (vía `inviteUserByEmail`) todavía apunta a `/auth/callback` (server-side Route Handler). Si ese email es abierto por un cliente con link preview, el token se consumiría. Mitigación actual: los emails de invitación de Supabase son para chofer sin WhatsApp (raro). El link copiable, que es el path principal, ya está protegido.
- *#16:* Si el admin invita a alguien y el job corre antes de que el chofer active su cuenta Y entre en la ventana de 1h sin profile (e.g., invite falla al insertar profile), el job limpia el usuario antes de que el chofer tenga chance. Ventana de 1h mitiga esto para el caso normal.
- *#14:* La lista de redirect URLs en Supabase es estática al momento del provisioning. Si el dominio del tenant cambia post-provisioning, hay que actualizar manualmente vía CLI o Dashboard.

**Oportunidades de mejora:**

- *#15:* Que el outbox worker y el GPS broadcast también refresquen el timestamp de inactividad.
- *#11:* Migrar a PKCE completo para proteger también el link del email original.
- *#16:* Envolver `inviteUser()` en RPC con SAVEPOINT para rollback atómico — eliminaría la necesidad del job correctivo.
- *#14:* Agregar comando de "re-sync auth config" al `migrate-all-tenants.sh` para actualizar redirect URLs en todos los tenants si el esquema de dominios cambia.

---

## [2026-05-06] ADR-028: Dashboard cliente — agregaciones SQL + Recharts + filtros vía URL

**Contexto:** Inicio de Fase 3. El cliente distribuidor necesita ver KPIs operativos, comerciales y de calidad de su flota para tomar decisiones del día siguiente y tener evidencia para sus propios stakeholders. El stub de `/dashboard` mostraba placeholders; los reportes salían de queries ad-hoc en Supabase Studio.

**Decisión:**

*Agregaciones en SQL functions, no en TS:*
Migración 022 agrega 4 funciones — `get_dashboard_overview`, `get_dashboard_daily_series`, `get_dashboard_top_stores`, `get_dashboard_top_drivers`. Una sola RPC devuelve los 12 KPIs completos. Las funciones son `STABLE` y `SECURITY INVOKER` para que respeten RLS automáticamente — un `zone_manager` jamás ve datos fuera de su zona aunque pase un `zoneId` distinto. Sumas sobre campos JSONB (ticket_data->>'total') se hacen con cast nativo a numeric, imposible de hacer eficientemente desde el cliente Supabase JS sin SQL puro.

*KPIs definidos (12 tarjetas en 3 grupos):*
- **Operativos:** Rutas completadas, Tiendas visitadas (DISTINCT), % Completitud (stops_completed/stops_total), Distancia total (km).
- **Comerciales:** Total facturado (Σ ticket.total), Ticket promedio, # Tickets, % Merma (Σ return.total / Σ ticket.total).
- **Calidad:** # Incidencias (Σ jsonb_array_length(incident_details)), # Tiendas cerradas, # Reportes báscula, # Escalaciones (chats abiertos).

*Filtros vía searchParams (no client state):*
`/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&zone=<uuid>` — el server component re-renderea con cada cambio, sin ningún hook de fetching del lado del cliente. Default: últimos 30 días, sin filtro de zona. Los filtros son shareables vía URL (un dispatcher manda link al admin con ese mismo rango).

*Recharts para gráficos:*
ComposedChart dual-axis: barras (entregas) + línea (facturado) por día. Cliente component (`'use client'`) porque Recharts usa SVG runtime. Bundle adicional: ~50KB gzipped — aceptable para una app de operadores en escritorio.

*Defensa en profundidad para zone_manager:*
La página fuerza `zoneId = profile.zoneId` para `zone_manager`, ignorando lo que venga en searchParams. RLS también filtra. Doble barrera: aunque la UI permitiera "ver todas las zonas" por error, el server siempre filtra al alcance del usuario.

**Alternativas consideradas:**

*Queries TS con `.select().in().group()`:* Descartado. PostgREST no soporta agregaciones complejas sobre JSONB con casts. Hubiéramos terminado pidiendo todas las filas y agregando en JS — costoso en red y memoria.

*Vistas materializadas:* Más rápido para consultas repetidas, pero requiere refresh schedule y los rangos arbitrarios (cualquier from-to) hacen que una vista materializada por día tampoco sea suficiente. Las funciones STABLE con índices existentes (`idx_routes_zone_date`, `idx_reports_zone_status`) responden bien para rangos de 30-90 días.

*State management cliente (TanStack Query):* Innecesario. El dashboard es un view de lectura, los filtros son URL-driven, no hay mutaciones. Server Component es el patrón correcto.

*ChartJS / Visx en lugar de Recharts:* Recharts tiene mejor DX y SSR-friendly (los componentes son markup React directo, no canvas/imperative). El bundle es comparable o mejor.

*Más KPIs (15-20 tarjetas):* Decidimos quedarnos en 12 hasta que el cliente nos pida más. El feedback temprano evita pulir métricas que nadie ve.

**Riesgos / Limitaciones:**

- *Bug en runtime descubierto al cerrar Sprint 17 (post-mortem):* `get_dashboard_overview` lanzaba `column reference "total_distance_meters" is ambiguous` en runtime. Causa raíz: en plpgsql, los nombres de las columnas OUT del `RETURNS TABLE` están en el mismo namespace que las columnas referenciadas dentro del cuerpo. El CTE `rs` exponía `r.total_distance_meters` y la función tenía un OUT param con el mismo nombre — Postgres no sabía a cuál refería al hacer `SUM(total_distance_meters)`. Fix aplicado: cualificar SIEMPRE las columnas con el alias del CTE (`rs.total_distance_meters`, `dr.ticket_data`, `sx.status`, etc.) en cada subquery dentro de funciones plpgsql con `RETURNS TABLE`. Las funciones `LANGUAGE sql` (top_stores, top_drivers, daily_series) no tienen este problema porque SQL puro no inyecta los OUT params en el namespace. Aprendizaje para próximas funciones plpgsql: o cualificar con alias, o usar `#variable_conflict use_column` al inicio del cuerpo. Comentario explicativo agregado al inicio del cuerpo de la función para que sea evidente para mantenedores futuros.
- *Tiempo respuesta chat:* No incluido en Sprint 14 — requiere computar diferencias entre primer mensaje del chofer y primer mensaje del manager por reporte. Lo agregaremos en Sprint 15 si lo piden.
- *Conversión de TZ:* `daily_series` agrupa por `(d.created_at AT TIME ZONE 'UTC')::DATE` — usa UTC, no la TZ local del tenant. Para clientes en TZ con offset >12h del UTC podría haber un día de discrepancia con `routes.date`. Mitigación: la mayoría de los clientes están en `America/Mexico_City` (UTC-6), donde la discrepancia es mínima al final del día. Mejora futura: parametrizar la TZ.
- *RPC count exacto:* Las funciones devuelven los datos del rango pero no metadata como "total filas posibles" — para paginar (Sprint 15 cuando hagamos drill-downs) habrá que añadirlo.
- *Cache:* `force-dynamic` en la página — se ejecutan las 4 RPCs por cada request. Aceptable hoy. Si el dashboard se vuelve pesado, agregar `cache: 'force-cache'` con `revalidate: 300` y/o usar Next.js `unstable_cache`.

**Oportunidades de mejora:**

- Drill-down a `/dashboard/stores/[id]` y `/dashboard/drivers/[id]` con histórico — Sprint 15.
- Export XLSX para ERP — Sprint 16.
- Comparativa con período anterior ("vs últimos 30 días" delta sobre cada KPI).
- Filtro por chofer y por tienda específica.
- Modo "tarjeta semanal" (KPIs de semana actual vs semana anterior).
- Heatmap de horarios de entrega (qué horas son más eficientes).
- Tarjeta de tiempo promedio de respuesta del manager en chats.

---

## [2026-05-06] ADR-029: Drill-downs y export XLSX para ERP — Sprints 15-16

**Contexto:** Cierre de Fase 3. Después del dashboard core (ADR-028), faltaban dos piezas: (1) que el cliente pueda hacer click en una tienda/chofer y ver su histórico, (2) que pueda exportar los tickets del período a un archivo que su ERP/Sheets pueda procesar (el cliente no compra módulos de integración custom — pide CSV/XLSX).

**Decisión:**

*Sprint 15 — Drill-downs:*

Cuatro páginas nuevas bajo `/dashboard`:
- `/dashboard/stores` — listado de todas las tiendas con actividad en el período (reusa `get_dashboard_top_stores` con `limit=1000`).
- `/dashboard/stores/[id]` — header con info de la tienda, 5 cards de métricas agregadas (visitas, facturado, ticket promedio, devuelto, incidentes), tabla con histórico de visitas (cada fila con badge de tipo, link a la ruta y al chat si aplica).
- `/dashboard/drivers` y `/dashboard/drivers/[id]` — análogos para choferes (rutas asignadas, paradas completadas, distancia, duración, facturado).

Las queries de detalle (`getStoreVisits`, `getDriverRoutes`) son joins directos con PostgREST nested selects, no SQL functions — son simples lookups, no agregaciones complejas. Los nombres de chofer se resuelven en una segunda pasada para evitar JOIN anidado con `user_profiles` que PostgREST tipa de forma confusa.

`DashboardFilters` se hizo path-aware: usa `usePathname()` para que el redirect tras cambiar fechas funcione tanto en `/dashboard` como en `/dashboard/stores` o `/dashboard/drivers`.

*Sprint 16 — Export XLSX:*

Endpoint `GET /api/export/tickets?from=&to=&zone=` autenticado por cookie. Devuelve un archivo `.xlsx` con `Content-Disposition: attachment` y nombre `verdfrut-tickets-<from>-<to>.xlsx`. El browser descarga directamente cuando el user toca el botón en `/dashboard` (`window.open(url, '_blank')`).

El XLSX tiene 4 hojas, generadas con `exceljs`:
1. **Tickets** — 1 fila por delivery_report con resumen (fecha, ruta, tienda, chofer, # ticket, total, # items, devolución total, # incidentes, merma).
2. **Items** — 1 fila por item del ticket principal (granular, para reconciliación de inventario en el ERP).
3. **Devoluciones** — 1 fila por item del return_ticket. Si la devolución tiene total pero no items detallados, se exporta una fila con solo el total (información parcial mejor que nada).
4. **Incidentes** — 1 fila por elemento de `incident_details[]` (rechazos, faltantes, sobrantes, devoluciones declaradas manualmente por el chofer).

Header bold + frozen pane en cada hoja. Columnas con `numFmt: "$"#,##0.00` para totales monetarios — Excel/Sheets las muestran formateadas sin que el usuario tenga que aplicar formato.

Cap defensivo `MAX_REPORTS = 10_000` para evitar OOM si alguien pide un export del año entero. zone_manager forzado a su zona (defensa en profundidad sobre RLS).

**Alternativas consideradas:**

*POST con body JSON + blob fetch:* Más control pero requiere JS adicional para crear blob y trigger anchor sintético. GET con `Content-Disposition` lo resuelve nativamente y respeta cookies de sesión.

*CSV en lugar de XLSX:* CSV no soporta múltiples hojas — habría que generar 4 archivos separados o un solo archivo plano. XLSX abre limpio en Excel, Numbers y Google Sheets, y permite formato monetario nativo. Tamaño es comparable porque XLSX es ZIP comprimido.

*SQL function que devuelve directamente el XLSX (con `pg-xlsx` o similar):* Innecesariamente complejo. El TS layer es donde naturalmente vive la lógica de presentación (qué columnas, qué formato, cómo etiquetar tipos).

*Streaming row-by-row con `WritableStream`:* Para 10K reportes (~30MB de XLSX) no se justifica. Buffer en memoria es simple y rápido. Si crece la escala, migrar a streaming será trivial (`ExcelJS.stream.xlsx.WorkbookWriter`).

*Recharts library para drill-downs:* Considerado mostrar mini-charts en las páginas de detalle (sparkline de visitas mensuales por tienda). Decidimos esperar feedback — los stakeholders pueden no necesitarlo y son ciclos extra sin valor confirmado.

**Riesgos / Limitaciones:**

- *Top X con LIMIT excluye 0-actividad:* `get_dashboard_top_stores` tiene `HAVING COUNT > 0` para los top 10 del overview. Reusarlo para el listado completo significa que tiendas SIN visitas en el período no aparecen. Mitigación: para auditarlas, usar `/settings/stores` (que sí lista todas). Mejora futura: parámetro `include_inactive` en la SQL function.
- *Devoluciones sin items detallados:* el OCR puede fallar al extraer items del ticket de merma — solo persiste el `total`. Exportamos esa fila parcial para que el cliente al menos vea que hubo una devolución. Si quiere granular, debe entrar al reporte y editarlo manualmente.
- *Cap de 10K reportes:* puede ser bajo para clientes grandes (ej. 30 zonas × 200 reportes/día × 30 días = 180K). Mitigación: el cap puede subirse fácil cambiando `MAX_REPORTS`. A esa escala probablemente convenga streaming + descarga progresiva.
- *Formato `numero` en ticket_data:* viene como string del OCR. El ERP que lo importe puede necesitar parsing si espera número. Decidimos NO castear (no perder ceros a la izquierda, prefijos, etc.). El cliente formatea según su ERP.
- *Hojas vacías:* si un export no tiene devoluciones ni incidentes, esas hojas quedan con solo el header. Aceptable — el ERP detecta hojas vacías sin error.

**Oportunidades de mejora:**

- Filtro por chofer/tienda específica en el export (ya tenemos los IDs en searchParams).
- Botón de export también en `/dashboard/stores/[id]` y `/drivers/[id]` (export limitado a esa entidad).
- Hoja adicional "Resumen" con los 12 KPIs del overview (algunos ERPs lo pegan directo en su reporte mensual).
- CSV separado por hoja para clientes con ERPs antiguos que no leen XLSX.
- Email del XLSX al admin (n8n schedule mensual con auto-export del mes anterior).
- Sparklines en `/dashboard/stores/[id]` con histórico de 12 meses.
- Comparativa con período anterior en cada drill-down ("vs 30 días previos").

---

## [2026-05-06] ADR-030: Control Plane VerdFrut — schema co-localizado, shared password V1

**Contexto:** Inicio de Fase 4. VerdFrut necesita un panel propio (no del cliente) para gestionar tenants, ver KPIs agregados cross-tenant y eventualmente onboardear nuevos clientes. Hasta hoy el "control plane" era el script `provision-tenant.sh` + ediciones manuales en Supabase Studio. No escala más allá de 1-2 clientes.

**Decisión:**

*Co-localización en proyecto Supabase existente (Escenario 2 de la matriz que discutimos):*

El schema `control_plane` vive en el MISMO proyecto Supabase que el tenant primario (rifigue97). Aislamiento garantizado por:
1. **Schema PostgreSQL separado** (`control_plane.tenants`, `control_plane.tenant_kpi_snapshots`, etc.).
2. **RLS habilitado SIN policies** — anon y authenticated no pueden leer ni una fila.
3. **REVOKE USAGE** del schema para anon/authenticated — ni siquiera pueden nombrar las tablas en una query.
4. **service_role como único caller** — bypassea RLS por diseño, lo usa solo el control plane.

ADR-001 obligaba a "un proyecto por cliente" para evitar leak entre competidores. El control plane es **un caso distinto**: es propiedad de VerdFrut, no de un cliente. Las razones de ADR-001 (data leak entre OXXO y Neto) no aplican igual aquí — el riesgo es VerdFrut leyendo a sus propios datos operativos. Trade-off explícito: aceptamos blast radius compartido a cambio de no pagar $25/mes adicionales en testing.

**Triggers para migrar a Escenario 3 (proyecto separado):**
- Cuando VerdFrut firme su 2º cliente real, O
- Cuando un contrato exija aislamiento total de datos del proveedor SaaS, O
- Cuando el CP tenga queries pesadas que afecten perf del tenant.

Migración trivial: `pg_dump --schema=control_plane $CURRENT | psql $NEW_CP_PROJECT`.

*App nueva `apps/control-plane` (Next 16, port 3002):*

- Reusa packages `@tripdrive/ui`, `@tripdrive/types`, `@tripdrive/utils`, `@tripdrive/supabase`.
- No usa `@tripdrive/maps` ni `@tripdrive/flow-engine` ni `@tripdrive/ai` — el CP no los necesita.
- Sidebar siempre dark (consistente con identidad VerdFrut) + badge "CTRL" para distinguir visualmente.
- Theme dark forzado en root layout — el CP no tiene toggle, distinto a platform.

*Auth V1 — shared password con cookie HMAC:*

`CP_SHARED_PASSWORD` en env. El staff de VerdFrut entra con esa password única, recibe una cookie `cp-session` firmada con HMAC-SHA256 (`CP_COOKIE_SECRET`). Cookie HTTP-only, secure (en prod), sameSite=lax, expira en 7 días.

El middleware (Edge runtime) verifica la firma con Web Crypto API en cada request a rutas protegidas. Rutas públicas: `/login` y `/api/health`. Sin cookie válida → redirect a `/login?next=...`.

**Por qué shared password y no Supabase Auth:** el CP hoy tiene 1-2 personas con acceso (tú y eventualmente un colaborador). Supabase Auth requiere proyecto Supabase del CP funcionando con tabla de admin_users + invites + email delivery, etc. — overhead injustificado para 2 personas. La tabla `control_plane.admin_users` queda preparada para Sprint 18+ cuando migremos a auth completo (un email = un row, login real con magic link).

*Cliente Supabase del CP:*

Helper `cpClient()` en `apps/control-plane/src/lib/cp-client.ts` que retorna `createServiceRoleClient().schema('control_plane')`. Toda query del CP pasa por ahí — evita repetir `.schema('control_plane')` en cada call y garantiza que el caller siempre use service_role.

**Alternativas consideradas:**

*Proyecto Supabase nuevo desde día 1 (Escenario 1):* $25/mes adicionales sin clientes reales en producción. Premature optimization. Adoptar cuando los triggers se cumplan.

*Tablas con prefijo `cp_*` en `public`:* Funciona pero leak de schema vía PostgREST OpenAPI (los clientes admin pueden ver que existen `cp_tenants`). Schema separado es más limpio.

*Auth con HTTP Basic:* Browser muestra prompt nativo, sin UX propia. No permite logout limpio. Cookie firmada + form propio es el patrón estándar.

*Magic-link sobre Supabase Auth con allow-list de emails:* Requiere proyecto Supabase del CP funcionando, mucho más infra para 2 usuarios. Migrable después.

*Sin auth en V1 (binding solo a localhost o VPN interna):* Funciona si el CP solo corre en máquinas de desarrollo. No es portable a un deploy en VPS — basta una mala regla de firewall y queda expuesto.

**Riesgos / Limitaciones:**

- *Modelo de seguridad RLS-only (no defense-in-depth de schema):* la versión inicial de la migration revocaba USAGE del schema `control_plane` para anon/authenticated, pensando en defense-in-depth. **Esto rompe el cliente Supabase** porque PostgREST devuelve `PGRST106 / Invalid schema` si el schema no está en `pgrst.db_schemas` y los roles no tienen USAGE. Corregido al cerrar Sprint 17: GRANT USAGE/ALL a anon/authenticated/service_role + `ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, control_plane'` + `NOTIFY pgrst, 'reload config'`. La protección de DATOS sigue intacta gracias a RLS sin policies (anon/authenticated obtienen 0 filas en SELECT, fallan en INSERT/UPDATE/DELETE). El leak menor que aceptamos: anon/authenticated pueden DESCUBRIR los nombres de tablas/columnas vía PostgREST OpenAPI (`GET /rest/v1/`). Para esconder también la metadata, migrar las queries a SECURITY DEFINER RPCs en `public.cp_*`. V1 acepta el leak de metadata por simplicidad; mitigación en Sprint 18+ si se firma un cliente con requirements de compliance estrictos.
- *Shared password sin revocación granular:* si un staff se va, hay que rotar la password Y `CP_COOKIE_SECRET` (invalida todas las sesiones existentes). Aceptable con 1-2 personas, ingestionable a 5+. Por eso Sprint 18+ migra a Supabase Auth.
- *Co-localización con tenant primario:* el CP corre con `service_role` del proyecto del tenant. Si ese tenant tiene un incidente y restaura backup de hace 3 horas, el CP rebobina también. Mitigación: snapshots de `control_plane.*` separados antes de restores.
- *Sin RLS por admin_user para `audit_log`:* hoy todo staff con la password ve toda la auditoría. Aceptable con `admin` y `support` siendo solo VerdFrut interno; cuando agreguemos roles más finos en Sprint 18 (ej. partners externos), separar la lectura del `audit_log`.
- *No hay RLS de tenant_id en cliente Supabase del CP:* los queries del CP listan TODOS los tenants. Correcto por diseño (es la vista global), pero si en el futuro queremos delegar parte del CP a un partner que solo vea SU subset, hay que añadir lógica de permisos en TS.
- *Cookie HMAC sin rotación de keys:* `CP_COOKIE_SECRET` no rota automáticamente. Para alta seguridad, agregar rotación con kid (key id) en el token.

**Oportunidades de mejora:**

- Sprint 18: KPIs agregados cross-tenant + endpoint `/api/sync/[slug]` que pulla datos del tenant via Management API.
- Sprint 19: Onboarding wizard que replica `provision-tenant.sh` en TS (Management API calls, polling de status, migration apply, registro en `control_plane.tenants`).
- Sprint 20+: billing manual (timeline de pagos, generación de facturas).
- Migrar a Supabase Auth (proyecto separado del CP) cuando crezcamos a 5+ personas con acceso.
- Migrar a Escenario 3 cuando se cumpla cualquiera de los 3 triggers documentados arriba.
- `proxy.ts` en lugar de `middleware.ts` — Next 16 deprecó middleware (warning en build). Migración trivial cuando estabilicen el API.

---

## [2026-05-07] ADR-031: Deploy a producción — Vercel + Railway, 6 bugs encontrados, UX cambios

**Contexto:** Demo hoy + field test mañana. Hasta esta sesión todo vivía en `localhost`. Necesidad: levantar las 4 piezas (3 apps Next + optimizer FastAPI/VROOM) en infra de producción reproducible y con auto-deploy desde GitHub. Sin tiempo para custom domain — `*.vercel.app` y `*.up.railway.app` para V1.

**Decisión:**

*Stack de deploy:*
- **Vercel Hobby** (free) para las 3 apps Next.js: platform, driver, control-plane.
- **Railway Hobby** (~$5-8/mes con uso) para el optimizer FastAPI + VROOM.
- **Supabase** (paid existente) para BD + Auth + Storage + Realtime.
- **GitHub** como Single Source of Truth con auto-deploy a Vercel + Railway en cada push a `main`.

*Por qué Vercel + Railway en lugar de VPS único:*
- Vercel Hobby = $0 los 3 Next + setup en minutos vs días de Caddy/Traefik.
- Vercel automática gestiona HTTPS, CDN, Edge runtime, preview deployments.
- Railway maneja Docker + healthchecks + redeploys en push sin tocar nada.
- Total V1: $5-8/mes vs VPS $4-6/mes — diferencia mínima a cambio de cero mantenimiento.
- Migración a VPS posible cuando crezca la operación, NO se pierde código.

*3 nuevos proyectos Vercel (Opción A) en lugar de reusar `verdfrut`/`choferes`/`control` viejos:*
- Los 3 viejos tenían código distinto, branches mezcladas, env vars stale. Riesgo de configs zombie en field test = inaceptable.
- Decidimos crear `verdfrut-platform`, `verdfrut-driver`, `verdfrut-control-plane` desde cero. Los viejos quedan archivables.

*Railway en lugar de Render para el optimizer:*
- Render Starter = $7 fijo. Railway Hobby = pay-as-you-go (~$5-8 por carga V1).
- Railway no se duerme; Render free se duerme tras 15 min (1er request post-sleep tarda 30s).
- Both auto-deploy desde GitHub. Decisión por costo + latency consistency.

*6 bugs encontrados durante deploy (todos resueltos en commits):*

1. `vercel.json` con `installCommand: "echo skip"` rompía detección de Next.js. Fix: install command corre `pnpm install --frozen-lockfile` desde la raíz. Commit `4e65dac`.

2. Dockerfile del optimizer en exec-form (`CMD ["uvicorn", ..., "--port", "8000"]`) no expandía `$PORT` que Railway inyecta dinámicamente → healthcheck failure. Fix: shell-form `CMD sh -c "uvicorn ... --port ${PORT:-8000}"`. Commit `d2d9f86`.

3. PostgREST devolvía `Invalid schema control_plane` porque `pgrst.db_schemas` no incluía el nuevo schema. Fix: `ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, control_plane'` + `NOTIFY pgrst, 'reload config'`. Migration 001 del control plane actualizada para que un proyecto Supabase nuevo reciba la config.

4. `get_dashboard_overview` plpgsql: ambiguous column reference (`total_distance_meters` chocaba con OUT param). Fix: cualificar con `rs.`/`sx.`/`dr.` en cada subquery. Documentado en ADR-028 como post-mortem.

5. Mi guía DEPLOYMENT.md decía explícitamente que el driver NO necesitaba `MAPBOX_DIRECTIONS_TOKEN` — error mío. Sin él, el endpoint `/api/route/dynamic-polyline` retorna `geometry: null`, el cliente vuelve a pedir → loop infinito "Recalculando ruta". Fix: doc + agregar token al Vercel driver. Commit `aa30b16`.

6. Off-route detection con threshold 50m + 3 updates consecutivos era demasiado agresiva con accuracy GPS típica de 20-40m → flap continuo del flag offRoute disparaba recalcs incluso cuando no había desviación real, multiplicando la causa raíz #5. Fix: threshold 50m→100m, consecutive 3→5, cooldown 30s entre recalcs por offRoute. Commit `26311b8`.

*UX cambios introducidos durante demo prep:*

- **Sidebar reordenado** (commit `5434cb5`): "Rutas" antes que "Tiros" — flujo correcto es crear rutas y agruparlas opcionalmente, no al revés. User feedback: "Está al revés lo de tiros". Empty state de `/dispatches` reescrito para clarificar que tiros son herramienta de agrupación opcional.

- **Maps + Waze deeplinks** (commit `9d4ce75`): V1 prefiere reusar la infra de navegación de Maps/Waze (más pulida que la nuestra) en lugar de forzar el turn-by-turn in-app. Mantenemos in-app como respaldo desde "🧭 Iniciar navegación" para auditoría/visibilidad.

- **"Reportar problema"** accesible desde 2 lugares (commit `9d4ce75`): stop-header (mientras está en una parada) Y `/route` lista (para averías ENTRE paradas). Resuelve user feedback: "las camionetas se quedan paradas, llantas, etc".

- **Botón "Llamar tienda" REMOVIDO** (commit `dc166c6`): user clarificó que choferes NO deben poder marcar a gerentes de tienda — genera fricción operativa. Toda comunicación pasa por chat con zone_manager.

- **`DEMO_MODE_BYPASS_GEO` env var** (commit `9dda9fd`): bypass server-only de validación geo en `arriveAtStop` para demos en oficina sin movimiento físico. ⚠ DEBE quitarse antes de field test real (anti-fraude reactivado). Documentado prominentemente en `PRE_FIELD_TEST_CHECKLIST.md`.

**Alternativas consideradas:**

*Custom domain hoy en lugar de `*.vercel.app`:* Suma 30 min de DNS + cert. Para mañana en campo no aporta. Lo dejamos para Sprint 19+.

*Vercel Pro para los 3 Next:* $20/mes/team. No justificable hasta tener concurrencia real (10+ usuarios). Hobby es OK con tier limits actuales.

*Render para el optimizer:* free tier duerme; Starter $7 fijo. Railway Hobby es comparable ($5-8 con uso real V1) y nunca duerme. Diferencia mínima.

*Reusar proyectos Vercel viejos (`verdfrut`/`choferes`/`control`):* descartado — riesgo de configs zombie. Los nuevos son "limpios desde cero".

**Riesgos / Limitaciones:**

- *GPS broadcast NO funciona cuando chofer está en Waze/Maps* (PWA backgrounded). Aceptable para V1 porque el reporte de arrival es action-based (toca "Llegué") no GPS-polling. El supervisor pierde visibilidad del chofer DURANTE el transit pero no del arrival. Solución completa = native (Expo) — Sprint 20+ si se vuelve crítico operativo. Documentado.
- *Si `DEMO_MODE_BYPASS_GEO` queda activo en producción real, anti-fraude está desactivado*. Mitigación: PRE_FIELD_TEST_CHECKLIST.md tiene el item #2 como crítico + el código loguea console.warn cada vez que el bypass se usa.
- *Vercel Hobby tiene límites* (1000 invocations/día por function, 100GB/mes bandwidth). Para 1-3 choferes V1 sobra. Si el cliente firma con flota grande, migrar a Pro.
- *Railway Hobby* depende de uso real — un mes con muchas optimizaciones puede subir a $10-15. Watching.
- *6 bugs encontrados en deploy* sugieren que la guía de deployment necesitaba más testing antes. Mejora futura: armar un staging environment para validar antes de producción.

**Oportunidades de mejora:**

- Custom domains (`platform.verdfrut.com`, `driver.verdfrut.com`, `cp.verdfrut.com`) — Sprint 19.
- Sentry / LogTail para error monitoring en producción.
- Lighthouse audit del driver PWA — bundle size, time-to-interactive, performance score.
- Migración a Vercel Pro si el cliente firma + escala.
- Migración a VPS único cuando el costo Vercel+Railway supere $30/mes (cuando crezca a 5+ clientes).
- Chat AI mediator (Sprint 18) para filtrar reportes triviales de choferes ("hay tráfico", "manifestación", "ya voy") antes de molestar al zone_manager.
- Feature de "transferir paradas a otro chofer" cuando hay avería de camión (Sprint 18).

---

## [2026-05-08] ADR-032: Sprint 18 — Admin como centro + GPS confiable + AI mediator

**Contexto:** Cliente clarificó que GPS en tiempo real es crítico **solo cuando hay anomalías** (chofer silencioso, atraso, problema reportado), no como tracking continuo. Y que el zone_manager NO debe ver mapa/dashboard — solo recibir push del chofer y responder por chat. El admin es quien centraliza todo: ve mapa+chat juntos, recibe notificaciones de cualquier reporte nuevo. Implicación: NO migrar a Expo nativa todavía. Las mejoras de Sprint 18 cubren el caso real con la PWA actual.

**Decisión:** 9 sub-sprints implementados consecutivamente.

*S18.1 — Re-modelo de roles (commit `8ca0722`):*
zone_manager pierde acceso a /map, /dashboard, /incidents (lista), /drivers, /routes detalle. Su única ruta es `/incidents/active-chat` que redirige al primer chat abierto. Si no tiene chats, muestra estado vacío explicativo. Defense in depth: sidebar filtra por rol + páginas usan `requireRole('admin', 'dispatcher')` + RLS sigue intacto. Nuevo helper `requireAdminOrDispatcher` en auth.ts. `homeForRole` redirige zone_manager a su chat activo.

*S18.2 — Panel dual mapa+chat en `/incidents/[reportId]` (commit `4b6b10d`):*
Layout grid 2 columnas (lg ≥ 1024px): mapa LIVE izquierda + chat derecha. Mobile stack vertical. Reusa `LiveRouteMapLoader` (ya implementaba subscribe a `gps:{routeId}` + carga breadcrumbs históricos para trail completo — resuelve issue #32 al pasar). Server-side carga route + stops + stores + vehicle + depot + driver para alimentar el mapa. Si falta data, fallback con placeholder.

*S18.3 — 4 modalidades de notificación al admin (commits `27354c0`, `cfd67b5`):*
1. **Badge realtime en sidebar** "Incidencias" — count de chats abiertos (delivery_reports.chat_status='open'), inicial server-side + actualizaciones via Supabase Realtime channel.
2. **Toast in-app** — hook `useIncidentNotifications` mounted en (app)/layout.tsx. Suscribe a INSERT messages WHERE sender='driver' y UPDATE delivery_reports WHERE chat_status TRANSITIONS to 'open'. Toast con CTA "Ver" → /incidents/[reportId].
3. **Sonido al recibir** — Web Audio API genera beep de 2 tonos (880Hz → 1320Hz, 200ms). Sin asset binario. Toggle 🔊/🔇 en topbar persistido en localStorage.
4. **Push notification del browser** — Service Worker minimal `/sw-push.js` (sin Serwist, solo handler push), `apps/platform/src/lib/push-subscription.ts` (paralelo al driver), endpoint `/api/push/subscribe` (POST/DELETE). Banner `<PushOptIn>` en /dashboard que se auto-oculta tras suscribir. Push fanout extendido (driver `push-fanout.ts`) para incluir admin/dispatcher en addition al zone_manager.

Toast extendido en `@tripdrive/ui` con `ToastOptions { action?: { label, onClick } }` backwards-compatible.

*S18.4 — GPS gap detection / Waze handling (commit `a9e6727`, migración 023):*
Cuando chofer abre Waze/Maps, la PWA pasa a background y `watchPosition` muere (especialmente iOS). Antes: el admin veía al chofer "congelado". Ahora: el cliente reporta `gap_start` (visibilitychange→hidden) con last_known_lat/lng, y `gap_end` (visibilitychange→visible) con duración. Persiste en `route_gap_events`. RLS: driver inserta/update suyos, admin/dispatcher leen todos, zone_manager lee de SU zona.

*S18.5 — Detección de anomalías para admin (commit `57f962b`, migración 024):*
SQL function `get_active_anomalies(zone_id_filter)` UNION ALL de 3 tipos:
- **silent_driver:** ruta IN_PROGRESS sin breadcrumb >5 min (severity 'high' si >15 min)
- **route_delayed:** ruta con `estimated_end_at` >15 min ago sin completar
- **chat_open_long:** chat_status='open' >20 min sin resolver

Página `/incidents/anomalies` (admin/dispatcher only) con cards agrupadas por tipo, CTA contextual (silent → /map, delayed → /routes/[id], chat → /incidents/[reportId]). Sidebar nuevo item "🔴 Anomalías".

*S18.6 — Replay recorrido + audit + TTL breadcrumbs (commit `4ebc105`, migración 025):*
Tres mejoras complementarias:
- **`archive_old_breadcrumbs(retention_days)`** función SQL + cron `/api/cron/archive-breadcrumbs` (mensual). Resuelve issue #33 (tabla crecía sin tope).
- **`routes.actual_distance_meters`** columna nueva. Trigger BEFORE UPDATE on routes que calcula al transitar a COMPLETED usando `calc_route_actual_distance(route_id)` (haversine SQL puro sumando breadcrumbs ordenados).
- **Trail histórico ya estaba** vía `LiveRouteMapLoader` desde S18.2 — issue #32 resuelto sin trabajo extra.

*S18.7 — Transferir paradas a otro chofer cuando avería (commit `80bf91a`, migración 026):*
ALTER TYPE route_status ADD VALUE 'INTERRUPTED'. Tabla `route_transfers` para audit. Server action `transferRouteRemainderAction(sourceRouteId, targetVehicleId, targetDriverId, reason, inheritDispatch)`:
1. Valida ruta origen PUBLISHED/IN_PROGRESS con stops pending.
2. Crea ruta nueva PUBLISHED con vehículo + chofer destino.
3. Mueve stops pending y RE-NUMERA sequence 1..N en la nueva.
4. Marca origen como INTERRUPTED + `actual_end_at`.
5. Insert audit en route_transfers.
6. Best-effort rollback (delete ruta nueva) si falla mid-way.

UI cliente `TransferRouteButton` + Modal con select vehículo (req) + chofer (opt) + razón preset + detalle. Banner amarillo "¿El camión no puede continuar?" en /routes/[id] solo cuando aplica.

Tipos cascada: `RouteStatus` en `@tripdrive/types` + `route_status` enum en database.ts + 4 Records<RouteStatus, ...> en platform/driver para evitar exhaustiveness errors.

*S18.8 — Chat AI mediator con Claude Haiku (commit `1dbcf7a`, migración 027):*
`packages/ai/src/classify-driver-message.ts` — `classifyDriverMessage(text)` clasifica en 'trivial' | 'real_problem' | 'unknown'. System prompt define las 3 categorías + 2 few-shot examples (tráfico → trivial, llanta ponchada → real_problem). Si trivial, devuelve `autoReply` empático en español MX (max 200 chars, sin mencionar "AI"). Failsafe: API key missing o request falla → 'unknown' (sesgo a la seguridad).

Integrado en `apps/driver/.../chat/actions.ts > sendDriverMessage`:
- Tras insert del mensaje del chofer (siempre), `mediateChatMessage()` en background (no bloquea respuesta).
- Si trivial: service-role insert auto-reply como `sender='system'`, NO push fanout.
- Si real_problem o unknown: push fanout normal (ya extendido en S18.3 a admin/dispatcher).
- Solo aplica a mensajes con texto. Imágenes-solo escalan siempre (vision = costoso/lento).
- Audit en `chat_ai_decisions` con category, autoReply, confidence, rationale, auto_reply_message_id.

Calibración futura: `SELECT category, COUNT(*) FROM chat_ai_decisions GROUP BY category` quincenal. Si % unknown > 20% → ajustar prompt.

*S18.9 — Cleanup técnico:*
Removido `DEMO_MODE_BYPASS_GEO` permanente del código de `arriveAtStop`. Era un riesgo latente: env var olvidada en producción = anti-fraude desactivado. Si se necesita demo en oficina otra vez, reintroducir en rama dedicada y revertir antes de mergear. Comentario histórico en el código documenta la decisión.

**Alternativas consideradas:**

*Migrar a Expo (React Native) ahora:* descartado. Tomaría 3-4 semanas y resolvería un caso (GPS continuo) que el cliente NO requiere. Las mejoras del PWA cubren el caso real (anomalies-driven supervision). Migración a Expo queda como Fase 7 condicional (ver ROADMAP.md).

*Detección de anomalías con cron periódico (escribiendo a tabla):* Más eficiente para muchos clientes pero overkill para V1. Polling cada 60s desde el cliente es simple y suficiente. Mejora futura cuando el dataset crezca.

*Toast/sonido/push del browser fueron 4 features distintas — alguna era redundante?* No: cubren casos distintos:
- Badge: count visible siempre, sin distraer.
- Toast: el admin está mirando otro tab del platform — alerta in-app sin notification permission.
- Sonido: el admin está distraído en otra app, el sonido lo avisa.
- Push browser: el admin tiene el platform en otra tab/cerrado — el sistema operativo se lo dice.

*AI mediator con Claude Sonnet vs Haiku:* Haiku porque la tarea es clasificación binaria con few-shots, no requiere razonamiento profundo. ~10x más barato y ~3x más rápido.

*Integrar AI mediator en server vs cliente:* server. El API key NO debe llegar al cliente y la lógica de `chat_ai_decisions` audit requiere service_role.

**Riesgos / Limitaciones:**

- *AI mediator clasifica trivialmente erróneamente* → reporte real queda sin escalar. Mitigación: 'unknown' siempre escala (sesgo a seguridad), confidence guardado, audit revisable. Calibrar prompt quincenalmente.
- *route_transfers sin verificación de capacity del vehículo destino*: si chofer transfiere 6 stops pero el camión destino solo tiene capacity para 3, sigue creando la ruta. Validación futura cuando aparezca el caso. Por ahora warning en UI dejado al admin.
- *Polling de anomalías cada 60s* desde cliente puede ser pesado si hay 100+ admins concurrentes. V1 con 1-3 admins no es problema. Sprint 19 puede agregar realtime channel para alerts.
- *visibilitychange en iOS Safari* puede no dispararse en algunos edge cases (page suspended antes de fire). Mitigación: el cron `mark_timed_out_chats` ya cierra chats huérfanos; si gap_event queda sin `ended_at` indefinidamente, el admin lo ve como gap activo eterno. Sprint 19 puede agregar cron que cierre gaps con timeout >2h.
- *`chat_ai_decisions` puede crecer mucho* (1 row por mensaje del chofer). Sprint 20+ agregar TTL similar al de breadcrumbs (90 días).
- *Sound toggle en topbar es global* (no per-page). Si admin silencia, no recibe sonido en ninguna parte de la app. Decisión pragmática.

**Oportunidades de mejora:**

- AI mediator: agregar contexto de la ruta (ETA, paradas pendientes, hora del día) al prompt para mejor clasificación contextual.
- Anomalías: convertir polling a realtime channel (push de nuevas anomalías).
- Push notifications: agrupar (no spam si llegan 10 mensajes seguidos).
- route_transfers: validación de capacity y depot compatibility.
- Feature flag system para experimentos (variant del AI prompt, etc).
- Migrar `chat_ai_decisions` audit a un dashboard `/incidents/ai-audit` (admin only).
- Sprint 20+ revisitar la migración a Expo si los gaps de GPS se vuelven crítico operativo.

---

## Plantilla para nuevas decisiones

```markdown
## [YYYY-MM-DD] ADR-NNN: Título corto

**Contexto:** Qué problema o necesidad triggereó esta decisión.

**Decisión:** Qué se eligió.

**Alternativas consideradas:**
- *Opción A:* por qué no.
- *Opción B:* por qué no.

**Riesgos / Limitaciones:** Qué puede fallar, qué hay que vigilar, mitigaciones.

**Oportunidades de mejora:** Qué podría ser mejor más adelante.
```


## [2026-05-08] ADR-033: Consolidación a 1 zona efectiva (CDMX) por modelo "1 CEDIS sirve N regiones"

**Contexto:** Al cargar 30 tiendas reales del cliente (15 CDMX + 15 Toluca) descubrimos que el modelo `route.zone_id` exige que vehicle/depot/stores sean todos de la misma zona (regla "una corrida = una zona" del optimizer V1). Pero la operación real del cliente es **1 solo CEDIS (CEDA, CDMX) que abastece tiendas en múltiples regiones geográficas** (CDMX y Edo. de México / Toluca). Si dejábamos 2 zonas separadas, el UI bloqueaba: seleccionar zona Toluca no dejaba escoger CEDIS ni vehículos (todos están en CDMX); seleccionar CDMX no dejaba escoger tiendas Toluca.

**Decisión:** Consolidar todo bajo zona CDMX. Mover las 15 tiendas Toluca → zone_id CDMX. Borrar zona Toluca (no representa una operación separada hoy). La trazabilidad de "región operativa" se preserva via `code='TOL-*'` y la dirección de cada tienda. Yucatán queda pendiente de decisión del usuario (no aplica a CEDA, candidata a borrarse en el futuro). Se agrega backlog issue para columna `region` en `stores` cuando crezca volumen.

**Alternativas consideradas:**
- *Agregar columna `region` a stores y filtrar por region en el UI (manteniendo zone_id global):* mejor a futuro pero requiere migración + UI changes + queries (~1 día). Aplazado a backlog.
- *Refactor profundo: route ya no es single-zone, validator se relaja:* riesgo alto, requiere repensar dispatches/cron/RLS. Aplazado a Sprint 20+.
- *Crear depot CEDA en zona Toluca también (duplicar):* hack feo, conflicting source of truth.
- *Dejar Toluca como zona separada y esperar a tener CEDIS Toluca:* bloquea el go-live del cliente hoy (no puede crear ruta a Toluca desde CEDA).

**Riesgos / Limitaciones:**
- *Pérdida de la separación visual "Toluca" en el UI:* mitigado parcialmente con prefijo `code='TOL-*'`. Reportes que agreguen por región tendrán que parsear el code o la dirección hasta que llegue columna `region`.
- *Cuando Toluca tenga su propio CEDIS:* habrá que dividir las tiendas entre 2 zones, recrear zone Toluca, re-link vehículos/depots. La columna `region` evitaría este re-trabajo.
- *Zona Yucatán queda como placeholder vacío en dropdowns:* hasta que el usuario confirme borrarla. Si se mantiene, dropdown muestra opción que no se usa.
- *Coordinadas Toluca son geocoded a nivel municipio (Nominatim):* margen 100m–2km. Para field test real, validar coords con cliente o tomar Google Maps por dirección exacta.

**Oportunidades de mejora:**
- Migrar a modelo `region` (issue #59 KNOWN_ISSUES) cuando cliente tenga 50+ tiendas o 2+ regiones operativas.
- Revisitar zone_id como filtro estricto: en V2 puede ser hint UX (sugerencia inicial) pero no bloqueante.
- Si Yucatán se borra, considerar agregar feature flag para que zonas se ENABLED/DISABLED sin DELETE (preservar audit).

## [2026-05-08] ADR-034: Fix bug `route.distance=0` en optimizer + UI métricas más explícitas

**Contexto:** Tras crear la primera ruta real (15 tiendas CDMX, 09-may), el campo "Distancia total" en `/routes/[id]` mostraba "—" y el dispatcher se confundía con dos números de tiempo (Duración estimada 3h 26m vs Inicio→Fin 6h 33m). Diagnóstico:
1. `total_distance_meters=0` en BD porque `services/optimizer/main.py` lee `route.get("distance",0)` pero VROOM no llena ese campo cuando los `vehicles` no declaran `profile`. Sin profile, VROOM cae al primero por default y solo emite duraciones — la matriz de distancias queda ignorada.
2. La etiqueta "Duración estimada" sugería el total del turno, pero solo era el tiempo de manejo. La diferencia (~3h) era servicio en paradas (15 stops × 15 min default), invisible en UI.

**Decisión:**
- **Fix 1 (optimizer):** agregar `"profile": "car"` a cada vehicle en `build_vroom_input` cuando hay matrix. Match con `matrices.car.distances`.
- **Fix 2 (defensivo):** `_backfill_distances_from_matrix` que suma `req.matrix.distances[from_idx][to_idx]` por cada par consecutivo de steps si VROOM aún devuelve `distance=0`. Cubre futuras versiones del binario o el caso multi-profile.
- **Fix 3 (UI métricas):** renombrar y desglosar:
  - "Distancia total" muestra "0 km · re-optimizar" (no oculto cuando es 0)
  - "Tiempo de manejo" (era "Duración estimada") = solo viaje
  - "Tiempo en paradas" = `count(stops) × avg(service_time_seconds)` — nuevo
  - "Total turno" = `end-start` — nuevo
  - "Inicio del turno" / "Fin del turno" (eran "Inicio/Fin estimado")
- **Cambio operativo:** UPDATE `stores.service_time_seconds = 1800` (30 min) y DEFAULT de la columna a 1800 — el cliente reportó que las descargas en tienda toman 30 min, no 15.

**Alternativas consideradas:**
- *Solo aplicar Fix 1 (profile=car) sin backfill defensivo:* descartado. Si una versión futura de VROOM cambia el output o hay múltiples profiles, volveríamos al bug. El backfill cuesta O(n) por route y blinda.
- *Calcular distancia client-side desde Mapbox Directions (no de la matriz):* descartado por costo (extra API call) y porque la matriz ya tiene el dato — solo falta sumarlo bien.
- *Eliminar `total_distance_meters` y dejar la métrica solo en la UI calculada al vuelo:* descartado, perderíamos la columna útil para reports/dashboard que ya la consumen.
- *Dejar el bug y solo mejorar el UI label:* descartado, el dispatcher quiere ese dato (planeación de combustible, contrato con el chofer).

**Riesgos / Limitaciones:**
- El fix Python NO se materializa hasta que Railway redeploy. Las rutas creadas hoy tienen `distance=0` permanente (a menos que se re-optimicen). Documentado en post-deploy checklist.
- `_backfill_distances_from_matrix` asume que `req.matrix.distances` está densely populated y consistente con los `location_index` que VROOM emite. Si VROOM omite `location_index` en algún step (caso edge), salta el step en la suma — la distancia resultante será underestimate. Improbable con VROOM 1.13 pero vigilar.
- La métrica "Tiempo en paradas" suma `service_time_seconds` de tiendas SIN considerar si la stop está completed/skipped. Para una ruta IN_PROGRESS, ese número incluye paradas que ya pasaron — sigue siendo info útil (planeación), pero podría confundir como "lo que falta".

**Oportunidades de mejora:**
- Mostrar también "Tiempo en paradas restante" (excluye completed/skipped) cuando la ruta está IN_PROGRESS.
- Agregar "Distancia recorrida" (actual_distance_meters, ya existe) cuando IN_PROGRESS / COMPLETED.
- Si VROOM retorna geometría real al cliente (futuro), calcular distancia exacta de tramo recorrido.
- Per-tienda override de `service_time_seconds` cuando una tienda específica toma más/menos (ej. tienda con muelle de carga vs tienda sin acceso).

---

## [2026-05-08] ADR-035: Reorden de paradas post-publicación (admin y chofer)

**Contexto:** El cliente reportó dos casos operativos críticos no cubiertos:
1. **Admin reorder post-aprobación:** una vez optimizada y aprobada, llega info nueva (cambio de planes en una tienda, info de tráfico, prioridad comercial) y el dispatcher necesita reordenar paradas pendientes. Antes de S18, al hacer click en "Aprobar" + "Publicar" la ruta quedaba congelada — el flujo era "cancelar y crear de nuevo", muy invasivo.
2. **Chofer reorder en campo:** el chofer conoce el terreno (calles cerradas, horarios reales de tienda, accesos) mejor que el optimizer. El cliente lo describió como "punto importante": el chofer debería poder cambiar el orden de paradas pendientes cuando vea una mejor ruta, sin esperar autorización.

**Decisión:**
- **Admin (PUBLISHED/IN_PROGRESS):** extender `reorderStopsAction` para aceptar estos status, pero SOLO permitiendo mover paradas `pending`. Las completadas/en sitio/omitidas quedan fijas en su sequence original (son hechos consumados). Cada reorden post-publish:
  - Bumpa `routes.version` (vía helper `incrementRouteVersion`).
  - Inserta row en `route_versions` con razón "Admin reorder en PUBLISHED" / "IN_PROGRESS".
  - Dispara push al chofer con `notifyDriverOfRouteChange("Las paradas pendientes fueron reordenadas")`.
  - El componente UI (`SortableStops` con prop `postPublish`) bloquea drag de stops no-pending y cambia el banner ("Se notificará al chofer").
- **Chofer (driver app):** nuevo server action `reorderStopsByDriverAction` + componente `ReorderableStopsList`:
  - UX: botón "Cambiar orden" entra en modo edición con flechas ↑↓ (no drag & drop — mejor en touch).
  - Solo paradas pending son movibles.
  - Al guardar: UPDATE stops con sesión del chofer (RLS `stops_update` lo permite); bump version + audit con service_role (porque `routes_update` es solo admin).
  - Razón en audit: "Chofer reordenó paradas pendientes" — trazable a quien hizo el cambio.

**Alternativas consideradas:**
- *Reorden libre incluso de stops completed/arrived:* descartado. Romper la cronología histórica (sequence vs actual_arrival_at) inutiliza cualquier reporte ex-post.
- *Workflow de aprobación: chofer propone, admin aprueba antes de aplicar:* descartado por friction. El cliente quiere el cambio inmediato; el audit captura quién/cuándo/por qué.
- *Chofer drag & drop con dnd-kit (mismo que admin):* descartado. En touch + scroll de móvil, los gestos chocan; flechas son explícitas.
- *No bumpar version en reorden (solo audit):* descartado. La versión es la fuente de verdad para "el chofer está viendo la versión correcta" si en el futuro agregamos reconciliación cliente↔servidor.

**Riesgos / Limitaciones:**
- *Concurrencia:* si admin y chofer reordenan al mismo tiempo, gana el último write. No hay locking ni optimistic concurrency. Probabilidad baja; mitigación futura: agregar version check en el UPDATE de stops.
- *Push al chofer en admin reorder:* si el chofer no aceptó push notifications, no se entera hasta que abra la PWA. La UI driver hace `revalidatePath('/route')` server-side, así que un refresh pasivo (chofer hace pull-to-refresh, navega) ya muestra el nuevo orden.
- *Audit de chofer usa service_role:* el `created_by` en `route_versions` queda como el `auth.uid()` del chofer (correcto), pero la escritura efectiva la hace service_role bypass. Si en el futuro queremos RLS estricta en `route_versions`, hay que abrir policy de INSERT para drivers (con check `created_by = auth.uid()` y route ownership).
- *Driver action NO notifica al admin:* si el chofer reordena, el admin lo ve solo cuando refresca `/routes/[id]`. Issue #61 abierto.
- *Validación de orden razonable:* aceptamos cualquier orden que envíe el chofer (no validamos contra geo). Un chofer malicioso podría ordenar algo absurdo (ej. zigzag) — el audit captura el evento pero no lo bloquea. Trade-off: confianza en el chofer vs costo de validación geo (qué es "razonable" depende de calles/tráfico que el optimizer no siempre captura).

**Oportunidades de mejora:**
- Notificar admin por push cuando chofer reordene (issue #61).
- En el UI admin, mostrar historial de versiones (route_versions) con razón + autor para auditar cambios.
- Optimistic locking: el client envía la `version` que vio; el server rechaza si difiere.
- Visual diff: mostrar al chofer en mapa el orden original vs nuevo antes de confirmar.
- Telemetría: cuántas veces el chofer reordena vs cumple el orden original — feedback para calibrar el optimizer.

## [2026-05-08] ADR-036: Hot fixes post-deploy S19 — cancel del modal + agregar paradas + popups mapa

**Contexto:** Tras deploy de S19 fixes, el cliente probó crear ruta real con 15 tiendas y reportó 3 problemas bloqueantes:

1. **Bug del cancel:** modal "El optimizador no asignó X tiendas" salía DESPUÉS de crear las rutas. Cancelar solo bloqueaba navegación — las rutas quedaban en BD. El user creía cancelar pero las rutas seguían ahí.
2. **Sin agregar paradas:** una vez creada una ruta, no había forma de agregar las tiendas que el optimizer no asignó. El dispatcher quedaba atorado.
3. **Popups del mapa con contraste roto:** en dark mode, el texto del popup Mapbox (que tiene fondo blanco hardcoded por la lib) heredaba un gris claro del body en vez de un texto oscuro legible.

**Decisión:**

1. **Bug cancel:** cuando el user cancela el modal, ahora **cancelamos** las rutas creadas vía `cancelRouteAction` (Promise.allSettled, manejo gracioso de fallos). Texto del modal actualizado para reflejar la realidad: "Aceptar = mantener / Cancelar = BORRAR las rutas creadas".
2. **Agregar paradas:** nuevos helpers `appendStopToRoute` + `deleteStopFromRoute` en queries/stops. Server actions `addStopToRouteAction` + `deleteStopFromRouteAction`. UI: nuevo `<AddStopButton>` en route detail (solo DRAFT/OPTIMIZED/APPROVED). Carga las tiendas activas de la zona, filtra las que ya están en la ruta, dropdown nativo `<select>`. La parada se inserta al final con `sequence = max+1`, status pending, sin ETA — se recalcula al re-optimizar (o el chofer la atiende cuando llegue).
3. **Popups mapa:** agregar `color:#0f172a` (slate-900) explícito al `<div>` interno de cada popup en route-map.tsx, multi-route-map.tsx y live-route-map.tsx. El fondo del popup Mapbox es siempre blanco; con color de texto oscuro hardcoded queda legible en cualquier theme.

**Alternativas consideradas:**
- *Para #1, hacer "preview" antes de crear (refactor mayor):* descartado por scope. La opción cancel-y-borrar es funcionalmente equivalente desde la perspectiva del user, con costo de un round-trip extra. Issue #68 abierto para refactor proper.
- *Para #2, permitir agregar en PUBLISHED+:* descartado. Agregar parada a ruta en curso requiere reoptimizar ETAs y notificar al chofer (mucho más complejo). Issue #66 abierto.
- *Para #3, estilizar `.mapboxgl-popup-content` global:* funciona pero es CSS global y rompe encapsulación. El inline style es más explícito y no afecta otros usos del popup (si en futuro queremos popup oscuro en algún lado).

**Riesgos / Limitaciones:**
- *Cancel borra todas las rutas creadas:* si el user creó 3 rutas (3 vehículos) y solo 1 tenía unassigned >20%, las 3 se borran al cancelar. El user puede preferir borrar solo las problemáticas. Aceptable hoy (1 vehículo único en producción).
- *Add stop sin re-optimizar:* la ruta queda con stops que no tienen ETA, lo cual confunde el dashboard. Mitigación: toast sugiere "Re-optimiza para recalcular ETAs".
- *Add stop carga TODAS las tiendas de la zona:* si la zona tiene 200 tiendas, el `<select>` es lento de scroll. Issue #67 (paginación / búsqueda) abierto.
- *Popups con color hardcoded `#0f172a`:* si en futuro el cliente pide tema custom (ej. blanco sobre verde oscuro), el popup mantiene texto slate-900 (sigue siendo legible sobre fondo blanco de Mapbox). No bloquea pero no es theme-aware. Acceptable trade-off.

**Oportunidades de mejora:**
- Refactor a "preview-then-create" (issue #68): el flujo correcto es correr el optimizer en modo dryRun, mostrar el modal con el resultado, y solo crear si user confirma. Evita writes innecesarios.
- Búsqueda por code/nombre en `<AddStopButton>` cuando hay >50 tiendas (issue #67).
- Permitir agregar/borrar paradas en PUBLISHED+ con notificación al chofer (issue #66).
- Botón "Borrar parada" en cada SortableRow para complementar appendStop (ya existe el server action, falta UI).
- Audit completo de contraste light/dark con axe-core o playwright (sprint 19).

## [2026-05-08] ADR-037: Paleta canónica `vf-*` light/dark + aliases semánticos

**Contexto:** El cliente reportó que algunos botones se veían en light pero no en dark mode (y viceversa). Audit reveló dos problemas:

1. **Tokens dark divergentes:** los valores de `--vf-bg/elev/sub/line/text*` en dark mode estaban un poco más oscuros (lightness 0.155) que la paleta operacional moderna que el cliente proporcionó (0.18). El delta era pequeño pero suficiente para que algunos textos `--vf-text-mute` quedaran muy bajos en contraste.
2. **Variables fantasma:** componentes usaban `var(--vf-warn-bg,#fef3c7)` con fallback hex amber. Esa variable NUNCA estaba definida en `tokens.css` — solo el equivalente `--color-warning-bg`. Resultado: el fallback hex se usaba SIEMPRE, sin importar el tema → cuadros amarillos brillantes en dark mode.
3. **`bg-white/95` literal:** el overlay de status del live-route-map (cuadrito "● En vivo") era blanco fijo por Tailwind, ilegible en dark mode (cuadro brillante con texto verde claro).

**Decisión:**
1. Reemplazar valores dark de `--vf-bg/sub/elev/side/line*/text*` con la paleta canónica del cliente (oklch 0.18 / 0.20 / 0.22 / 0.14 / 0.28 / 0.96 etc.). Light queda igual (ya estaba alineado).
2. Brand greens y accents son **compartidos en ambos temas** — quitamos el override de `--vf-green-700/500` que tenía dark mode. Si en un futuro el primary se ve apagado, agregar lift selectivo (issue #69 si pasa).
3. Definir aliases `--vf-warn-bg/fg/border`, `--vf-ok-*`, `--vf-crit-*`, `--vf-info-*` con `color-mix(in oklch, ... transparent)` para que ambas convenciones (`--color-*` y `--vf-*`) funcionen y respondan al tema.
4. Reemplazar `bg-white/95` en live-route-map.tsx por `var(--vf-bg-elev) + border + text-token`.

**Alternativas consideradas:**
- *Migrar todos los `--vf-*` a `--color-*` (Tailwind theme):* deja un solo namespace, más limpio. Descartado por scope — son ~300 ocurrencias en componentes; risk:reward bajo. Mejor mantener ambos como aliases.
- *Override de `--vf-green-700` en dark:* el HTML standalone original lo tenía. Quitamos para alinear con la paleta del cliente que dice "Brand compartido". Aceptable trade-off; revisar si hay falta de contraste.
- *Estilizar `.mapboxgl-popup-content` global vs inline `color:#0f172a`:* mantenemos inline en componentes de mapa para no afectar otros usos de Mapbox.

**Riesgos / Limitaciones:**
- *Color-mix no funciona en navegadores muy viejos* (<2024). Vercel hosting no es problema; user en Safari iOS 14- podría ver fallback.
- *`--vf-warn-fg` es valor fijo `oklch(0.40 0.13 80)`* — ámbar oscuro. Sobre `--vf-warn-bg` claro (light), legible. Sobre `--vf-warn-bg` mezclado con dark base (dark theme), también legible porque el color-mix preserva el hue. Si reportan baja legibilidad, agregar override en `[data-theme=dark]` que use ámbar más brillante.
- *Greens compartidos en dark:* `--vf-green-700` (lightness 0.42) sobre `--vf-bg` 0.18 da un contrast ratio ~5:1. AA pero no AAA. Si reportan, lift a 0.55 en dark.

**Oportunidades de mejora:**
- Agregar test visual con axe-core en CI: cada componente render en light + dark, fallar si contrast <4.5:1.
- Storybook con toggle light/dark para revisar componente por componente.
- Migrar live-map-client.tsx markers (hex hardcoded `#94a3b8`, `#22c55e`, etc.) a `--vf-text-mute`/`--vf-ok`/`--vf-crit` con valores theme-aware (issue #70).
- Crear utility class `.vf-card` que aplique bg-elev + border + text en un solo set, para evitar repetir el patrón en cada uso.

## [2026-05-08] ADR-038: Re-optimize preserva paradas que el optimizer rechaza + UI delete por parada

**Contexto:** Tras desplegar ADR-036 (agregar paradas manualmente), el cliente reportó que al "Re-optimizar" la ruta, las paradas que había agregado a mano **desaparecían**. Diagnóstico: `reoptimizeRouteAction` lee todas las stops actuales como `storeIds`, las pasa al optimizer, y luego `deleteStopsForRoute` + `createStops` SOLO inserta las que el optimizer asignó. Si el optimizer rechaza una parada (por estar lejos del depot, fuera de la ventana del shift, etc. — la misma razón por la que el dispatcher la agregó manualmente), se pierde silenciosamente. El user vio "10 stops siguen, mi 11 se fue".

Adicional: una vez creada una ruta, el dispatcher no podía borrar paradas individuales. El server action `deleteStopFromRouteAction` ya existía (S19 ADR-036) pero faltaba UI.

Adicional: el constraint UNIQUE `idx_routes_vehicle_date_active` (vehicle_id, date) bloqueaba crear nuevas rutas el mismo día con la misma camioneta — durante demo el user quedó atorado con 2 rutas activas y no podía crear otras para probar variantes.

**Decisión:**

1. **Preservar unassigned en re-optimize:** después de insertar las stops asignadas con ETA, agregar las stops que el optimizer rechazó como `pending` SIN `planned_arrival_at` ni `planned_departure_at`, secuenciadas al final (sequence = N+1, N+2…). El chofer las atiende cuando llegue; el dispatcher las puede mover a otra ruta o borrarlas con el botón nuevo. Mejor diseño: respeta la intención explícita del dispatcher.

2. **Botón delete por parada:** nuevo `<button aria-label="Borrar parada">×</button>` en `<SortableRow>` solo visible para paradas pending pre-publicación (DRAFT/OPTIMIZED/APPROVED, status='pending'). Confirm + llama `deleteStopFromRouteAction` que ya re-numera las restantes. Stop propagation a dnd-kit para que el click no dispare drag.

3. **SQL de demo cleanup** (operacional, no código): cuando hay rutas activas atoradas, `UPDATE routes SET status='CANCELLED' WHERE id IN (...)`. El index UNIQUE solo cuenta rutas activas (no CANCELLED/COMPLETED), así que cancelar libera el slot.

**Alternativas consideradas:**
- *Para #1, forzar al optimizer a asignar todas (priority alta):* descartado. VROOM con priority alta puede romper time_window — la parada se asigna pero el shift_end queda violado, ETAs incorrectos. Mejor preservarlas sin ETA.
- *Para #1, dejar que el dispatcher decida cada vez con un modal:* descartado por friction. La intención de "re-optimizar" es "haz lo posible", no "vuélveme a preguntar".
- *Para #2, delete con drag-out (gesture):* descartado por descubribilidad. Botón explícito × es estándar.
- *Para #3, eliminar el constraint UNIQUE:* nunca. Es protección operativa contra doble asignación. Solo cancelar las viejas.

**Riesgos / Limitaciones:**
- *Stops sin ETA contaminan métricas:* "Tiempo en paradas" suma `service_time_seconds` × count(stops); incluye las sin ETA. Resultado optimista pero no incorrecto (el chofer SÍ va a tardar 30 min en cada una). El UI muestra "sin ETA" abajo del badge para que el dispatcher sepa cuáles son.
- *Re-optimize sucesivos pueden acumular stops sin ETA:* si un dispatcher agrega A, re-optimiza (A queda sin ETA), agrega B, re-optimiza (B queda sin ETA), termina con varias stops huérfanas. Aceptable — el dispatcher decide cuándo borrar.
- *Botón delete sin permission check client-side:* la action server-side valida `requireRole('admin','dispatcher')` y status='pending' del stop; UI solo decide visibilidad. Atacante podría llamar la action con un stopId arbitrario, pero RLS de stops filtra por route ownership y el server valida permisos.

**Oportunidades de mejora:**
- Mover stops sin ETA al final de la lista visualmente (hoy quedan en su sequence numérico — pueden estar entre paradas con ETA si fueron agregadas antes de re-optimizar).
- Botón "mover a otra ruta del mismo tiro" en cada stop pending (issue: ya existe `moveStopToAnotherRoute`, falta UI en /routes/[id], hoy solo en /dispatches).
- Toast en re-optimize que diga "X paradas no asignadas, las dejé al final sin ETA" (en vez del modal del flujo de creación).
- Botón "Cancelar ruta" más visible en `/routes/[id]` para que el dispatcher pueda destrabarse sin SQL (verificar si ya existe vs route-actions.tsx).

## [2026-05-08] ADR-039: Popup enriquecido del marker + remoción del mapa global de /routes

**Contexto:** Tras el demo de la primera ruta, dos feedbacks del cliente sobre la UX de mapas:

1. **Popup pobre:** click en un marker mostraba solo `#sequence · code | name | status` (texto plano). El dispatcher quería más contexto operativo (dirección, ETA, link al detalle) para tomar decisiones desde el mapa sin tener que abrir la lista.
2. **Mapa redundante en `/routes`:** la página listaba todas las rutas del tenant Y mostraba un mapa colectivo arriba. El cliente lo describió: "el mapa allí no tiene sentido — la idea es entrar a la ruta para verla". El dispatcher prefiere lista limpia + entrar al detalle de una ruta para ver mapa.

**Decisión:**

1. **Popup enriquecido** (3 archivos: `route-map.tsx`, `multi-route-map.tsx`, `live-route-map.tsx` queda para sprint siguiente):
   - Layout: `[ruta · vehículo]` (solo en multi) → `#sequence · code` (bold) → `name` → `address` (si hay) → row con `[badge status]` + `ETA HH:MM` (verde) o `sin ETA` (gris) → `[Ver ruta →]` CTA si tenemos `routeId`.
   - Tipos `RouteMapStop` y `MultiRouteEntry.stops[]` extendidos con `address?` y `plannedArrivalAt?` opcionales.
   - Server pages (`/routes/[id]/page.tsx`, `multi-route-map-server.tsx`) pasan los nuevos campos.
   - HTML del popup mantiene colores hardcoded (`#0f172a`, `#15803d`) porque Mapbox popup body es siempre blanco — no respeta theme tokens.
2. **Mapa removido de `/routes`:**
   - `<MultiRouteMapServer>` y su import borrados de `apps/platform/src/app/(app)/routes/page.tsx`.
   - `/routes` ahora muestra solo: filtros + tabla de rutas + paginación.
   - Dispatcher entra a `/routes/[id]` para ver el mapa de UNA ruta. El "vista del día completa" puede ir a `/map` (live tracking) o `/dispatches/[id]` si se quiere agrupado por tiro.

**Alternativas consideradas:**
- *Mapa colapsable en `/routes` (botón "Mostrar mapa"):* descartado. El cliente fue claro: el mapa allí no aporta. Mejor remoción limpia que añadir interruptores que distraen.
- *Popup minimalista con solo CTA "Ver detalle":* descartado. ETA y dirección son la info que el dispatcher consulta más frecuentemente — debe estar inline.
- *Popup como React component (no HTML string):* deseable pero Mapbox popup vive fuera del React tree. Habría que portear con `ReactDOM.createPortal` y manejar lifecycle. Trade-off: más complejo pero theme-aware. Aplazado a backlog (issue #71).

**Riesgos / Limitaciones:**
- *Popup con CTA "Ver ruta" abre en misma pestaña:* si el dispatcher tenía paneles abiertos, los pierde. Mitigación: agregar `target="_blank"` en una iteración futura.
- *Address en popup puede ser muy largo:* las direcciones reales de NETO miden 80-120 chars. El `max-width:280px` con `line-height:1.3` lo acomoda en 2-3 líneas. Visualmente OK.
- *Mapa removido de `/routes` puede confundir a usuarios que estaban acostumbrados:* riesgo bajo (cliente nuevo, no había costumbre instalada).
- *`live-route-map.tsx` (incidents) NO se actualizó* — sigue con popup viejo. El caso de uso es distinto (live tracking de chofer, otros datos). Lo dejamos para issue #72.

**Oportunidades de mejora:**
- Issue #71: portear popups a React components con createPortal — theme-aware + más maintainable.
- Issue #72: enriquecer popup de `live-route-map.tsx` con la misma lógica.
- Click en stop de la lista debería resaltar el marker en el mapa (cross-sync). Hoy no hay sync entre lista y mapa en `/routes/[id]`.
- Hover en marker abre popup automático (hoy hay que clickear) — UX más fluida.

## [2026-05-08] ADR-040: Toda ruta debe pertenecer a un tiro (`dispatch_id NOT NULL`)

**Contexto:** El cliente reportó fricción crítica del flujo: *"crear una por una es tardado y molesto, mejor siempre tiros aunque sea de una sola ruta… ya intenté usar tiros y no vi el caso si ya tengo rutas, lo veo como hasta trabajar doble"*. El modelo permitía rutas sueltas (`dispatch_id` nullable), lo que obligaba al dispatcher a:
1. Crear ruta sin tiro
2. Decidir después si crear un tiro
3. Asociar la ruta al tiro (paso extra)
O al revés: crear tiro vacío → crear ruta apuntando al tiro. Doble paso siempre.

**Decisión:** Migración 028 + cambio arquitectónico. Toda ruta vive dentro de un tiro:

1. **Migración SQL `028_dispatch_required.sql`:**
   - Backfill: para cada combo `(date, zone_id)` con rutas huérfanas, crear UN tiro nuevo "Tiro DD/MM (auto)" y re-asociar todas las rutas. Rutas del mismo día/zona quedan en el mismo tiro (más natural que un tiro por ruta).
   - `ALTER TABLE routes ALTER COLUMN dispatch_id SET NOT NULL` — constraint a nivel DB.
   - Cambiar FK `routes_dispatch_id_fkey` de `ON DELETE SET NULL` a `ON DELETE RESTRICT` — no se puede borrar un tiro con rutas vivas. Defensivo contra borrado accidental.
   - Migración idempotente con `DO $$` blocks que checan estado actual antes de aplicar.

2. **`createAndOptimizeRoute` auto-crea dispatch:**
   - Si `input.dispatchId` viene → validar (date, zone_id) coinciden con tiro existente, error si no.
   - Si no viene → crear tiro nuevo `name="Tiro DD/MM"`, `notes="Auto-creado al crear ${routeName}"`, `created_by=admin actual`.
   - Si UNIQUE collision (`23505`, ya hay un "Tiro DD/MM" del mismo día/zona) → reusar el existente.
   - Las rutas se crean con `dispatch_id = resolvedDispatchId` directamente (no más `assignRouteToDispatchAction` post-creación).

3. **UI `/routes/new`:**
   - Banner arriba del form que dice qué tiro se va a usar:
     - Verde si vino de `?dispatchId=...` — muestra `nombre + fecha`.
     - Gris si auto-creará — muestra el nombre que generará y enlace a `/dispatches`.
   - Form ya pasa `dispatchId` (existente) o `null` (auto) al action.
   - Eliminado el `assignRouteToDispatchAction` redundante post-creación.

**Alternativas consideradas:**
- *Opción A: solo auto-crear dispatch (sin NOT NULL):* descartada. Queda la posibilidad de bug donde código futuro inserte ruta huérfana. NOT NULL en DB es la garantía.
- *Opción B: `/routes` agrupa visualmente por tiro:* aplazado a sprint siguiente. Hoy queda como tabla plana — funciona, no es bloqueante.
- *Backfill 1 dispatch por ruta huérfana:* descartado. Genera dispatches "vacíos" con 1 ruta cada uno — no representa la realidad operativa donde 1 tiro = N rutas relacionadas.
- *FK `ON DELETE CASCADE`:* descartado. Borrar dispatch por error eliminaría rutas históricas. RESTRICT es más seguro; el dispatcher tiene que cancelar/borrar rutas primero (acción explícita).
- *Eliminar la idea de "rutas sueltas" sin migración (solo con código):* descartado. Sin constraint DB, código futuro o inserts manuales pueden seguir creando rutas sin dispatch.

**Riesgos / Limitaciones:**
- *Auto-dispatch huérfano si el optimizer falla:* `createAndOptimizeRoute` crea el dispatch ANTES de llamar al optimizer. Si el optimizer falla, el dispatch queda creado sin rutas. Hoy los dispatches vacíos aparecen en `/dispatches` igual — el user puede borrarlos manualmente. Issue #73 abierto: hacer la creación atómica con rollback explícito del dispatch en el catch.
- *FK RESTRICT bloquea workflow de "borrar tiro y todo lo de adentro":* si el dispatcher quiere eliminar un experimento del día, debe cancelar/borrar las rutas primero. Aceptable; previene pérdida de datos accidental. Si genera fricción, agregar UI "Cancelar tiro y todas sus rutas" que haga el cleanup explícito.
- *Backfill agrupa por (date, zone) — pero no por tipo de operación:* si un tenant futuro tenía 2 lógicas operativas distintas el mismo día/zona (ej. Toluca-mañana y CDMX-tarde), las rutas quedan en el mismo tiro. Aceptable para caso CEDA actual (1 sola operación). Si crece, dispatcher mueve rutas con `moveStopToAnotherRouteAction` o crea tiros nuevos.
- *Conflict UNIQUE en auto-dispatch:* asumimos que `(date, zone_id, name)` permite múltiples tiros con mismo nombre. Si en el futuro se agrega UNIQUE, el reuse path lo cubre.
- *Migración aplicada DIRECTAMENTE en prod via MCP (no via `supabase db push`):* el archivo local existe para reproducibilidad, pero la BD prod ya está cambiada. Para tenants nuevos: el archivo se aplica al hacer `supabase reset`. Verificar en cada nuevo tenant.

**Oportunidades de mejora:**
- Issue #73: rollback del auto-dispatch si el optimizer falla (atomicidad).
- Issue #74: `/routes` agrupar visualmente por tiro (lista expandible) — completa la UX de "tiros siempre".
- Issue #75: UI "Cancelar tiro completo" que cancele todas las rutas + dispatch en una operación.
- Issue #76: índice UNIQUE `(date, zone_id, lower(name))` en dispatches para evitar duplicados manuales del mismo nombre el mismo día/zona.
- Issue #77: backfill futuro si llegan tenants con datos legacy — mismo patrón pero con mejor heurística (agrupación por created_at, vehicle_id, etc.).

## [2026-05-08] ADR-041: APK demo via TWA (Bubblewrap) — sin reescritura del PWA

**Contexto:** El cliente pidió "que sea APK bien la del chofer" para probar en campo cómo se comporta vs PWA en navegador. Sprint 18 ya descartó migrar a Expo (rewrite de 2-3 semanas). Necesitamos una APK que envuelva la PWA actual sin tocar código de driver app.

**Decisión:** Generar APK como **Trusted Web Activity (TWA)** usando `@bubblewrap/core` programáticamente. La APK es un shell Android que carga `https://verdfrut-driver.vercel.app` en pantalla completa (sin barra de Chrome cuando `assetlinks.json` valida el dominio).

**Stack:**
- Bubblewrap CLI inicialmente — descartado porque init es interactivo y no se puede pipear `yes` (se rompe en prompt de packageId).
- Bubblewrap Core programmatic — TwaGenerator + TwaManifest leídos desde `twa-manifest.json` pre-generado (sin prompts).
- JDK 17 (Temurin) descargado en `~/.bubblewrap/jdk/` por Bubblewrap.
- Android SDK descargado en `~/.bubblewrap/android_sdk/`. Build-tools 35 + platform 36 requirieron `sdkmanager --licenses` con `yes |` para aceptar EULA.
- Firmado: `apksigner` directo del SDK (no Bubblewrap ApkSigner — su API en CJS no expone constructor en ESM).

**Decisiones del cliente:**
- Package ID: `com.verdfrut.driver`.
- Domain: `verdfrut-driver.vercel.app` (sin custom domain por ahora).
- Distribución: solo sideload (no Play Store) — esta APK es para demo de campo.
- Cuando llegue producción: regenerar con custom domain (`app.verdfrut.com` o equivalente) + keystore "release" + subir a Play Store.

**Archivos del proyecto** (`mobile/driver-apk/`):
- `twa-manifest.json` — config TWA (packageId, host, theme colors, signing key path).
- `scripts/init-twa.mjs` — Node script que invoca `TwaGenerator.createTwaProject()` sin prompts.
- `scripts/build-apk.mjs` — Node script que compila Gradle + invoca `apksigner` para firmar.
- `.keystore/verdfrut-driver-demo.jks` — keystore RSA 2048, validez 10000 días, demo (passwords débiles intencionales).
- `.keystore/PASSWORDS.txt` — credenciales + SHA-256.
- `apps/driver/public/.well-known/assetlinks.json` — reclama el dominio para la APK firmada con SHA-256 demo.
- `README.md` — guía de regeneración + sideload + troubleshooting.

**Alternativas consideradas:**
- *Expo / React Native rewrite:* descartado en S18. Demasiado trabajo para una demo de campo.
- *Capacitor (Ionic):* viable pero más setup que TWA. TWA es lo más cerca a "PWA pero APK".
- *PWABuilder.com (online):* genera APK desde URL del PWA. Bueno como alternativa pero menos control sobre el keystore (sin Play Signing requiere upload del jks online).
- *Bubblewrap CLI interactivo:* falla con `yes |` en prompt de packageId. Pasar por @bubblewrap/core programmatically es más confiable y reproducible.

**Riesgos / Limitaciones:**
- *Si `assetlinks.json` no responde 200 con el SHA-256 correcto, la APK abre la PWA en "Custom Tab" (con barra de URL Chrome) en vez de modo trusted full-screen.* No es bloqueante operativamente — la app funciona — pero se ve menos nativa. Verificar con `curl -I https://verdfrut-driver.vercel.app/.well-known/assetlinks.json` después de cada deploy.
- *La APK requiere que el chofer tenga Chrome instalado* (o WebView). Android moderno lo trae por default.
- *Cambios al PWA NO requieren regenerar APK.* La APK carga el sitio en vivo. Solo se regenera APK si cambia: manifest, dominio, keystore, o se bumpa versión Android.
- *Keystore demo con passwords débiles* (`VerdFrutDemo2026`). NO commitear (.gitignore lo bloquea), pero hay que rotar antes de prod.
- *Sin Play Store:* sideload requiere que el chofer active "instalar apps de fuentes desconocidas" en su Android. Algunos dispositivos corporativos lo tienen bloqueado por MDM.
- *Bubblewrap usa minSdkVersion=21* (Android 5.0 Lollipop) — cubre 99%+ del parque actual. Si un chofer tiene un teléfono <2014, no instalará.

**Oportunidades de mejora:**
- Ejecutar Lighthouse PWA audit antes de generar APK release (issue #78).
- Para Play Store: agregar feature graphic 1024x500 + screenshots de la PWA en mobile (Playwright).
- Alinear el `theme_color` de manifest.json con el primary del sistema de tokens (hoy `#16a34a`, debería derivarse de `--vf-green-700`).
- Generar splash screen optimizado por tamaños de pantalla (Bubblewrap genera básicos automáticamente).
- Configurar Play Integrity API (anti-tampering) cuando vayamos a Play Store.
- Sentry SDK Android para errors crash en la APK (independiente del Sentry web).

## [2026-05-08] ADR-042: Refinar coords de tiendas con Google Geocoding API + columna `coord_verified`

**Contexto:** El cliente compartió un screenshot de Google Maps con una ruta de Toluca y reportó que las ubicaciones que tenemos en BD están "muy mal" — confirmando la nota del ADR-033 que advertía sobre coords aproximadas. Diagnóstico:

| Origen | Tiendas | Calidad |
|--------|---------|---------|
| `xlsx EXPANSION` (CDMX-*) | 15 | ✅ lat/lng exactas (vinieron en el archivo) |
| `xlsx TOLUCA` (TOL-*) | 15 | ⚠️ Geocoded a Nominatim por código postal/municipio (margen 100m–2km) |

Mapbox geocoder funciona bien por dirección pero su POI registry no incluye marca "Tiendas Neto" — confirmado, no nos sirve para refinar. Google Maps Geocoding usa el mismo dataset que el screenshot que mandó el cliente.

**Decisión:**
1. **Migración 029** — agregar columna `stores.coord_verified BOOLEAN NOT NULL DEFAULT false`. Backfill: marcar `CDMX-*` como verified=true (vienen del xlsx oficial). Las `TOL-*` quedan como false (Nominatim aproximado).
2. **Script `scripts/geocode-stores.mjs`** — refina coords usando Google Geocoding API:
   - Lee env vars de `apps/platform/.env.local` o shell.
   - Default: dry-run (imprime delta entre coord actual vs Google).
   - `--apply` → UPDATE en BD + marca `coord_verified=true`.
   - `--code=TOL-XXXX` → solo una tienda.
   - `--filter=ALL` → re-geocodifica todas (incluyendo verified).
   - Sin dependencias externas (fetch directo a Supabase REST + Google API).
   - Salvaguarda: tiendas con delta >5km se SKIP automáticamente al `--apply` para evitar moverlas a otra ciudad por error de Google. El admin debe revisar la dirección y reintentar con `--code`.
3. **Filosofía:** toda tienda nueva nace con `coord_verified=false`. Para marcarla true: Google Geocoding (script), o validación manual del admin (futura UI), o import desde xlsx oficial del cliente.
4. **Costo Google:** $5 USD por 1000 reqs; 30 tiendas demo = $0.15 USD; queda holgado en el free tier de $200/mes de Google Cloud.

**Alternativas consideradas:**
- *Mapbox Geocoding API:* descartado. Mapbox no tiene POIs comerciales mexicanos al nivel de Google.
- *Cliente provee CSV con coords oficiales (NETO ERP):* mejor calidad pero bloqueado por proceso del cliente. Si llega, ese CSV se aplica directamente con el script (`--code` por cada uno).
- *Geocoding manual desde Google Maps UI:* viable para ≤20 tiendas pero no escala. Mejor automatizar.
- *PostGIS + reverse geocoding:* descartado, requiere cambio de schema (geography column) y no resuelve el problema (necesitamos forward geocoding).
- *Híbrido Mapbox primero + Google fallback:* 30 tiendas no justifican la complejidad. Si llegamos a 500+, sí evaluar.

**Riesgos / Limitaciones:**
- *Google Geocoding rooftop puede dar la entrada principal del local pero no el muelle de carga.* Margen residual ~50-100m. Para anti-fraude geo del chofer (validación arrived <300m de la tienda), suficiente.
- *Google API key expuesta a cualquier persona con acceso a `.env.local`/Vercel.* Mitigación: restringir la key a la IP del Vercel + Geocoding API only.
- *El script asume que la `address` en BD es razonable.* Si el cliente nos dio direcciones con errores tipográficos, Google puede devolver cualquier cosa. La columna `coord_verified=true` después del script NO garantiza coord correcta — solo que Google la convirtió. Validación visual sigue siendo recomendable.
- *Tiendas con delta >5km se skipean al --apply.* Si toda Toluca debe moverse drásticamente (caso límite), hay que correr `--code` una por una y revisar manualmente.
- *No hay re-geocoding automático en cron.* Si una tienda cambia de domicilio, el admin tiene que re-correr el script manualmente. Para tenant a escala se puede agregar trigger / cron.

**Oportunidades de mejora:**
- Issue #80: integrar geocoding en el flujo "crear tienda" del admin UI (cuando llegue esa página).
- Issue #81: warning en route detail si la ruta tiene tiendas con `coord_verified=false` ("ETAs poco confiables — verifica coords").
- Issue #82: si el cliente eventualmente da CSV oficial con coords NETO, importarlas y marcar `coord_verified=true` con `notes='from-NETO-erp'` para trazabilidad.
- Issue #83: agregar columna `stores.geocode_source TEXT` (`nominatim` / `google` / `client_xlsx` / `manual`) para auditoría.
- Issue #84: evaluar PostGIS + GIST index sobre `(lat, lng)` para queries espaciales (ej. "tiendas a <500m del chofer").

## [2026-05-09] ADR-043: Mejoras al detalle del tiro — reorder ↑↓ + fullscreen mapa + métricas detalladas

**Contexto:** Cliente probó el detalle del tiro (`/dispatches/[id]`) con 2 rutas Toluca y pidió 3 mejoras concretas:
1. Botones ↑↓ para reordenar paradas dentro de cada ruta (como en driver app), aparte del dropdown "Mover a → otra ruta" que ya existía.
2. Botón pantalla completa para el mapa, así puede inspeccionar geografía sin perder el detalle de la lista lateral.
3. Más métricas por ruta visible en cada card (kg, tiempo manejo, ETAs salida/regreso) — antes solo mostraba `N paradas · X km`.

**Decisión:**

1. **Reorder ↑↓ en `RouteStopsCard`:**
   - Cada parada del card tiene 2 botones (▲ ▼) a la izquierda del `#sequence`.
   - Reusa `reorderStopsAction` (ADR-035) que ya soporta pre-publish (todas movibles) + post-publish (solo paradas pending). El componente respeta la restricción.
   - Botón disabled cuando no se puede mover (1ra parada no puede subir, etc.).
   - Click swap con la parada adyacente del subset elegible + envía orden completo al server. router.refresh post-success.
   - Convive con el dropdown "Mover a →" que mueve entre rutas del MISMO tiro (sin cambios).

2. **Fullscreen del mapa en `MultiRouteMap`:**
   - Botón flotante esquina superior derecha del mapa: `⛶` para entrar, `✕` para salir.
   - Cuando active, el wrapper aplica `fixed inset-0 z-50` con padding y bg del tema.
   - `Esc` también sale.
   - `requestAnimationFrame(() => mapRef.current.resize())` después del toggle para que el canvas Mapbox se reajuste a las nuevas dimensiones.
   - La leyenda lateral también escala (240px en normal, 280px en fullscreen).

3. **Métricas detalladas por ruta:**
   - Header del card ahora muestra: `vehículo · N paradas · TOTAL_KG kg · X.X km · MM manejo` (línea 1).
   - Línea 2: `Sale HH:MM · Regresa HH:MM · N ✓ M omitidas` (cuando hay datos).
   - Cada parada del listado muestra ETA inline a la derecha: `06:30`.
   - Cálculos:
     - `totalKg = sum(stop.load[0])` (capacity dim 0 = peso).
     - `completedStops`/`skippedStops` = filtro por status.
     - Times formateados con `Intl.DateTimeFormat` en TZ del tenant (`America/Mexico_City`).

**Alternativas consideradas:**
- *Drag & drop con dnd-kit en lugar de ↑↓:* descartado. dnd-kit en cards angostas hace más mal que bien (gestos confusos, scroll choca con drag). Botones explícitos son más usables y consistentes con la driver app que ya usa el patrón.
- *Fullscreen modal con backdrop:* descartado por complejidad. `position:fixed inset-0` es trivial, no rompe SSR, y el `Esc` keyboard handler basta.
- *Métricas en un panel lateral aparte:* descartado. Densificar el header del card es lo que el dispatcher ya escanea — agregar un panel suma navegación.
- *Native Fullscreen API (`element.requestFullscreen()`):* descartado. Browsers requieren user gesture válido + comportamiento distinto en iOS Safari. CSS fixed es suficiente y más predecible.

**Riesgos / Limitaciones:**
- *Reorder hace 1 round-trip al server por cada swap.* Si el dispatcher hace 5 swaps seguidos = 5 calls. Aceptable para volúmenes esperados (<20 stops/ruta). Si en futuro 50+ stops, agregar debounce con un commit final.
- *Fullscreen no reposiciona la leyenda en mobile* (lg:grid-cols solo aplica >=1024px). En mobile el mapa ocupa todo y la leyenda se va abajo. Aceptable — el dispatcher usa desktop.
- *La ETA visible por parada es `planned_arrival_at`, calculada cuando se optimizó.* Si reordenas con ↑↓, el server no recalcula ETAs (solo cambia `sequence`). El dispatcher debe hacer "Re-optimizar" para actualizar ETAs. Issue conocido — el card YA dice "ETA inline" como referencia, no compromiso.
- *El swap en ↑↓ usa el subset elegible.* En post-publish, una parada pending no puede saltarse a una completed (la completed bloquea posiciones). Si todos los pending están al final (caso normal post-progress), solo se reordena entre ellas. Comportamiento correcto.
- *Orden visual de stops asume `sequence` consistente.* El server `bulkReorderStops` renumera atómicamente, pero si hay un crash a mitad puede quedar 1..N con un hueco. Defensivo: ordenamos en cliente por `sequence` antes de renderizar.

**Oportunidades de mejora:**
- Issue #85: cuando hay reorder en post-publish, mostrar warning "Las ETAs ya no son confiables — re-optimiza si quieres recalcularlas" (similar al banner de re-optimizar pre-publish).
- Issue #86: drag horizontal entre cards (drag stop de Kangoo 1 → Kangoo 2) reemplazaría el dropdown "Mover a →" con UX más fluida. Más trabajo, menor prioridad.
- Issue #87: indicador visual de la parada que está siendo movida (ej. fade out durante el round-trip).
- Issue #88: en fullscreen, agregar mini-tabla flotante con métricas globales del tiro arriba a la izquierda (km total, paradas total, kg total).
- Issue #89: keyboard shortcuts en fullscreen para reorder rápido (J/K para navegar, Shift+↑/↓ para mover).

## [2026-05-09] ADR-044: Auto-recalcular ETAs y métricas tras cualquier mutación de stops

**Contexto:** Cliente reportó: *"vi que si muevo de camioneta la parada no se recalcula la ruta solo cambia de color y de menu, hay que hacer que se recalcule la ruta cuando se cambia de camioneta o el orden de las paradas"*. Bug real: al mover stops o reordenarlas, el `sequence` cambia pero `planned_arrival_at`, `planned_departure_at`, `total_distance_meters`, `total_duration_seconds` y `estimated_end_at` quedan obsoletos. El UI mostraba ETAs viejas + km incorrectos hasta que el dispatcher hacía Re-optimizar manualmente.

**Decisión:** Helper server-side `recalculateRouteMetrics(routeId)` en `lib/queries/routes.ts` que se invoca automáticamente desde las 4 mutaciones de stops:

1. `bulkReorderStops(routeId, ids)` — reorder dentro de una ruta.
2. `appendStopToRoute(routeId, storeId)` — agregar parada nueva.
3. `deleteStopFromRoute(stopId)` — borrar parada (recalcula con la routeId del stop antes de borrar).
4. `moveStopToAnotherRoute(stopId, targetRouteId)` — recalcula AMBAS rutas (origen sin la parada, destino con la nueva).

**Algoritmo:**
- Lee stops ordenadas por `sequence` + tiendas (coords + service_time) + depot del vehículo.
- Cumulative haversine × 1.4 (factor detour urbano) / 25 km/h.
- Para cada stop: `arrival = cumulative + travel`, `departure = arrival + store.service_time_seconds`.
- Total: `cum_dist + closing_dist_to_depot`, `cum_drive_seconds + closing_drive`.
- `estimated_start_at` se preserva si ya tiene valor (mantiene la hora de salida que el optimizer V1 fijó); si NULL, default 06:00 local.

**Alternativas consideradas:**
- *Llamar al optimizer Railway en cada mutación:* descartado por costo y latencia. Cada move/reorder dispararía 1 call ($$ + ~3-5s de espera UX). El recalc local con haversine es <100ms.
- *Solo recalcular en commit explícito (botón "Guardar":* descartado. Friction extra; el dispatcher hace move + ya espera ver el resultado.
- *Recalcular ETAs preservando `actual_arrival_at` cuando existe:* implementado parcialmente — tocamos solo `planned_*`, los `actual_*` (timestamps reales del chofer) no se modifican.
- *Mantener orden manual + recalcular ETAs (sin re-VROOM):* este es el approach elegido. Respeta la decisión humana del dispatcher; ETAs son haversine pero suficientes para planeación. Para precisión real, "Re-optimizar" sigue disponible.

**Riesgos / Limitaciones:**
- *Distancia haversine ×1.4 vs ruta real Mapbox:* margen ~30% en zonas con carreteras complejas (Toluca con caminos sinuosos). Para ETAs operativas reales, "Re-optimizar" llama a VROOM con matriz Mapbox.
- *Los UPDATE por stop son secuenciales* (Supabase REST no permite bulk update por id). Para una ruta con 30 stops, recalc tarda ~600ms (30 round-trips). Aceptable para volúmenes esperados; si crece, agregar RPC Postgres o batch upsert.
- *Stops sin coords resolubles* (tienda eliminada) se saltan. El cumulative no se cierra correctamente — al menos no rompe la query, pero las métricas pueden quedar low. Caso edge.
- *Si el route's vehicle no tiene `depot_id` ni `depot_lat/lng`:* fallback usa la primera tienda como origen. Métricas resultantes son razonables pero el "cierre" es subóptimo.
- *Race condition:* si dos admins reordenan al mismo tiempo, recalc del segundo puede leer state intermedio del primero. Probabilidad baja en operación real (<2 admins concurrentes); mitigación futura: optimistic locking con `routes.version` (issue #62 ya documenta esto).
- *Time zone hardcoded a `America/Mexico_City` (UTC-6 sin DST).* Funciona para tenant CDMX. Cuando llegue tenant en otra TZ, refactor a usar Intl + tenant config (ya existe `NEXT_PUBLIC_TENANT_TIMEZONE` env var).

**Oportunidades de mejora:**
- Issue #90: bulk update via RPC Postgres → reduce 30 round-trips a 1.
- Issue #91: opcional `--use-mapbox-matrix` flag en recalc para usar matriz real (cuando Mapbox token está set), trade-off: latencia +500ms.
- Issue #92: invalidar cache del mapa client-side post-recalc para que el polyline se redibuje sin refresh manual.
- Issue #93: en post-publish (PUBLISHED/IN_PROGRESS), agregar push al chofer "ETAs actualizadas" cuando reorder cambia >15 min su próxima parada.
- Issue #94: surfacear delta en UI: "Re-optimizar te ahorraría 12 km / 23 min" — llamada lazy a VROOM solo cuando se hace click en el indicador.

## [2026-05-09] ADR-045: Drag-and-drop con dnd-kit + isolation del mapa Mapbox

**Contexto:** Cliente reportó dos problemas en `/dispatches/[id]`:
1. *"Si bajo el mapa los iconos se queda sobre el menú"* — al hacer scroll, los markers numerados de Mapbox flotan sobre las cards de las rutas (escapan el bounding box del mapa).
2. *"El de mover el orden de las paradas me gustaría se pueda agarrar y arrastrar a el número que quieres y no sea uno por 1 arriba o abajo"* — los botones ↑↓ de ADR-043 funcionan pero arrastrar 7 → 3 toma 4 clicks. Quería drag-and-drop al estilo "agarrar y soltar en la posición destino".

**Decisión:**

1. **Fix isolation del mapa** (3 archivos: `multi-route-map.tsx`, `route-map.tsx`, `live-route-map.tsx`):
   - Agregar `isolation: isolate` + `transform: translateZ(0)` al `<div>` con `ref={containerRef}`.
   - Crea un nuevo stacking context que CONTIENE los markers internos de Mapbox (que tienen `position: absolute` con z-index alto que escapaban del `overflow: hidden` del padre).
   - Es un fix de 1 línea por archivo, sin efectos secundarios visibles.

2. **Drag-and-drop con dnd-kit** en `RouteStopsCard`:
   - Reemplaza los botones ▲▼ (ADR-043) con `<DndContext> + <SortableContext>` (mismo patrón que ya usa `SortableStops` en `/routes/[id]`).
   - Drag handle visible: `⋮⋮` a la izquierda de cada parada (similar al admin reorder pre-publish).
   - `arrayMove(items, oldIdx, newIdx)` reordena local con desplazamiento automático: si arrastras la parada 7 a la posición 3, las que estaban en 3..6 se desplazan a 4..7. Es exactamente el comportamiento que pidió el cliente.
   - Optimistic UI: el orden cambia inmediato local, en paralelo se llama a `reorderStopsAction` para persistir; si falla, rollback al orden inicial.
   - Restricciones ADR-035 respetadas: en post-publish (PUBLISHED/IN_PROGRESS) solo paradas `pending` son arrastrables. Si intenta drag de no-pending → toast con explicación.
   - El `onPointerDown stopPropagation` en el `<select>` "Mover a →" evita que dnd-kit capture el click como intent de drag.
   - Server tras reorder llama a `recalculateRouteMetrics` (ADR-044) → ETAs y km se actualizan automáticamente.

**Alternativas consideradas:**
- *Solo agregar `overflow: clip` al wrapper del mapa* (más estricto que `hidden`):  no funcionó en testing — los markers de Mapbox usan portales internos que escapan igual. El truco GPU `translateZ(0)` es lo que crea el stacking context que contiene los markers.
- *Native HTML5 drag-and-drop:* descartado. La API es notoriamente quebradiza, sin soporte mobile nativo, y tendríamos que reimplementar accessibility. dnd-kit ya está en el proyecto y maneja todo eso.
- *Mantener ↑▼ + agregar drag:* descartado por ruido visual. Una sola interfaz de reorder es más clara.
- *react-beautiful-dnd:* descartado, el lib está deprecated y dnd-kit es el sucesor recomendado.

**Riesgos / Limitaciones:**
- *`isolation: isolate` no funciona en Safari <16.* Caída de safari ~14: los markers volverían a flotar. Iceberg muy chico (>96% del market support según caniuse). `translateZ(0)` es el fallback que cubre todos los browsers modernos.
- *Drag entre cards de distintas rutas no soportado.* dnd-kit lo permite con `DndContext` compartido, pero requiere refactor mayor (state lifting al parent dispatch page). Issue #95 abierto. Por ahora el dispatcher usa el dropdown "Mover a →" para drag inter-route.
- *Optimistic update de drag puede divergir del server* si la red falla a mitad. El rollback a `initialItems` tras error mantiene consistencia, pero el user pierde su trabajo. Mitigación: toast claro con error + el orden vuelve al previo. No persiste estado roto.
- *Sync upstream-down* (cuando router.refresh trae nuevas stops): la heurística "si IDs cambiaron, reset items" funciona pero podría sobrescribir un drag in-flight si el refresh llega justo en medio. Probabilidad muy baja; aceptable.
- *Touch devices:* dnd-kit `PointerSensor` con `activationConstraint: { distance: 5 }` previene drags accidentales en mobile, pero la experiencia mobile no es óptima (browser nativo scroll vs drag). Para iOS/Android específicamente, agregar `TouchSensor` con delay sería más fiable. No prioritario hoy (admin opera desktop).

**Oportunidades de mejora:**
- Issue #95: drag entre cards de rutas distintas (cross-route drag) reemplazaría el dropdown "Mover a →".
- Issue #96: animación suave del polyline en el mapa cuando reorder cambia el orden (hoy se redibuja "salto" tras router.refresh).
- Issue #97: keyboard shortcuts para reorder (Up/Down + Enter, Tab para target) — accessibility.
- Issue #98: undo/redo del último reorder (Ctrl+Z) — reusa el snapshot inicial.

## [2026-05-09] ADR-046: Enlace público read-only para tiros (`/share/dispatch/[token]`)

**Contexto:** Cliente quiere compartir la vista del tiro (mapa + lista de rutas con paradas) con su equipo SIN requerir login. Use case: el operador en campo o el dueño quieren echar un vistazo a "cómo va el día" sin tener que crear cuenta. Solo lectura — nadie debe poder mover paradas o crear rutas desde la URL pública.

**Decisión:**
1. **Migración 030:** columna `dispatches.public_share_token UUID NULL`. NULL = compartir deshabilitado. UUID = enlace activo. UNIQUE INDEX (parcial WHERE NOT NULL) para garantizar que cada token apunte a UN dispatch.
2. **Server actions:** `enableDispatchSharingAction(dispatchId)` genera token UUID y lo persiste; `disableDispatchSharingAction(dispatchId)` set NULL (revoca enlace).
3. **Query pública `getDispatchByPublicToken(token)`:** valida formato UUID + lookup con `service_role` para bypass RLS (el visitante anónimo no tiene sesión).
4. **Página `/share/dispatch/[token]/page.tsx`** fuera del grupo `(app)` → no aplica `requireRole`. Carga dispatch + rutas + stops + tiendas + vehicles + zona, usa `MultiRouteMapServer` + nuevo `PublicRouteCard` (versión read-only de `RouteStopsCard`).
5. **`PublicRouteCard`:** mismo header con métricas (km, manejo, ETAs, kg, badge status) + lista de paradas con sequence/code/name/ETA. SIN drag handle, SIN dropdown "Mover a →", SIN botones de acción.
6. **Botón "🔗 Compartir"** en `/dispatches/[id]` header (admin/dispatcher) abre modal:
   - Si no hay token: warning "cualquiera con el link puede ver" + botón "Generar".
   - Si ya hay token: input readonly con URL completa + botón "Copiar" (uses `navigator.clipboard`) + acciones secundarias "Regenerar link" y "Revocar enlace".
7. **Meta tags:** `robots: { index: false, follow: false }` para que Google NO indexe operación interna del cliente.

**Alternativas consideradas:**
- *Token con expiración (ej. 7 días):* descartado V1. Si el cliente operativo ve el día, no le sirve un link que expira solo. Issue futuro #99 para agregar expiración opcional.
- *Múltiples tokens por dispatch (uno por persona compartida):* descartado por complejidad. UN token por tiro es suficiente; rotar = nuevo token = invalida link viejo.
- *Tabla separada `dispatch_share_tokens`:* descartado. Una columna en dispatches es más simple y hoy no necesitamos histórico de tokens. Refactor a tabla cuando agreguemos audit/expiración.
- *Auth con magic link en vez de token UUID:* más seguro pero rompe el use case "WhatsApp el link al equipo". El cliente quiere compartir = visualmente acceder, no autenticar.
- *Shorter URL (slug en vez de UUID):* tentador para legibilidad pero baja la entropía y permite collisions. UUID es estándar y suficientemente "ocultable" en WhatsApp.

**Riesgos / Limitaciones:**
- *Si el link se filtra (alguien lo copia y publica),* cualquier persona ve operación del cliente — incluyendo nombres de tiendas, direcciones, ETAs. Mitigación: el admin puede revocar instantáneamente. NO incluimos info ultra-sensible en la vista (sin precios, sin contactos personales).
- *No hay rate limiting* en `/share/dispatch/[token]`. Un atacante con el token podría hacer scraping repetido. Aceptable para V1 — si el link ya está filtrado, scraping es secundario.
- *service_role en página pública es seguro PORQUE solo se usa para SELECT por token específico.* No expone nada al cliente (RSC); el HTML rendido sí muestra los datos pero eso es la intención.
- *Si rotan el token (regenerar link),* el link viejo deja de funcionar. Incluido como feature, NO bug. Documentado en el modal: "El link anterior dejará de funcionar al instante."
- *El mapa usa `MultiRouteMap` que llama `/api/routes/[id]/polyline` con `auth-required` middleware (si existiera).* Hoy no hay middleware → fetcheo del polyline funciona desde la página pública. Si se agrega middleware después, romper. Issue #100 abierto.
- *No hay logging/audit de quién accede al link público.* Imposible saber si el cliente lo abrió 1 vez o 1000. Aceptable; agregar `dispatch_share_access_log` table si crece.
- *El admin/dispatcher es quien genera el link* — un zone_manager (rol restringido) NO puede compartir. Defensa correcta hoy; revisitar si zone_managers necesitan compartir su zona.

**Oportunidades de mejora:**
- Issue #99: expiración opcional del token (`public_share_token_expires_at TIMESTAMPTZ NULL`).
- Issue #100: validar que `/api/routes/[id]/polyline` siga siendo accesible si se agrega middleware de auth (porque el mapa público lo usa).
- Issue #101: agregar audit `dispatch_share_access_log(token, accessed_at, ip, user_agent)` cuando llegue compliance.
- Issue #102: vista pública minimalista para mobile (sin sidebar leyenda, mapa fullscreen prioritario).
- Issue #103: meta `og:image` con preview del mapa para que el link pegado en WhatsApp/Slack muestre thumbnail.
- Issue #104: token rotación automática (cada N días) si se vuelve crítica la "frescura" del enlace.

## [2026-05-09] ADR-047: Override de depot al nivel ruta (`routes.depot_override_id`)

**Contexto:** El depot/CEDIS de salida vive en `vehicles` (depot_id, depot_lat/lng). Esto ata cada vehículo a un solo depot. Cuando el cliente plantea abrir múltiples CEDIS y rotar el origen por tiro/ruta (caso real: Estadio Nemesio Díez Toluca, 2026-05-09), las opciones eran (a) cambiar el depot del vehículo con efectos colaterales sobre otras rutas activas, (b) crear vehículos virtuales por depot (Kangoo CEDA + Kangoo Toluca para la misma camioneta física). Ambas malas — la primera rompe consistencia, la segunda ensucia inventario.

**Decisión:** Migración 031 agrega `routes.depot_override_id UUID NULL` (FK depots ON DELETE RESTRICT). Cuando NOT NULL, sobrescribe el depot del vehículo SOLO para esa ruta. Resolución: `route.depot_override_id > vehicle.depot_id > vehicle.depot_lat/lng`. UI: nuevo componente `DepotAssignment` inline en `/routes/[id]` (réplica del patrón `DriverAssignment`). Server action `assignDepotToRouteAction` setea/limpia el override y llama `recalculateRouteMetrics` para que km/ETAs reflejen el nuevo origen automáticamente. Optimizer Railway acepta `vehicleDepotOverridesById?: Map<vehicleId, {lat,lng}>` en el contexto, propagado por `reoptimizeRouteAction` para que el VROOM real use el override.

**Alternativas consideradas:**
- *Override al nivel dispatch (no route):* descartado porque cada ruta del tiro puede tener su propio depot — más granular, no menos.
- *Tabla pivot `depot_zones (depot_id, zone_id)`:* descartado por ahora. La columna `depots.zone_id` sigue siendo NOT NULL, pero el override en route ignora la zona del depot, así que ya hay flexibilidad cross-zone. Migrar a pivot si surge un caso donde un depot necesita pertenecer a varias zonas oficialmente (reportería).
- *Crear vehículos virtuales por depot:* descartado — ensucia inventario y rompe metricas por vehículo físico.
- *Mover `depot_id` de vehicle a stop:* overkill, granularidad innecesaria. El depot importa al inicio y final de la ruta, no por parada.

**Riesgos / Limitaciones:**
- *El override solo aplica a la ruta actual;* si el dispatcher re-optimiza sin querer, el override se preserva (la columna sigue seteada). Esto es intencional — pero requiere que el UI muestre claramente cuándo viene del override (sufijo "· override" en el badge).
- *Si un depot se borra mientras hay routes con override apuntando a él,* la FK ON DELETE RESTRICT bloquea el borrado. Correcto, pero el error que ve el admin en `/settings/depots` es genérico — issue #105 para mejorar el mensaje.
- *El driver app (mobile)* lee el campo via `apps/driver/src/lib/queries/route.ts` y `stop.ts`, pero NO lo usa para nada hoy (el mapa del chofer ya recibe el depot resuelto desde server). Si en el futuro el chofer necesita ver el origen del día, el dato está disponible.
- *El optimizer V1 valida "todos los vehículos misma zona".* El override de depot puede apuntar a un depot de otra zona — eso NO viola la restricción del optimizer (que es sobre vehicles, no depots), pero podría confundir al admin que ve la ruta con depot Toluca y zona CDMX. UI muestra ambos por separado.

**Oportunidades de mejora:**
- Issue #105: mensaje de error claro cuando se intenta borrar un depot con routes que lo referencian.
- Issue #106: tabla pivot `depot_zones` cuando el negocio formalice depots cross-zona.
- Issue #107: que el override se aplique al template del tiro (al re-crear rutas se preserva el preferred depot por chofer/zona).

## [2026-05-09] ADR-048: Agregar/quitar camionetas dentro del tiro con re-rutear automático

**Contexto:** El dispatcher trabajaba al nivel de ruta individual: para "ver cómo queda el tiro con 2 camionetas en lugar de 1" tenía que (a) cancelar la ruta de 1 camioneta, (b) crear un tiro nuevo, (c) seleccionar 2 camionetas, (d) volver a tipear todas las paradas. Caso real: cliente NETO pidió simulación CDMX con 1 vs 2 camionetas, 2026-05-09. UX: el botón principal del detalle del tiro decía "+ Crear ruta nueva" — ambiguo, no comunicaba el split óptimo.

**Decisión:** Reemplazar "+ Crear ruta nueva" por dos botones: **"+ Agregar camioneta"** (primario) y **"+ Ruta manual"** (ghost, para casos legacy). El primario abre modal con selector de vehículo + chofer y al confirmar:
1. Recolecta todas las paradas únicas de las rutas vivas (no CANCELLED) del tiro.
2. Cancela las rutas pre-publicación viejas (CANCELLED + drop stops).
3. Llama `createAndOptimizeRoute` con la lista combinada de vehículos (existentes + nueva camioneta) + las storeIds del tiro + el dispatchId.
4. VROOM redistribuye automáticamente — el dispatcher ve el split nuevo y compara métricas.

Espejo: en cada `RouteStopsCard` un botón sutil **"Quitar"** (`RemoveVehicleButton`) cancela esa ruta y redistribuye sus paradas entre las restantes via el mismo flow. Si era la única ruta del tiro, sólo cancela (sin redistribuir). Server actions: `addVehicleToDispatchAction`, `removeVehicleFromDispatchAction`. Helper interno `restructureDispatchInternal` orquesta el reuse de `createAndOptimizeRoute`.

**Restricciones:** SOLO opera si todas las rutas del tiro están en pre-publicación (DRAFT/OPTIMIZED/APPROVED). Si alguna está PUBLISHED+ aborta — re-distribuir rompería la confianza con choferes que ya recibieron push.

**Alternativas consideradas:**
- *Endpoint dedicado `restructureDispatchAction(dispatchId, vehicleAssignments[])`* expuesto al UI: descartado por ahora — más complejo de validar (lista atómica de cambios) sin beneficio claro. Las dos acciones (`add`, `remove`) cubren los casos reales 1-a-1.
- *Mantener "+ Crear ruta nueva" como único entry point:* descartado — el flow de "agregar camioneta y dejar que VROOM redistribuya" es lo que el dispatcher quiere 90% del tiempo. La creación manual queda accesible como ruta secundaria.
- *Soft-delete de rutas (mantener CANCELLED en el set de redistribución):* descartado, las rutas CANCELLED son histórico y no deben re-considerarse.

**Riesgos / Limitaciones:**
- *Si el optimizer falla a mitad de la redistribución,* `createAndOptimizeRoute` hace rollback de las rutas que alcanzó a crear pero NO re-crea las que cancelamos. El tiro puede quedar con menos rutas de las que tenía. Mitigación: el toast de error pide al dispatcher refrescar la página y volver a intentar; las storeIds están preservadas en código del action y se podrían re-armar manualmente. Para producción seria, mover el flow completo a una RPC Postgres con transacción real (issue #108).
- *La nueva camioneta debe estar en la misma zona del tiro.* Esto se valida client-side al filtrar `availableVehicles` y server-side en `createAndOptimizeRoute`. El error legible si pasa.
- *El depot override (ADR-047) NO se preserva* tras re-rutear — las rutas nuevas se crean con el depot del vehículo. Si el dispatcher tenía un override en una ruta, debe re-aplicarlo. Aceptable hoy; futura mejora: pasar overrides existentes al rebuild.
- *Si la redistribución produce más unassigned stops (capacidad insuficiente),* el resultado es válido pero el dispatcher recibe esos IDs de regreso — UI hoy no los expone visualmente al usuario en este flow (sí en el flow `/routes/new`). Issue #109.

**Oportunidades de mejora:**
- Issue #108: mover `restructureDispatchInternal` a una RPC Postgres con transacción atómica.
- Issue #109: surfacing de unassigned stops tras redistribuir (toast con lista o card "Sin asignar").
- Issue #110: preservar `depot_override_id` por chofer/vehicle al redistribuir.
- Issue #111: comparar métricas pre vs post redistribución (banner "Antes: 105 km · Ahora: 95 km").
- Issue #112: confirmar antes de `Add Vehicle` si las rutas tenían reorders manuales recientes (para no perder ese trabajo).

## [2026-05-09] ADR-049: Rebranding de la plataforma — VerdFrut → TripDrive

**Contexto:** "VerdFrut" se eligió al arrancar el proyecto cuando se asumía que era una herramienta interna para un solo cliente (el contrato con NETO Tiendas en CDMX/Toluca). Al consolidarse el modelo multi-tenant y aparecer la posibilidad de un 2º cliente, el nombre dejó de funcionar como marca de producto SaaS: (a) refiere a una vertical específica (frutas y verduras) que limita la percepción para otros mercados, (b) tiene connotación coloquial es-MX que no escala a mercados en/LatAm hispano, (c) es el nombre comercial del **cliente** (VerdFrut S.A. de C.V.), lo cual generaría confusión cuando lleguen tenants competidores. La plataforma necesita marca propia separada del cliente.

**Decisión:** El producto se rebrandea a **TripDrive** con dominio `tripdrive.xyz`. La separación queda:
- **TripDrive** = la plataforma SaaS (lo que se factura, lo que aparece en navegador, lo que tiene dominio).
- **VerdFrut** = primer tenant productivo. Sigue siendo cliente, sigue operando NETO. En las pantallas internas del tenant aparece la marca TripDrive con eventual cobranding cliente cuando aplique.

La migración se ejecuta en **dos fases** para no romper deploy en medio del field test:

**Fase 1 (commit de hoy):** todo lo público.
- `README.md`, `BRAND.md`, `ROADMAP.md` reescritos.
- Strings user-facing en las 3 apps (titles, metadata, h1, manifest PWA, exports, plantillas CSV, comentarios de header).
- Type-check 10/10 garantizado.
- Sin cambios en packages internos (`@tripdrive/*`), CSS vars (`--vf-*`), ni cookies (`vf-theme`) — esos son tokens estables que rompen builds o invalidan estado del usuario.

**Fase 2 (Sprint 24, post field-test):**
- Rename `@tripdrive/*` → `@tripdrive/*` en `packages/*` y todos los imports (operación atómica).
- Aliasar `--vf-*` → `--td-*` (mantener legacy 1 sprint para no romper componentes externos).
- Renombrar cookie `vf-theme` → `td-theme` con fallback de lectura.
- Rename repo GitHub `Verdfrut` → `TripDrive`.
- Crear org GitHub `@tripdrive` si conviene.

**Alternativas consideradas:**
- *Antroute (`antroute.xyz`):* primera propuesta, descartada por el user — "se escucha menos comercial". La metáfora de optimización por colonias de hormigas era fuerte pero el nombre sonaba más técnico/abstracto que comercial-B2B.
- *Trazo, Trayecto, Plexo:* descartadas por sonar "muy español-romántico" para un SaaS B2B internacional.
- *Routyx, Trakto, Karto, Iter:* descartadas por sonar más a infra/desarrollador que a producto vendible a directores de logística.
- *Beetrack-style (Trakly, Routekit, Snaproute):* descartadas en favor de TripDrive porque éste explica producto a la primera ("conducir un viaje").

**TripDrive ganó porque:**
1. Compuesto autoexplicativo: Trip (viaje, tiro) + Drive (conducir, propulsar).
2. Pronunciable en es y en sin code-switching incómodo.
3. Aplica a vertical retail (NETO) y se extiende sin esfuerzo a otras verticales (food delivery, B2B distribución, e-commerce 3PL).
4. Dominio `.xyz` disponible (`.com` por validar, aceptable comprometerse con `.xyz` para SaaS B2B).
5. Trademark probablemente limpio en MX clase 42 (software) y 39 (transporte) — validar antes de invertir en logos definitivos.

**Riesgos / Limitaciones:**
- *El package legacy `@tripdrive/*` queda en código hasta Sprint 24.* Cualquier desarrollador nuevo va a preguntar "¿por qué los packages no se llaman como la plataforma?". Mitigación: el README lo aclara, el ADR está vinculado.
- *Cookies `vf-theme` legacy* — preferencias guardadas siguen funcionando, pero la cookie name "huele" a la marca vieja. Cambio diferido a Sprint 24.
- *El cliente VerdFrut puede percibir la separación como pérdida de identidad.* Mitigación: se les comunica que TripDrive es **su** plataforma white-label internamente — pueden seguir mostrando su marca cobrandeada cuando corresponda.
- *`.xyz` tiene menos credibilidad que `.com` para algunas industrias.* Aceptable para B2B SaaS moderno (ej. cosmos.network, brave.com→search.brave.xyz). Si el cliente NETO o futuros piden `.com`, validar y comprar.
- *El rebranding fase 2 es ~2 días de trabajo de pure rename* — operación que es low-risk pero high-tedious. Mejor hacerlo en momento de calma operativa.

**Oportunidades de mejora:**
- Issue #113: validar trademark MX (IMPI clase 42 + 39) y US (USPTO) antes del lanzamiento público.
- Issue #114: comprar `tripdrive.com` si está disponible (alta prioridad si lo está) y redirigir a `.xyz` o viceversa.
- Issue #115: diseño de logo definitivo (la mascota/símbolo está pendiente — referencia a hormiga de Ant Colony Optimization sobrevive como ilustración secundaria, no como mark principal).
- Issue #116: setup de email transaccional `hola@tripdrive.xyz`, `soporte@tripdrive.xyz`.
- Issue #117: registrar handles sociales `@tripdrive` en LinkedIn / X / Instagram antes que squatters.

## [2026-05-10] ADR-050: Sprint de fortalecimiento — auditoría priorizada y fixes P0/P1

**Contexto:** Antes de seguir con features nuevas (Sprint 19 pre-field-test), se hizo una auditoría sistemática del code base buscando bugs, problemas de performance, agujeros de seguridad y deuda técnica. Resultado: 20 hallazgos accionables (5 P0, 7 P1, 7 P2, 1 ya cubierto). El sprint cierra los 5 P0 y los 2 P1 de mayor impacto que se podían atacar sin migración de infra (Sentry, Postgres rate-limit table quedan para próximo ciclo).

**Decisión:** Aplicar 7 fixes concretos en un solo commit, mantener type-check 10/10, sin cambios funcionales visibles al usuario (solo defensivos y de performance).

### Fixes aplicados

1. **P0-1 · Timezone bug en `CreateDispatchButton`:** el cálculo manual `new Date(now.getTime() - tz * 60_000)` invertía el offset y producía la fecha equivocada cuando el navegador del dispatcher estaba en otra TZ que el tenant. Ahora la fecha "hoy" viene del server vía `todayInZone(TENANT_TZ)` (helper que ya existía en `@tripdrive/utils`). El cliente conserva fallback con el mismo helper si el server no pasa la prop.

2. **P0-2 · Promise chain confusa en outbox handler `send_chat_message`:** el wrap `.then(r => r.ok ? {ok:true} : r)` era redundante (`runAndClassify` solo lee `ok/error`) y oscurecía el tipo. Removido — la llamada ahora es directa.

3. **P0-3 · Validación de UUIDs en `reorderStopsByDriverAction`:** los IDs de stops llegaban del cliente y se metían directo en queries `.eq('id', ...)`. Aunque Supabase escapa params, validar el formato UUID antes de la query es defensa en profundidad. Helper `assertAllUuids` agregado en `apps/driver/src/app/route/actions.ts`.

4. **P0-4 · Rate limit en `/share/dispatch/[token]`:** el endpoint público no tenía freno contra scraping. Ahora aplica `consume(ip, 'share-dispatch', LIMITS.shareDispatch)` con 30 hits/min por IP. Al exceder responde con `notFound()` (no 429) para no filtrar que el token existe.

5. **P1-1 · N+1 stops queries en `/dispatches/[id]` y `/share/dispatch/[token]`:** `Promise.all(routes.map(r => listStopsForRoute(r.id)))` pegaba a la BD N veces por render. Nuevo helper `listStopsForRoutes(routeIds[])` hace una sola query con `in(route_id, [...])` y devuelve `Map<routeId, Stop[]>`. Mejora ~5× en tiros con 5+ rutas, crítico en el endpoint público.

6. **P1-2 · Fire-and-forget en escalación de chat push:** si el push a zone managers fallaba, el error solo iba a `console.error` y el zone manager no se enteraba del chat. Ahora la cadena `mediateChatMessage → sendChatPushToZoneManagers` está envuelta en doble try/catch, y los fallos persisten una fila en `chat_ai_decisions` con `category='unknown'` + prefijo `ESCALATION_PUSH_FAILED:` en `rationale` (para que un cron o pantalla de audit los re-envíe).

7. **Branding follow-through:** durante el rebrand a TripDrive (ADR-049), no se actualizaron tres comentarios menores. Limpiados.

### Hallazgos diferidos (no urgentes)

- **P1 · Rate limiter in-memory** (`apps/driver/src/lib/rate-limit.ts`): aceptado en V1, migración a Postgres `rate_limit_buckets` queda para Sprint 22 (Performance + Observabilidad).
- **P2 · Logging estructurado:** 50+ `console.log/error` distribuidos. Setup pino + niveles + transporte a Sentry/LogTail va junto con S22.3.
- **P2 · `<img>` en chat-thread.tsx:** migrar a `<Image>` de Next.js — issue #118.
- **P2 · `any` casts en server actions:** zod validation gradual — issue #119.
- **P2 · Duplicación de `new Date().toISOString()`:** crear helper `now()` en `@tripdrive/utils` — issue #120.
- **P2 · `MX_BBOX` hardcoded:** mover a config del tenant para preparación multi-país — issue #121.

### Alternativas consideradas

- *Rate limiter en Postgres ya:* descartado para no inflar el sprint. El in-memory mitiga 80% del riesgo (scrapers casuales). Atacantes determinados todavía pueden saturar — issue documentado.
- *Logging estructurado ya:* descartado porque requiere decidir pino vs winston, setup de Sentry, rotar 50+ call sites. Mejor en su sprint dedicado.
- *Migración a categoría enum nueva (`escalation_push_failed`):* descartado a favor de usar `'unknown' + rationale prefix` — evita migración por un caso edge.

### Riesgos / Limitaciones

- *Rate-limit in-memory* se resetea con cada deploy / restart de instancia Vercel. Un atacante puede esperar 5 min y repetir. Mitigación: monitorear logs de errores 404 anómalos del endpoint `/share/dispatch/*`.
- *Audit de escalation_push_failed en `chat_ai_decisions`* es un workaround — la pantalla de audit existente no filtra por `category='unknown' AND rationale LIKE 'ESCALATION_PUSH_FAILED%'`. Hasta que se agregue, los fallos solo son visibles vía SQL directo.
- *El batch `listStopsForRoutes`* no preserva el orden de `routeIds` en el resultado interno, pero el caller siempre re-mappea por id — así que da igual. Documentado en el JSDoc.

### Oportunidades de mejora

- Issue #118: `<img>` → `<Image>` en chat thread (~30 min, P2).
- Issue #119: zod schemas para server actions (~2 días, P2).
- Issue #120: helper `now()` en `@tripdrive/utils` (~15 min, P2).
- Issue #121: `tenant.boundingBox` cargado en context (~1 día, P2).
- Issue #122: pantalla `/audit/chat-failures` que filtre `rationale LIKE 'ESCALATION_PUSH_FAILED%'`.
- Issue #123: ampliar enum `chat_ai_decisions.category` con `escalation_push_failed` cuando se justifique.
- Issue #124: migrar rate-limit in-memory a tabla Postgres con expiry (Sprint 22).

## [2026-05-10] ADR-051: Observabilidad de errores con Sentry (Free tier, single project)

**Contexto:** Antes de este ADR, los errores en producción solo iban a `console.error` y se perdían en los logs runtime de Vercel (efímeros, sin agrupación ni alertas). El cliente NETO empezó a usar la plataforma real y necesitamos saber cuándo algo se rompe en campo *antes* de que el dispatcher llame. La auditoría de ADR-050 identificó ~50 `console.error` distribuidos como deuda P2. Toca el momento de invertir en observability.

**Decisión:** Adoptar **Sentry** como plataforma de error tracking y performance monitoring, con setup compartido para las 3 apps del monorepo.

### Stack final

1. **Package nuevo `@tripdrive/observability`** que centraliza:
   - `logger` con métodos `error/warn/info/debug` — API que reemplaza `console.*`.
   - `initSentry(Sentry, opts)` — factory de configuración con sample rates, ignoreErrors, tags por app.
   - `configureLogger({ app })` — setea el tag global de cada app.

2. **`@sentry/nextjs` 8.55** en las 3 apps (`apps/platform`, `apps/driver`, `apps/control-plane`).

3. **Por app:** 3 archivos de runtime config (`sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`) + `instrumentation.ts` (hook de Next.js 15+) + wrap `next.config.ts` con `withSentryConfig` para *source maps*.

4. **Único proyecto Sentry compartido** (Free tier limita a 1 proyecto / 5k eventos por mes). Los 3 apps mandan al mismo DSN, se distinguen con tag `app: platform | driver | control-plane`. Total cuota: 5k eventos/mes entre las 3.

5. **Migración inicial de 5 `console.error` críticos** a `logger.error`:
   - `/api/routes/[id]/polyline/route.ts`
   - `chat/actions.ts` (4 sites: mediator, escalation, autoReply, audit, push fanout)
   - `route/actions.ts` (audit del reorder)
   - `push-fanout.ts` (VAPID, subscriptions, sin destinatarios)
   - Resto (~25 sites) queda como migración gradual por sprint.

### Sample rates iniciales (conservadores por cuota Free)

| Setting | Value | Razón |
|---|---|---|
| `tracesSampleRate` | 0.05 en prod, 1.0 en dev | 5% es suficiente para detectar endpoints lentos sin quemar cuota |
| `replaysSessionSampleRate` | 0 | Session Replay consume mucho; deshabilitado hasta plan pago |
| `replaysOnErrorSampleRate` | 1.0 en client | Sí grabamos sesiones cuando ocurre un error — bueno para debug, sin costo extra |
| `enabled` | `env !== 'development'` | No enviamos eventos desde local dev a menos que `SENTRY_FORCE_LOCAL=1` |

### Filtros de ruido (`ignoreErrors`)

Pre-cargados en `sentry-init.ts` para no quemar cuota con errores conocidos no nuestros:
- `NetworkError`, `Failed to fetch`, `Load failed` — errores de red mobile comunes.
- `ResizeObserver loop limit exceeded` — falso positivo cross-browser.
- `chrome-extension://`, `moz-extension://` — extensiones del usuario inyectando errores.

### Source maps

`withSentryConfig` en cada `next.config.ts` activa:
- Generación de source maps en build.
- Upload a Sentry vía CLI si `SENTRY_AUTH_TOKEN` está presente (CI/Vercel).
- `hideSourceMaps: true` — los maps NO quedan accesibles públicamente (solo Sentry los usa).
- `tunnelRoute: '/monitoring'` — eventos del cliente van por nuestro propio dominio antes de Sentry, evita ad-blockers.

### Alternativas consideradas

- **LogTail / Better Stack:** más barato pero solo logs, sin error tracking + performance + replays. Sentry es la solución completa.
- **Vercel Runtime Logs nativos:** ya los tenemos, son efímeros (12-24h), sin filtros, sin alertas. No reemplaza Sentry.
- **3 proyectos Sentry separados (uno por app):** descartado porque Free tier limita a 1 proyecto. Cuando crezca el presupuesto y queme cuota, evaluamos.
- **Self-hosted Sentry (open-source):** descartado por costo de DevOps. Vale la pena en empresas con muchas apps/devs.
- **Posthog:** producto excelente pero más amplio (analytics + replays + features flags). Sentry es más enfocado a errores. Eventual: Sentry para errores + Posthog para producto analytics (Sprint H5 cuando aplique).

### Riesgos / Limitaciones

- *Free tier 5k eventos/mes* — si producción crece, se quema rápido. Mitigación: monitorear los primeros 30 días, ajustar `tracesSampleRate` y `ignoreErrors`. Plan B: migrar a Team ($26/mes, 50k eventos).
- *Sentry SDK 8.55 declara peer next ≤15* pero usamos Next 16. Funciona pero no es oficialmente soportado. Si en futuro hay incompatibilidad, considerar pin a `@sentry/nextjs@^9.x` cuando salga con Next 16 support.
- *Un proyecto = todos los errores juntos.* Tag `app` es la única separación. Si una app falla en loop, quema la cuota de las otras. Aceptable porque "una app falla en loop" ya es bug crítico que debemos resolver de inmediato.
- *El `logger.error` es async* porque carga `@sentry/nextjs` con dynamic import. En catch blocks que no eran async esto puede requerir reescribir el contexto. Aceptable trade-off vs forzar dependencia hard del SDK.
- *Los `console.error` legacy* (~25 sitios) siguen ahí. No se mandan a Sentry hasta migrarlos. Riesgo: bugs reales no llegan al dashboard. Mitigación: cada PR que toca un archivo migra los suyos; meta operativa: 100% migrados en 4 sprints.
- *Source maps requieren `SENTRY_AUTH_TOKEN`* que es secreto. Si se olvida configurar en Vercel, el build sigue funcionando pero los stack traces en Sentry apuntan al bundle minificado (ilegibles). Documentado en `OBSERVABILITY.md`.

### Oportunidades de mejora

- Issue #125: migración masiva de los 25 `console.error` restantes — gradual, 1 PR por archivo cuando se toque.
- Issue #126: habilitar Performance tracing en endpoints clave (`/api/routes/*`, `/api/cron/*`) con alertas si P95 > 2s.
- Issue #127: integración Slack para alertas de error nuevo crítico.
- Issue #128: pantalla `/audit/sentry-summary` con KPIs propios (errores por app, por release, top issues).
- Issue #129: cron `/api/cron/*` reportan latencia a Sentry para detectar timeouts.
- Issue #130: evaluar Posthog para product analytics (eventos de UX) — separado de Sentry.

## [2026-05-10] ADR-052: Sprint H2 — ETAs reales, crons instrumentados, APK full TWA, banner ETA demo

**Contexto:** Después de Sprint H1 (Sentry instalado, observability lista), el siguiente bottleneck para "production-grade" eran tres piezas que sí dependen de env vars en Vercel y que NO se podían cerrar sin participación del operador (acceso a Vercel, n8n cloud):

1. **MAPBOX_DIRECTIONS_TOKEN** — sin esto, todos los km/ETAs son haversine ×1.4 + 25 km/h. Off por 20-40% en zonas urbanas. El dispatcher veía esos números sin saber que eran aproximados.
2. **ANTHROPIC_API_KEY** en el driver — sin esto, el AI mediator del chat (ADR-027) no clasifica triviales y todo escala al zone_manager. Ruido alto en prod.
3. **3 schedules n8n** (timeout-chats / orphans / breadcrumbs) — los endpoints existían desde Sprint 18 pero nunca se configuraron schedules. Chats sin respuesta quedan colgados, usuarios orphan acumulan, breadcrumbs crecen sin tope.

Adicional: la APK demo está en modo Custom Tab (barra Chrome visible) porque assetlinks.json no se está sirviendo con `Content-Type: application/json` desde Vercel.

**Decisión:** Cerrar las 4 cosas en una pasada — código listo + documentación operativa, dejando solo el "setear env var" para el operador.

### Cambios

1. **Optimizer + observability del fallback (`apps/platform/src/lib/optimizer.ts`):**
   - Sin token → `logger.info` (estado esperado, no Sentry).
   - >25 coords → `logger.warn` (degradación, va a Sentry).
   - Mapbox falla con token presente → `logger.error` (algo está mal, va a Sentry con tag).
   - El dispatcher ve los números en su UI; el operador ve el modo de cálculo en Sentry.

2. **Banner UI de transparencia (`components/shell/eta-mode-banner.tsx`):**
   - Server component que lee `process.env.MAPBOX_DIRECTIONS_TOKEN`.
   - Si NO está set, renderiza banner amarillo: "ETAs aproximados — los números pueden errar 20-40%".
   - Aparece en `/dispatches/[id]` y `/routes/[id]` arriba del header.
   - Cuando el operador setea el token y redeploys, el banner desaparece automáticamente. No requiere migración ni feature flag.

3. **Crons instrumentados con logger:**
   - Los 3 endpoints (`mark-timed-out-chats`, `reconcile-orphan-users`, `archive-breadcrumbs`) ahora usan `logger.error/warn/info` para que aparezcan en Sentry cuando fallen.
   - `console.error` legacy eliminado.
   - Token inválido NO va a Sentry (los scanners de internet pegan a estos URLs todo el tiempo) — solo runtime log.
   - Cualquier RPC fallido SÍ va a Sentry como error.

4. **assetlinks.json — headers correctos (`apps/driver/next.config.ts`):**
   - Nueva config `headers()` con `source: '/.well-known/assetlinks.json'`:
     - `Content-Type: application/json`
     - `Cache-Control: public, max-age=3600`
   - Android valida el archivo con request HEAD/GET y verifica content-type. Sin este header Vercel servía `text/html` → APK queda en Custom Tab.

5. **TWA manifest actualizado a TripDrive** (`mobile/driver-apk/twa-manifest.json`):
   - `name: "TripDrive Conductor"`, `launcherName: "TripDrive"`.
   - **Package ID NO cambia** (`com.verdfrut.driver`) — eso requeriría rotar keystore y la APK ya instalada en celulares de prueba dejaría de funcionar. El cambio interno es invisible al usuario; el display name sí es el nuevo.

6. **`DEPLOY_CHECKLIST.md` nuevo** — guía operativa completa:
   - Lista de TODAS las env vars por app, con valor/origen y si bloquea.
   - Schedules n8n con cron expressions específicas, body, header.
   - Cómo verificar assetlinks.json funcional via curl.
   - Cómo regenerar APK si hace falta.
   - Smoke tests post-deploy.
   - Estado actual del deploy (qué falta).

### Alternativas consideradas

- *Hard-fail si `MAPBOX_DIRECTIONS_TOKEN` no está set:* descartado. Romper la app cuando un env var no está es mala UX — el cliente puede haber querido "modo demo" intencionalmente. Banner explícito es mejor.
- *Banner como toast:* descartado, se descarta rápido. El banner persistente es el patrón correcto para "estado de la sesión".
- *Rotar package ID del APK a `xyz.tripdrive.driver`:* descartado — rompe APKs instaladas. Cuando llegue Play Store con app NUEVA, ahí sí cambio.
- *Vercel Cron Jobs* (su feature nativa) en vez de n8n: descartado porque n8n cloud ya está en el stack del operador para otros automation, mantener una sola herramienta.

### Riesgos / Limitaciones

- *Banner ETA demo* aparece para TODOS los usuarios (incluido el cliente). Si el cliente NETO ve el banner amarillo puede preguntar — está bien, es transparencia honesta. Mitigación: setear el token cuanto antes.
- *Crons sin token configurado en n8n* siguen sin correr. Endpoints listos pero schedules pendientes. Documentado en DEPLOY_CHECKLIST.
- *Mapbox Free tier* = 100k requests/mes Directions Matrix. Si quemamos eso (improbable con 1 cliente, 30 stops, 3 vehículos), banner amarillo aparecería intermitentemente cuando caen al fallback. Sentry lo capturaría como error.
- *La verificación assetlinks por Android tarda hasta 24h* en propagarse. Aunque el deploy aplique los headers ya, los APKs instalados pueden seguir en Custom Tab por 24h. Re-instalar fuerza re-verificación.
- *El próximo `console.error` migrado a logger se descubre durante operación* — quedan ~22 sites de los originales 50 (criterios ADR-051). No es bloqueante pero deja zonas ciegas.

### Oportunidades de mejora

- Issue #131: alerta en Sentry "Mapbox fallback haversine" para que llegue email/Slack si pasa más de N veces/hora.
- Issue #132: contador en `/audit/observability` con "queries Mapbox usadas en últimas 24h" — anticipación al límite Free tier.
- Issue #133: A/B comparativo "el mismo tiro con haversine vs Mapbox" — surfacing del delta en UI cuando se re-optimiza con token activo. Tiene sinergia con #111.
- Issue #134: feature flag por tenant para "modo demo" intencional (algunos contextos comerciales se prefieren con números aproximados).
- Issue #135: cron HTTP health check externo (UptimeRobot / Better Stack) para que el operador sepa si Vercel está down — no depende solo de Sentry.

## [2026-05-10] ADR-053: Sprint H3 — Robustez del split/merge (RPC atómica + preservar overrides + banner + audit)

**Contexto:** ADR-048 entregó la feature "agregar/quitar camionetas con re-rutear automático", pero con caveats documentados:
- **Atomicidad parcial:** si el optimizer Railway fallaba después de cancelar las rutas viejas, el tiro quedaba vacío (issue #108).
- **Pérdida de overrides:** el `depot_override_id` por ruta se perdía al redistribuir — el dispatcher tenía que re-aplicarlos (issue #110).
- **Sin surface de unassigned:** si el optimizer no podía asignar una tienda (capacidad/ventana), el ID aparecía en el result pero la UI no lo mostraba (issue #109).
- **Sin métricas comparativas:** el dispatcher no veía si la redistribución mejoró o empeoró km totales (issue #111).
- **Riesgo de pérdida de trabajo manual:** si una ruta tenía reorder manual (version > 1), redistribuir lo recalculaba desde cero sin avisar (issue #112).
- **Drag cross-route:** no soportado entre cards (issue #95).

**Decisión:** Atacar los 5 issues más impactantes en un sprint encadenado. El #95 queda deferred (refactor del DndContext = alto riesgo + el dropdown "Mover a →" cubre el caso).

### Cambios

#### H3.1 — RPC atómica + two-phase commit

1. **Migración 032:** `tripdrive_restructure_dispatch(p_dispatch_id, p_old_route_ids[], p_routes_json, p_created_by)` RPC Postgres que en UNA transacción:
   - Valida que ninguna ruta del set old está en post-publicación (race-safe).
   - Borra stops de las viejas, las marca CANCELLED.
   - Inserta las rutas nuevas con sus stops + métricas + depot_override_id ya seteado.
   - Si algo falla, rollback automático → tiro intacto.
   - `SECURITY DEFINER` + grant solo a `service_role`.

2. **Nuevo módulo `lib/optimizer-pipeline.ts`:** función pura `computeOptimizationPlan(input)` que carga entities, valida zona, llama optimizer Railway y devuelve un plan estructurado por ruta — **sin tocar BD**.

3. **Refactor `restructureDispatchInternal`:** ahora es two-phase commit explícito:
   - **Fase 1 (sin BD):** captura snapshot pre, captura overrides actuales, llama `computeOptimizationPlan`. Si falla, return error sin tocar BD.
   - **Fase 2 (RPC atómica):** pasa el plan a la RPC. Si rollback, tiro vuelve exactamente como estaba.

   Bug crítico resuelto: el flujo previo cancelaba rutas viejas ANTES de saber si el optimizer iba a funcionar. Ahora si el optimizer falla, las rutas viejas siguen vivas sin un solo cambio.

#### H3.2 — Surfacing de unassigned stops

- `RestructureSnapshotBanner` (nuevo) muestra lista de tiendas no asignadas con códigos resueltos.
- El banner persiste en `sessionStorage` con TTL de 10 min — sobrevive `router.refresh()` y refresh de página.
- Mensaje accionable: "X tienda(s) sin asignar. Agrega manualmente o suma otra camioneta."

#### H3.3 — Preservar depot override por vehicle

- Antes de fase 1, capturamos `oldDepotOverridesByVehicleId: Map<vehicleId, depotId>` de las rutas vivas.
- Filtramos a los vehículos que SIGUEN en la nueva asignación (vehículos nuevos no tienen override previo).
- Pasamos el map a `computeOptimizationPlan` → optimizer respeta override del CEDIS de salida.
- RPC inserta `depot_override_id` en la nueva ruta.

#### H3.4 — Banner comparativo km antes/después

- Cada acción (`addVehicleToDispatchAction`, `removeVehicleFromDispatchAction`) ahora retorna `{ before, after }` con km, min y route count.
- El cliente persiste el snapshot en `sessionStorage:restructureSnapshot:<dispatchId>`.
- `RestructureSnapshotBanner` lee el snapshot al cargar `/dispatches/[id]` y muestra:
  - Métricas pre con strikethrough + post en bold.
  - Delta resaltado (verde si km baja, amarillo si sube).
  - Sección de unassigned stops si aplica.
  - Botón × para descartar.

#### H3.5 — Confirm reorders manuales

- Server (page detail) calcula `hasManualReorders = routes.some(r => r.status !== 'CANCELLED' && r.version > 1)`.
- Se pasa como prop a `AddVehicleButton` y `RemoveVehicleButton`.
- Modal muestra warning amarillo: "Las rutas tienen cambios manuales — redistribuir recalcula desde cero, el orden manual se pierde."
- El dispatcher decide informado.

#### H3.6 — Drag cross-route (DEFERRED)

- Implementación correcta requiere mover `DndContext` al nivel de la page (envuelve todas las cards) + handler global que detecta drop cross-card.
- Riesgo: ~3h de refactor + tests + posibles regresiones en drag intra-route que YA funciona.
- ROI bajo porque el dropdown "Mover a →" ya cubre el caso operativo principal.
- **Diferido al backlog** — issue #95 sigue abierto.

### Alternativas consideradas

- *Mantener rollback manual (TS):* descartado — no es robusto frente a errores parciales. Postgres ya tiene transacciones, hay que usarlas.
- *Llamar optimizer DENTRO de la transacción (vía pg_net):* descartado — el optimizer Railway tarda 1-5s, mantener una transacción Postgres abierta tanto tiempo bloquea connection pool. Two-phase es lo correcto.
- *Soft delete de rutas viejas (status='RESTRUCTURED'):* descartado — agregar status nuevo rompe code paths existentes. `CANCELLED` ya es suficiente para "no es una ruta viva" y se filtra desde el query inicial.
- *Snapshot pre/post en BD (tabla `dispatch_restructure_history`):* descartado para V1 — sessionStorage es suficiente para el caso de uso UI. Tabla de history válida si llegamos a auditoría requerida (issue futuro).
- *Banner persistent en BD vs sessionStorage:* descartado el persistent — la métrica solo importa "ahora", expira a 10 min, no hay valor en mantenerla cross-session.
- *Block del redistribuir si hay reorders manuales:* descartado — debe ser una elección informada del dispatcher, no un bloqueo. Warning + confirm es el patrón correcto.

### Riesgos / Limitaciones

- *La RPC `tripdrive_restructure_dispatch` no genera entrada en `route_versions`* — las rutas nuevas son version 1. Si querían tracking de "esta es la 3ra redistribución del día", hay que agregar audit table separada.
- *El sessionStorage del banner no se sincroniza entre tabs* del mismo dispatcher — si abre el tiro en 2 tabs y redistribuye en uno, el otro no muestra banner. Aceptable: caso edge.
- *El delta "manual reorders" cuenta cualquier version > 1*, incluyendo bumps post-publicación (que son legítimos del chofer). Falso positivo posible en tiros completos — pero como `hasManualReorders` solo bloquea redistribuir pre-publicación, no afecta operación real (post-publicación no puede redistribuir igual).
- *Si Mapbox Matrix falla y cae a haversine durante redistribución*, el banner mostrará "ETAs aproximados" pero el delta vs. el `before` (que también era haversine) será comparable. Si el `before` era Mapbox y el `after` cae a haversine, el delta es engañoso. Mitigación: el banner ETA modo demo (ADR-052) advierte el contexto.
- *La RPC inserta status `OPTIMIZED` directamente,* saltando `DRAFT`. Es coherente porque ya tenemos el plan del optimizer, pero rompe la asunción "toda ruta empieza DRAFT". Si algún code path depende de eso, ajustar.
- *`depotOverrideId` solo se preserva* si el vehículo está en el nuevo set. Si el dispatcher elimina la camioneta y agrega otra distinta, no hay forma de "transferir el override" — la nueva ruta usa el depot del nuevo vehículo. Aceptable.

### Oportunidades de mejora

- Issue #136: tabla `dispatch_restructure_history` para audit operativo (quién redistribuyó, cuándo, delta km).
- Issue #137: tracking de versión por tiro (no solo por ruta) — útil para "esta es la 3ra redistribución de hoy".
- Issue #138: opción "deshacer redistribución" durante 5 min — leer último snapshot y restaurar.
- Issue #139: re-implementar #95 (drag cross-route) con DndContext compartido cuando haya capacidad.
- Issue #140: banner persistente cross-tab via BroadcastChannel API.
- Issue #141: auto-aplicar el override de depot si las nuevas camionetas comparten zona con las viejas (heurística "el dispatcher querría preservar este CEDIS por zona, no por vehículo").

## [2026-05-11] ADR-054: Sprint H4 — Performance + escala (N+1 audit, rate limit Postgres, helpers, iOS LP)

**Contexto:** Antes de empezar pruebas reales con cliente (Sprint H5+ de testing), invertir en performance + resiliencia. La auditoría del Sprint H1 (ADR-050) había identificado P1s diferidos: rate-limit in-memory, N+1 queries, MX_BBOX hardcoded, falta de helper `now()`, `<img>` sin optimizar. Sumamos auditoría adicional de N+1 esta sesión que encontró otro hot path en `/map` (live map del supervisor) que multiplica queries por cada ruta IN_PROGRESS.

**Decisión:** Ejecutar las 6 mejoras en un sprint encadenado, con foco en lo que más impacta cuando el cliente carga rutas grandes.

### Cambios

#### H4.1 — Eliminación de N+1 queries

1. **Nuevo helper `getUserProfilesByIds(ids[])`** en `lib/queries/users.ts`. Una sola query `.in('id', [...])` devuelve `Map<userId, UserProfile>`. Reemplaza N llamadas a `getUserProfile`.

2. **Nuevo módulo `lib/queries/breadcrumbs.ts`** con `getLastBreadcrumbsByRouteIds(ids[])`. Una query batch con `.in('route_id', [...])` + filtro de últimos 60 min + agrupado en memoria. Devuelve `Map<routeId, LastBreadcrumb>`.

3. **`/app/(app)/map/page.tsx` refactor.** Antes: 3×N queries (`Promise.all(routes.map(async r => { listStopsForRoute + breadcrumb + profile }))`). Después: 4 queries totales (5 incluyendo carga inicial). Mejora ~10× con 5+ rutas activas.

4. **`components/map/multi-route-map-server.tsx`**: cambiado de `Promise.all(routes.map(listStopsForRoute))` a `listStopsForRoutes(routeIds)`.

#### H4.2 — Rate limit distribuido (issue #124)

1. **Migración 033 `rate_limit_buckets`:** tabla simple `(bucket_key, hit_at, expires_at)` + índice compuesto `(bucket_key, hit_at DESC)`.

2. **RPC `tripdrive_rate_limit_check(p_bucket_key, p_window_seconds, p_max_hits)`:** chequeo atómico. Cuenta hits en ventana, retorna `false` si excede (sin insertar), retorna `true` si pasa (e inserta el hit). Atomicidad por transacción Postgres implícita.

3. **RPC `tripdrive_rate_limit_cleanup()`:** borra rows con `expires_at < now()`. Llamar 1×/día via cron (endpoint TODO).

4. **`apps/platform/src/lib/rate-limit.ts` y `apps/driver/src/lib/rate-limit.ts` reescritos:** `consume()` ahora es async, llama la RPC. Si la RPC falla (BD down, network error), fallback in-memory para no tumbar el endpoint. Loggea `logger.warn` cuando cae al fallback — el operador detecta BD down por la tasa de warnings en Sentry.

5. **Call sites migrados:** 4 endpoints (`/share/dispatch/[token]`, `/incidents/[reportId]/actions`, `/route/stop/[id]/chat/actions`, `/api/ocr/extract-ticket`).

#### H4.3 — Helper `nowUtcIso()` centralizado (issue #120)

- Agregado a `packages/utils/src/date.ts` con doc explicando motivación (testeo + futuro timezone-aware).
- Call sites legacy de `new Date().toISOString()` quedan para migración gradual (no urgente).

#### H4.4 — Tenant bbox configurable (issue #121)

- `apps/platform/src/lib/validation.ts` ya no hardcoded a México. Lee env vars:
  - `TENANT_BBOX_LAT_MIN/MAX`, `TENANT_BBOX_LNG_MIN/MAX`
  - `TENANT_REGION_NAME` (para el mensaje de error)
- Defaults siguen siendo MX (no rompe deploy actual).

#### H4.5 — `<img>` → `<Image>` en chat thread (issue #118)

- `components/chat/chat-thread.tsx` usa `<Image fill sizes="...">` con wrapper relativo.
- Lazy loading + WebP/AVIF + CDN automáticos.
- `*.supabase.co` ya en `next.config.images.remotePatterns`.

#### H4.6 — Compresión iOS Low Power defensiva (issue #20)

- `packages/utils/src/image.ts` `compressImage()` ahora hace `Promise.race(compression, timeout(5s))`.
- Si vence o lanza error → devuelve el File original. El upload toma más tiempo pero la PWA no se cuelga.
- Default 5s configurable via `timeoutMs`.

#### H4.7 — Documentación

- **`PERFORMANCE.md` nuevo:** playbook con reglas operativas, helpers batch disponibles, antipatrones, reglas para nuevos endpoints, métricas a vigilar.
- **`DEPLOY_CHECKLIST.md`** actualizado con cron `rate_limit_cleanup` y nuevas env vars opcionales (TENANT_BBOX_*).
- **`ROADMAP.md`** actualizado: Sprint H4 completo, H5 (reportería/UX) marcado siguiente.

### Alternativas consideradas

- *Redis para rate limit:* descartado para V1 — agrega infraestructura (Upstash o managed Redis) que no tenemos. Postgres es suficiente con cardinalidad esperada (<10k buckets/min). Si crece, migración no-breaking porque la API `consume()` ya está abstraída.
- *DISTINCT ON Postgres para `getLastBreadcrumbsByRouteIds`:* descartado — Supabase JS no expone bien `DISTINCT ON`. La estrategia "traer 60min + agrupar en memoria" cabe en <1k filas para 50 rutas activas, es rápida. Migrar a RPC si crece.
- *Helper sync `consume()` paralelo al async:* mantuvimos `consumeSync()` deprecado para compat con call sites que no podían convertirse a async. En la migración terminamos sin usarlo (todos los call sites ya estaban en functions async), pero queda disponible.
- *Postgres `pg_cron` para cleanup automático del rate limit:* descartado por consistencia operativa — ya usamos n8n para los otros crons, sumar `pg_cron` mete otra herramienta. Mejor un endpoint HTTP que n8n llama.
- *Lighthouse audit del driver PWA en este sprint:* diferido — requiere setup del runner + correr en 3G simulado + analizar resultados. Es 2-3h por sí solo, mejor sprint H5 dedicado.

### Riesgos / Limitaciones

- *El rate limit fallback in-memory* sigue siendo per-instancia. Si la BD está caída por horas, multiple instancias Vercel divergen. Aceptable: BD down es ya emergencia.
- *La RPC `tripdrive_rate_limit_check` hace 2 queries por hit* (COUNT + INSERT). En endpoints high-traffic puede ser bottleneck. Por ahora con tráfico actual está bien; si crece, opciones: (a) bumping a UPSERT con counter; (b) Redis.
- *La tabla `rate_limit_buckets` crece sin tope hasta que corre el cron de cleanup.* Si el cron falla un día, el INSERT sigue. Mitigación: el índice cubre el lookup eficiente aunque haya millones de rows expirados.
- *El partial index con `WHERE expires_at < now()` falló* porque Postgres exige IMMUTABLE en predicates. Solución: índice plano sobre `expires_at`. El cleanup hace seq scan ordenado — aceptable para low cardinality.
- *`getLastBreadcrumbsByRouteIds` con lookback 60 min* puede perder breadcrumbs viejos si el chofer dejó de mandar GPS hace más. Hoy aceptable porque el live map solo importa rutas activas hoy. Si necesitamos "última posición conocida" para rutas paused, ampliar lookback.
- *`<Image>` requiere `width/height` o `fill`.* En chat-thread usamos `fill` con altura fija 64. Para imágenes muy verticales (recibos en portrait) puede recortar. Aceptable porque el chofer puede expandir con click (no implementado, issue #143).
- *El timeout de `compressImage` puede dispararse en redes lentas (no en iOS LP)* si `loadImage` del File tarda. En esos casos el fallback al original es correcto pero el log puede ser ruidoso. Issue #144 abierto para diferenciar.
- *`TENANT_REGION_NAME` y `TENANT_BBOX_*` no están seteados todavía* en Vercel — defaults a México. Cuando llegue cliente fuera de México, hay que setearlos.

### Oportunidades de mejora

- Issue #142: endpoint cron `POST /api/cron/rate-limit-cleanup` + schedule n8n.
- Issue #143: click en imagen de chat-thread para expandir a lightbox.
- Issue #144: separar "timeout iOS LP" vs "timeout red lenta" en el log de compressImage.
- Issue #145: Lighthouse audit del driver PWA (Sprint H5).
- Issue #146: migrar los call sites legacy de `new Date().toISOString()` a `nowUtcIso()` — incremental.
- Issue #147: profilling de Server Components con Sentry Performance + identificar P95 > 1s.
- Issue #148: Tabla pivot `tenant_config` en BD en vez de env vars para bbox/region (más flexible que ENV).

## [2026-05-11] ADR-055: Sprint H5 — Reportería operativa + pantalla de auditoría + UX pulida pre-pruebas

**Contexto:** Sprint previo al test real con cliente. Los choferes y el dispatcher van a usar la plataforma con presión operativa, así que necesitan: (1) ver KPIs operativos relevantes en `/reports` (que era stub), (2) visibilidad de fallos silenciosos para que el operador investigue, (3) detalles de UX pulidos que la auditoría P2 dejó pendientes, (4) endpoint cron para mantener la BD limpia tras introducir rate_limit_buckets, (5) guía para correr Lighthouse en el driver PWA antes del primer field test productivo.

**Decisión:** Atacar 5 frentes en un solo sprint encadenado. Cada uno es chico (~30-60 min) pero juntos suman la diferencia entre "demo aceptable" y "comerciable a otros clientes".

### Cambios

#### S5.1 — `/reports` pasa de stub a operativo

- Filtros: rango de fechas (default últimos 30 días), zona.
- KPIs en 2 filas: rutas en rango, completadas, cumplimiento %, canceladas/interrumpidas + distancia km, tiempo manejo h, paradas completas, paradas pendientes.
- Breakdown granular por status (DRAFT/OPTIMIZED/APPROVED/PUBLISHED/IN_PROGRESS/INTERRUPTED/COMPLETED/CANCELLED).
- Query batch de paradas con `.in('route_id', [...])` para no caer en N+1.
- Link cross-page a `/dashboard` aclarando que ese es para KPIs comerciales (facturado, merma).

#### S5.2 — Pantalla `/audit/chat-failures`

- Lista los rows de `chat_ai_decisions` con `rationale LIKE 'ESCALATION_PUSH_FAILED:%'`.
- Cada row: timestamp, link al reporte, mensaje del chofer, motivo del fallo.
- Card de ayuda al final con qué hacer en cada caso (VAPID mal, subscription expirada, retry manual).
- Link agregado al sidebar bajo "SISTEMA" → "Auditoría · chat" (visible solo admin).

#### S5.3 — Lighthouse audit instructivo

- `LIGHTHOUSE.md` con cómo correr el audit (local + prod), métricas target con valores específicos, qué optimizar si reprueba, checklist PWA específico, cadencia recomendada.
- El audit en sí no se corrió aún (requiere browser headless); el doc deja al user listo para hacerlo cuando quiera.

#### S5.4 — Cron `rate-limit-cleanup`

- `/api/cron/rate-limit-cleanup` con auth via `CRON_SECRET` (mismo header que los otros 3 crons).
- Invoca RPC `tripdrive_rate_limit_cleanup()` agregada en migración 033 (ADR-054).
- Loggea `logger.info` cuando borra rows; `logger.error` si falla.
- DEPLOY_CHECKLIST ya documenta el schedule (`0 4 * * *`).

#### S5.5 — Quality of life

1. **Issue #143 (lightbox imagen chat):** click en imagen del thread abre overlay fullscreen con cierre por ESC o click fuera. Lightbox usa `<img>` (no `<Image>` Next) porque `object-contain` en flex sin tamaño definido se rompía. State al top-level del componente.
2. **Issue #144 (compressImage flag):** la función marca con un Symbol en window el File devuelto cuando vence el timeout o falla. Nuevo helper exportado `compressImageFellBack(file)` permite al call site mandar telemetría sin tocar el Symbol manualmente. Console.warn agregado para el error path.

### Alternativas consideradas

- *KPIs operativos vía RPC dedicado (on-time, %completitud por chofer, anomalies):* descartado para H5. Requiere RPCs nuevos + diseño de qué exactamente mostrar. Mejor esperar a que el cliente pida números específicos durante el test real y construir contra eso, no contra hipótesis.
- *Comparativa período-vs-período en /reports:* descartado por scope. Es feature de un sprint dedicado cuando haya 2-3 meses de datos.
- *Pantalla `/audit/sentry-summary` (issue #128):* descartado porque Sentry tiene su propio dashboard mejor que cualquier copia interna. La pantalla de chat-failures sí tiene valor porque accionar un retry requiere contexto del reporte específico.
- *Lightbox con portal a `document.body`:* descartado — el modal del chat ya rompe overflow del parent, no necesitamos portal. Cambiar después si aparecen z-index issues con otros modales.
- *Lightbox con `<Image>` de Next:* probado pero `fill` en contenedor flex sin tamaño definido se renderiza 0x0. `<img>` directo con `object-contain` y maxWidth/maxHeight es lo correcto aquí.
- *Audit en CI automático:* descartado para V1 — agregar Lighthouse CI requiere setup de runner. El doc deja claro cómo correrlo manualmente.

### Riesgos / Limitaciones

- *`/reports` queries con limit 2000* — si un tenant llega a más rutas en 30 días, se trunca silenciosamente. Aceptable hoy (VerdFrut hace ~5-15 rutas/día = 150-450/mes). Cuando llegue volumen, paginar o agregar warning de "datos truncados".
- *El cron de cleanup* solo funciona si está configurado en n8n. Si nadie lo configura, la tabla `rate_limit_buckets` crece linealmente. Mitigación: el INSERT performance está cubierto por el índice; con 1M de rows el COUNT por bucket sigue siendo sub-100ms gracias a `(bucket_key, hit_at DESC)`.
- *La pantalla `/audit/chat-failures` usa service_role* para bypass RLS (necesita ver cross-zone). Solo accesible a admins por el sidebar; pero si alguien sabe la URL exacta y es dispatcher puede entrar — RLS bypass del service_role NO es defensa per-zone. Aceptable porque el rol de la pantalla es operativo (solo admin debe operar push retries).
- *El lightbox cierra con click en cualquier lado del overlay,* incluyendo el botón X que tiene `stopPropagation`. Si el usuario arrastra para zoom, el cierre puede dispararse. Aceptable hasta el primer feedback real.
- *`compressImageFellBack` depende de Symbol shared en window.* Si el módulo se duplica en build (rare), los Symbols no matchean. Mitigación: `Symbol.for(key)` usa el registry global así está bien.
- *El instructivo Lighthouse* no se ha validado contra el driver real — el primer audit puede revelar que `mapbox-gl` entra en bundle aunque no debiera. Tarea para el primer commit post-audit.

### Oportunidades de mejora

- Issue #149: dashboard de driver app (versión driver: cuántos stops completadas este mes, fotos subidas, kg movidos).
- Issue #150: drill-down por ruta en /reports (click sobre count "completadas" → lista esas rutas).
- Issue #151: export XLSX directo desde /reports (operativo, complementa el de /api/export/tickets que es comercial).
- Issue #152: anomaly detection en /audit (anomalías automáticas de operación, distinto de chat-failures).
- Issue #153: alertas Slack para chat-failures cuando aparece uno nuevo.
- Issue #154: filtros por estado, tipo de reporte y chofer en /incidents (hoy listado plano).
- Issue #155: comparativa mes-vs-mes en /reports cuando haya 2+ meses de data.

## [2026-05-11] ADR-056: Sprint H6 — Custom domains + rebrand interno fase 2

**Contexto:** Pieza final del rebrand a TripDrive (ADR-049 había hecho la fase 1 de strings user-facing). El sprint cubre 4 frentes que llevan la plataforma a estado "comercial real":

1. **Custom domains** `tripdrive.xyz` con subdominios por app.
2. **Rename packages** `@verdfrut/*` → `@tripdrive/*` (193 archivos TS/TSX + 8 package.json + workspace config).
3. **Aliases CSS vars** `--vf-*` → `--td-*` para uso futuro sin tocar 100+ call sites.
4. **Cookie migration** `vf-theme` → `td-theme` con fallback.

**Decisión:** Ejecutar las 4 piezas. Las que no requieren acceso del operador (rebrand interno) se hacen en código; las que sí (DNS/domain) quedan documentadas en `DOMAINS.md`.

### Cambios

#### Domains (operador): `DOMAINS.md`

- Arquitectura de subdominios documentada (4 apps + 1 tenant subdomain).
- Recomendación: **Cloudflare Registrar + Vercel DNS** (sin proxy CF al inicio).
- 5 pasos paso-a-paso con DNS records exactos, CNAMEs, dig + curl validation.
- Sección de **multi-tenant via subdomain** explicando cómo agregar 2º cliente.
- Sección de **email transaccional** con Cloudflare Email Routing para forwarding cero-costo.
- Triggers documentados para activar Cloudflare proxy WAF en futuro (cuando llegue bot abuse, 2º tenant, auditoría seguridad).

#### Rebrand 2.1 — packages

- `sed` masivo `@verdfrut/` → `@tripdrive/` en todos los TS/TSX/JSON/MD/MJS (215 archivos):
  ```bash
  find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" -o -name "*.mjs" \) \
    -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/.turbo/*" \
    -exec sed -i '' 's|@tripdrive/|@tripdrive/|g' {} +
  ```
- 8 `packages/*/package.json` con `name: @tripdrive/*`.
- 3 `apps/*/package.json` con dependencies actualizadas.
- 3 `next.config.ts` con `transpilePackages` actualizado.
- `pnpm install` re-resuelve workspace; type-check 10/10 garantizado.

#### Rebrand 2.2 — CSS vars (estrategia: aliases, no rename)

- **Decisión arquitectónica:** los `--vf-*` siguen siendo los "dueños" del valor. Los `--td-*` se agregan como **aliases** (`--td-green-700: var(--vf-green-700)`).
- 28 aliases nuevos en `:root` al final de `tokens.css`.
- Razón: rename masivo de 100+ call sites en código es alto riesgo, bajo valor. La identidad visual NO cambia. Solo agregamos opciones para código nuevo.
- Comentario header de `tokens.css` documenta la convención.

#### Rebrand 2.3 — cookie

- `theme.ts` server-side ahora lee `td-theme` PRIMERO, fallback a `vf-theme` legacy.
- `theme-toggle.tsx` client-side escribe `td-theme` y borra la legacy (`max-age=0`).
- Estrategia: preserva preferencia del usuario (no flash si ya tenía cookie vieja); migra al patrón nuevo cuando el usuario alterna el toggle por primera vez.
- En 30+ días productivos podemos eliminar el código de lectura legacy (issue #156).

### Alternativas consideradas

- *Cloudflare proxy desde día 1:* descartado para no comprometer features Vercel (Analytics, Speed Insights) y no complicar caché desde el inicio. Más fácil agregarlo después si llega abuso.
- *Vercel Registrar:* descartado por markup vs Cloudflare/Porkbun. Mismo resultado.
- *Rename completo de CSS vars (`--vf-*` → `--td-*`) con sed masivo:* descartado. 100+ call sites en JSX styles `style={{ color: 'var(--vf-text)' }}`. Cualquier typo o regex equivocado introduce regresiones visuales sutiles. Aliases es defensa en profundidad.
- *Subdominio dedicado por cliente desde el inicio (`{tenant}.tripdrive.xyz`):* sí está incluido (`verdfrut.tripdrive.xyz`), pero NO obligatorio. Los clientes pueden vivir bien en `app.tripdrive.xyz` con login segregando tenant. Subdominio branded es comodidad comercial, no requisito técnico.
- *Renombrar carpeta local `/Downloads/VerdFrut/` → `/Downloads/TripDrive/`:* descartado en este commit — el rename físico de la carpeta rompería el path en mi memoria local y muchos scripts hardcoded. El user puede hacerlo cuando guste; el código no asume la ruta.

### Riesgos / Limitaciones

- *Cookie legacy `vf-theme`* queda en navegadores de usuarios existentes. Si los borramos pronto, ven flash de tema. Mitigación: leer ambas durante un sprint.
- *La cookie nueva `td-theme` no se setea hasta que el usuario alterna el toggle.* Si nunca alterna, sigue usando la legacy. Aceptable porque el SSR ya muestra el tema correcto leyendo cualquiera de las dos.
- *Aliases CSS son indirección de 1 hop* — performance trivial pero existe. Browser resuelve `var(--td-green-700)` → `var(--vf-green-700)` → `oklch(...)`. Sin impacto medible.
- *No cambiamos cookies `sb-*` de Supabase* — esas las maneja el SDK y son ortogonales al rebrand.
- *Rename del repo GitHub `Verdfrut` → `TripDrive`* queda pendiente (acción del user). GH redirige automático, los webhooks/CI se actualizan solos. Vercel detecta el rename y actualiza el repo source.
- *Las pruebas con cliente real comienzan post-deploy de domains.* No podemos validar `app.tripdrive.xyz` hasta que el DNS propague (típicamente <10 min).
- *Los packages publicados a npm (si llegara el día)* no se ven afectados — todos son `private: true` en workspace.

### Oportunidades de mejora

- Issue #156: eliminar lectura de cookie `vf-theme` legacy tras 30 días productivos.
- Issue #157: migrar gradualmente call sites de `--vf-*` → `--td-*` cuando se toque cada componente.
- Issue #158: invertir dirección de los aliases (`--vf-*: var(--td-*)`) cuando la mayoría migre.
- Issue #159: rename de `tenants.json` path `/etc/verdfrut/` → `/etc/tripdrive/` cuando se haga deploy a VPS dedicado (Vercel actual no usa file system).
- Issue #160: configurar redirect 308 `tripdrive.com` → `tripdrive.xyz` si llegamos a comprar `.com`.
- Issue #161: validar que GitHub repo rename no rompe links externos en docs/issues/PRs ya creados.

## [2026-05-12] ADR-074: Stream C / Fase O1 — Re-optimización en vivo con Google Routes API

**Contexto:**
El optimizer actual usa Mapbox Distance Matrix para calcular tiempos de viaje
entre paradas. Mapbox no incluye tráfico real-time en MX (usa data TomTom +
crowdsourced). Cuando un chofer se atrasa por tráfico o llega una parada urgente,
no hay forma de re-secuenciar pendientes considerando las condiciones ACTUALES.

Google Routes API v2 (`directions/v2:computeRoutes`) sí ofrece tráfico real
basado en Waze + GPS Android. La diferencia operativa es significativa: en hora
pico CDMX, los tiempos reales son 30-50% mayores que los planeados con Mapbox.

**Decisión:**
Implementar endpoint nuevo `POST /reoptimize-live` en FastAPI que:
1. Recibe posición actual del chofer + lista de stops pendientes + shift_end.
2. Construye matrix N×N con Google Routes API (N×(N-1) calls en paralelo).
3. Pasa la matrix a VROOM con start=current_position.
4. Devuelve secuencia óptima + ETAs proyectadas.

UI: botón "🚦 Re-optimizar con tráfico actual" en `RouteStopsCard`, visible solo
en PUBLISHED/IN_PROGRESS. Confirm dialog menciona costo aproximado en USD para
desincentivar abuso casual.

Cooldown server-side de 30 min entre re-opts (consultado vía `route_versions`
con reason que matchea "Live re-opt"). Cuando se ejecuta, audit en
route_versions + push al chofer.

**Alternativas consideradas:**
1. **Migración total a Google Routes (planning + live)**: descartado por costo
   $865/mes a escala vs $200-300/mes del approach híbrido.
2. **TomTom o HERE en lugar de Google**: descartado por menor cobertura MX.
3. **Implementar tráfico propio con crowdsourced del driver**: descartado por
   masa crítica necesaria (5K+ choferes activos).

**Riesgos:**
- **Costo descontrolado**: 1 re-opt = N×(N-1) calls a $0.005 c/u. 20 stops
  = 380 calls = $1.90. Mitigación: cooldown 30min + confirm visible + cap GCP
  Budget Alert en $300 USD/mes.
- **Latencia API**: ~2-4s para matrix 15 stops. Mitigación: paralelización
  con asyncio.gather + timeout 20s en cliente platform.
- **Google API down**: NO hacemos fallback a haversine (perdería precisión que
  justificó el call). Falla fast con error claro al dispatcher.
- **Bucle infinito de re-opts**: imposible — cooldown 30min en server.

**Mejoras futuras:**
- Issue #162: Cache de matrix por (origin, destination, hour_of_day, day_of_week)
  con TTL 7 días. Reduce calls ~70% en operación recurrente.
- Issue #163: Re-optimización automática cuando chofer atrasa >15min (Fase O2).
- Issue #164: Predicción de ETAs por hora del día para sugerir shift óptimo
  (Fase O3, usa `departureTime` future de Google Routes).
- Issue #165: ML-learned `service_time_seconds` por tienda (Fase O4, NO usa
  Google Routes, solo histórico SQL).
- Issue #166: Restringir feature a Tier Pro+ cuando entre pricing multi-tier
  (hoy disponible para todos los tenants).
- Issue #167: Botón "Cancelar re-opt en curso" cuando latencia >5s.

## [2026-05-12] ADR-075: Stream B / Fase N1 — Scaffold app nativa Expo (Android-only)

**Contexto:**
El PWA driver actual (`apps/driver`) tiene limitaciones conocidas que afectan
operación real: tarda en cargar (Mapbox bundle 750 KB), iOS Safari mata
`watchPosition` al bloquear pantalla (#31), look genérico vs Waze/Google Maps,
push web limitado vs nativo. Plan de migración a app nativa documentado en
`STREAM_B_NATIVE_APP.md` con 9 fases (N1-N9).

Esta fase N1 establece el scaffold mínimo viable: el chofer puede instalar
la APK, hacer login con sus credenciales Supabase existentes, y ver una
pantalla placeholder con el roadmap. Cero feature operativo todavía — el
PWA actual sigue siendo la fuente de verdad hasta cutover en N9.

**Decisión:**
Crear nuevo workspace `apps/driver-native/` con:
- **Expo SDK 53 managed workflow** (no React Native bare): elimina necesidad
  de Xcode/CocoaPods/Gradle local, EAS Build compila en cloud.
- **Expo Router** file-based routing (paralelo conceptual a Next.js App
  Router que ya usamos en web).
- **TypeScript estricto** + `metro.config.js` con `watchFolders` apuntando
  al monorepo root + `disableHierarchicalLookup` para evitar conflictos
  de dependencias entre apps.
- **Bundle ID Android `xyz.tripdrive.driver`**: distinto del PWA legacy
  `com.verdfrut.driver` para que un chofer pueda tener ambas instaladas
  durante la transición sin conflicto.
- **Plataforma Android únicamente en V1**: confirmado por el 95% Android
  del primer cliente. iOS pospuesto, pero el código es portable (Expo
  soporta ambos sin cambios de lógica).
- **AuthGate centralizado en `_layout.tsx`** que escucha
  `supabase.auth.onAuthStateChange` y redirige entre `(auth)` y `(driver)`
  segmentos según sesión.
- **AsyncStorage** para persistir sesión Supabase (no cookies, no aplica
  en native).

**Alternativas consideradas:**
1. **React Native bare**: descartado por overhead de Xcode/Gradle local.
   Si Expo limita después, se puede ejectar.
2. **Capacitor wrapping del PWA actual**: descartado — hereda los problemas
   del PWA que justifican la migración.
3. **Flutter (Dart)**: descartado por curva de lenguaje + no comparte con
   el resto del monorepo TypeScript.
4. **Bundle ID `com.verdfrut.driver` reusable**: descartado porque al
   actualizar in-place Android pediría que el chofer desinstale la PWA
   primero. Mejor mantener ambos como apps separadas hasta cutover.

**Riesgos:**
- EAS Build free tier (30 builds/mes Android) puede no alcanzar si iteramos
  mucho en N2-N6. Mitigación: upgrade a Production tier $29/mes si el
  contador se acerca al límite.
- Compartir paquetes workspace puede romper en Metro si las versiones de
  React divergen entre apps/packages. Mitigación: `disableHierarchicalLookup`
  + tener React 19 declarado solo en `package.json` del driver-native.
- Bundle ID nuevo significa que NO hay update path desde la APK Bubblewrap
  existente. Mitigación: documentado, los choferes en N9 instalan nueva
  y desinstalan vieja.

**Mejoras futuras:**
- Issue #168: Mover credenciales Supabase a EAS Secrets cuando entremos
  a builds production (hoy en `.env.local` para dev local).
- Issue #169: Migrar `react-native-url-polyfill` cuando Expo SDK incluya
  fetch nativo apropiado (rumoreado para SDK 54+).
- Issue #170: Setup `expo-updates` (OTA) cuando arranque Fase N6 (beta).
- Issue #171: Compartir más packages workspace (`@tripdrive/ai`,
  `@tripdrive/utils`) cuando las pantallas de evidencia/chat lleguen (N4-N5).
- Issue #172: Tests E2E con Maestro o Detox cuando la app pase Fase N5.

## [2026-05-12] ADR-076: Stream B / Fase N2 — Pantalla "Mi ruta del día" con mapa nativo + cache offline

**Contexto:**
Fase N1 (ADR-075) entregó el scaffold: login funcional + pantalla placeholder.
N2 es la primera pantalla operativa real: el chofer debe ver su ruta del día
con mapa nativo arriba y lista de paradas abajo. La meta de N2 es que el
chofer pueda "abrir la app y entender qué le toca hoy" — todavía sin navegar
(N3) ni reportar (N4), pero con todos los datos visibles.

Dos decisiones técnicas relevantes salen aquí:
1. **Cómo se comparten los queries entre web driver y native driver** —
   ¿package compartido o duplicación?
2. **Cómo se cachean los datos para soportar conectividad intermitente** —
   los choferes operan en zonas con cobertura irregular en CDMX.

**Decisión:**

### 1. Queries duplicados, no package compartido

`apps/driver-native/src/lib/queries/route.ts` replica `getDriverRouteForDate`,
`getRouteStopsWithStores` y agrega `getRouteDepot` + `getDriverRouteBundle`.
La estructura row→domain es idéntica a `apps/driver/src/lib/queries/route.ts`.

Razón: el cliente Supabase es distinto entre los dos (anon-key + AsyncStorage
en native vs cookies SSR en web). Compartir requeriría inyectar el cliente
como dependencia, lo cual fuerza una abstracción que **no sabemos si vamos
a necesitar** hasta N3-N5 (donde se sumarán queries de stops, breadcrumbs,
chat). Aplicamos la regla de CLAUDE.md: "tres líneas similares es mejor que
una abstracción prematura". Cuando N5 cierre, evaluamos qué se mueve a un
package `@tripdrive/queries` y qué queda divergiendo.

### 2. Cache offline con AsyncStorage + stale-while-revalidate

Patrón:
- `src/lib/cache.ts` expone `readCache`, `writeCache`, `clearCacheNamespace`
  con versionado (`v1`) y TTL (24h default).
- `useRoute` hook lee cache primero al mount → muestra data inmediatamente
  con flag `isStale=true` → en paralelo hace fetch real → cuando llega lo
  guarda y limpia el flag.
- Si el fetch falla y había cache, se mantiene la cache + se muestra
  `ErrorBanner` con el mensaje del error.
- Si el fetch falla y NO había cache, queda `EmptyRoute` con botón "Reintentar".
- El cache key incluye `userId` + `date` — un chofer no ve cache de otro,
  y el cache de ayer no se confunde con el de hoy.

### 3. Mapa: react-native-maps con PROVIDER_GOOGLE

Pines con color por status (azul=pending, amarillo=arrived, verde=completed,
gris=skipped, morado=depot). `fitToCoordinates` ajusta bounds automáticamente
con padding de 40px. Tap en pin scrollea a la StopCard correspondiente y la
resalta con borde verde.

Sin clustering en V1 — N esperado < 30 stops por ruta. Si el primer cliente
escala a rutas más densas, abrimos issue #174 para clustering.

### 4. Config dinámica: app.config.js extiende app.json

Convertimos config estática (`app.json`) en config dinámica (`app.config.js`
que la extiende). Esto permite inyectar `GOOGLE_MAPS_ANDROID_API_KEY` desde
env vars sin commitearla. Mismo patrón aplica a `EXPO_PUBLIC_SUPABASE_URL`
y `EXPO_PUBLIC_SUPABASE_ANON_KEY` que `src/lib/supabase.ts` ya leía.

**Alternativas consideradas:**

1. **Package `@tripdrive/queries` con cliente inyectable**: descartado por
   prematuro. Volvemos al tema después de N5.
2. **expo-sqlite en lugar de AsyncStorage para cache**: descartado para N2.
   SQLite tiene sentido para el outbox de evidencia (N4) donde necesitamos
   queue ordenada con retry, no para cache de un bundle JSON pequeño.
3. **React Query / SWR para fetch + cache**: descartado por sobrecarga
   de dependencia para un único endpoint. El hook custom de 80 líneas hace
   exactamente lo que necesitamos sin dependencias.
4. **Mapbox SDK nativo en lugar de Google Maps**: descartado por costo MAU
   recurrente. Google Maps SDK Android es gratuito hasta 28K loads/mes vs
   ~$0.50 por 1000 MAU de Mapbox. La diferencia visual no justifica el costo
   para un mapa de overview.
5. **`@types/react@~19.0.0`** (heredado del scaffold N1): rompía type-check
   por incompatibilidad del JSXElementConstructor con forward-refs de RN.
   Bumpeado a `~19.2.0` que ya estaba en el monorepo via otras apps.

**Riesgos:**

- **Google Maps API key sin "Maps SDK for Android" habilitado**: el mapa
  renderiza gris. El user ya tiene una key con permisos Routes + Geo
  (usada por el optimizer y geocoding); requiere habilitar Maps SDK for
  Android en GCP Console para que esta pantalla muestre tiles. Sin esto,
  pines y depot siguen visibles sobre fondo gris — funcional pero feo.
- **Performance con 30+ pines**: `tracksViewChanges={false}` mitiga gran
  parte del impacto. Si reportan lag, abrimos issue #174 (clustering).
- **Cache stale después de cambio de ruta del dispatcher**: el chofer puede
  ver la versión vieja hasta que la red responda. Mitigación: `isStale` lo
  marca visualmente con banner amarillo. En N5 (chat + push) podemos
  invalidar el cache al recibir push del dispatcher.
- **Cache key incluye fecha local del tenant**: si el chofer cruza
  medianoche con la app abierta, no auto-refresca. Aceptable — siguiente
  refresh (pull-to-refresh, regreso a foreground en N3) lo arregla.

**Mejoras futuras:**

- Issue #173: Botón "Más info" en StopCard que abre bottom-sheet con
  contacto + ventana horaria + demanda (preparación para N3).
- Issue #174: Clustering de pines cuando N > 30 stops en mismo bounds.
- Issue #175: Pull-to-refresh con feedback háptico (expo-haptics).
- Issue #176: Snapshot test del RouteMap con datos sintéticos cuando
  agreguemos test suite (referenciado en KNOWN_ISSUES #145).
- Issue #177: Invalidar cache al recibir push del dispatcher (N5).
- Issue #178: Migrar `@tripdrive/queries` cuando N5 cierre y veamos
  qué realmente se comparte vs diverge entre web/native driver.

## [2026-05-12] ADR-077: Stream B / Fase N3 — GPS background + detalle de parada + Navegar deeplink

**Contexto:**
Después de N2 el chofer ya ve su ruta del día pero no puede operar: no abre el
detalle de cada parada, no puede pedir guiado a Waze/Google Maps, no puede
marcar llegada, y su supervisor no lo ve moverse. N3 cierra esa brecha.

Tres áreas técnicas relevantes:
1. **Validación de "Marcar llegada"** — anti-fraude geo: ¿client-side o server-side?
2. **GPS background tracking** en Android 12+ con foreground service obligatorio.
3. **Deeplinks de navegación** — qué app de mapas se lanza desde "Navegar".

**Decisión:**

### 1. "Marcar llegada" con validación geo client-side (por ahora)

`src/lib/actions/arrive.ts` implementa `markArrived(ctx)` que:
- Pide permiso foreground si falta.
- Lee GPS con `Location.getCurrentPositionAsync({ accuracy: High })` + timeout 15s.
- Calcula `haversineMeters` vs `store.lat/lng`.
- Si distancia > 300m (`ARRIVAL_RADIUS_METERS_ENTREGA`), devuelve rejection con
  distancia exacta y umbral — la UI muestra "estás a 2.3km, acércate".
- Si OK, hace `UPDATE stops SET status='arrived', actual_arrival_at=now()`.
- Si la ruta estaba PUBLISHED, también la promueve a IN_PROGRESS.

Idempotente: si el stop ya está `arrived` o `completed`, devuelve ok=true.

**¿Por qué client-side, sabiendo que el web la tiene server-side?**
Porque en native NO tenemos server actions gratis como Next.js. Re-crear esa
infra (Edge Function de Supabase para `markArrived`) tiene costo en build,
deploy y test que no se justifica para el primer cliente (NETO, choferes
empleados directos, modelo de confianza). RLS sigue protegiendo el UPDATE.

**Cuándo migrar a server:** cuando entren clientes con choferes 3P (outsourcing)
donde el incentivo a marcar llegada falsa es real. Issue #179 abierto para
mover la validación a una Edge Function `arrive-at-stop`.

### 2. GPS background con `expo-location` + `TaskManager` + foreground service

`src/lib/gps-task.ts` implementa el patrón estándar Expo:
- `TaskManager.defineTask(GPS_TASK_NAME, callback)` registrado top-level
  (importado desde `app/_layout.tsx` como side-effect).
- `Location.startLocationUpdatesAsync` con `accuracy: High`, `distanceInterval: 20`,
  `timeInterval: 10000`, y `foregroundService` config (notif persistente
  "TripDrive — siguiendo tu ruta", obligatoria en Android 12+ API 31).
- El task callback lee state (`routeId`, `driverId`) de AsyncStorage cada vez —
  no asume que la memoria del JS engine sobrevivió. Si no hay state, se
  auto-detiene.
- Throttling: persiste un breadcrumb a `route_breadcrumbs` cada 30s (vs 90s
  del web), ignorando todos los fixes intermedios.

**¿Por qué SÓLO breadcrumbs y no Realtime broadcast como en el web?**
Mantener una conexión WebSocket Supabase Realtime estable en background es
frágil. El OS duerme la red, el WS muere, re-subscribirse en cada wake-up
del task es lento + costoso. Los breadcrumbs cumplen el rol "supervisor ve
al chofer moverse" con ~30s de lag — degradación aceptable vs los 8s del
broadcast del web. Si reportan que se siente lento, agregamos Realtime sobre
breadcrumbs en un sprint chico (issue #180).

**¿Cuándo se enciende?**
Sólo cuando `route.status === 'IN_PROGRESS'` Y tenemos `driverId`. PUBLISHED =
chofer aún no llegó a la primera parada → no consumimos batería. En cuanto
marca primera llegada, route pasa a IN_PROGRESS, `useGpsBroadcast` lo detecta
y arranca el task. Al cerrar sesión, `signOut()` lo detiene.

**Indicador visual** en `RouteHeader`: barra de color verde "GPS activo —
supervisor te ve en vivo", roja si denegado, amarilla si falló start.

### 3. Deeplinks: Waze → geo: → Google Maps web (fallback)

`src/lib/deeplinks.ts` con `openNavigationTo({ lat, lng, label })`:
1. Intenta `waze://?ll=lat,lng&navigate=yes` — Waze es el favorito del
   chofer mexicano (tráfico real-time + reportes comunitarios).
2. Si Waze no está, en Android prueba `geo:lat,lng?q=lat,lng(label)` que
   abre el picker del sistema (Google Maps, Maps.me, lo que tenga el user).
3. Si todo falla, abre `google.com/maps/dir/?api=1&destination=lat,lng` en
   browser — el intent handler de Android delega a la app de Google Maps
   si está instalada, o al browser si no.

NO hardcodeamos Google Maps directo porque algunos choferes ya tienen Waze
como default y queremos respetarlo.

**Alternativas consideradas:**

1. **Server action via Edge Function para markArrived**: descartado por costo
   inicial; documentado para migración futura cuando entren choferes 3P.
2. **expo-background-fetch en lugar de TaskManager**: descartado — está
   diseñado para fetches periódicos discretos, no para streams continuos de
   location. expo-location + TaskManager es el camino oficial.
3. **Mantener broadcast Realtime en bg**: descartado por fragilidad de WS en
   bg sin foreground service real para Realtime. Los breadcrumbs son
   suficientes hasta que reporten.
4. **Geofencing nativo con `Location.startGeofencingAsync`**: descartado
   para V1. Es otra área de complejidad (registrar regiones por cada stop,
   manejar enter/exit, throttling). Auto-detección de arrival queda
   deferred a issue #181 — el botón "Marcar llegada" manual ya cubre.
5. **Hardcodear Google Maps directo**: descartado por respeto al default
   del chofer (muchos prefieren Waze para tráfico CDMX).
6. **Pasar `coords` de `useGpsBroadcast` al botón Marcar llegada**:
   descartado para evitar acoplar el detalle de stop con el bg task.
   `markArrived` lee su propio fix puntual (más fresco) con
   `getCurrentPositionAsync`. Trade-off: 1 lectura GPS extra.

**Riesgos:**

- **Permiso `ACCESS_BACKGROUND_LOCATION` en Android 11+** requiere flujo
  de 2 pasos: primero conceder foreground, luego ir a settings y elegir
  "Permitir todo el tiempo". Algunos choferes pueden quedarse en "Solo
  mientras la app esté abierta" y romper el bg tracking. Mitigación:
  `RouteHeader` muestra banner rojo "Permiso de ubicación denegado" para
  que el supervisor lo detecte y guíe al chofer por WhatsApp.
- **Foreground service notif persistente** puede molestar al chofer
  ("¿por qué hay notificación todo el día?"). Copy claro en la notif lo
  mitiga + se apaga automáticamente al `signOut` o cuando ruta deja de
  IN_PROGRESS. Educación inicial: documentar en onboarding.
- **Battery drain** con `accuracy: High` + `distanceInterval: 20m` +
  `timeInterval: 10s`: en pruebas piloto medir consumo. Si > 5%/h ajustamos
  a `Balanced` accuracy o aumentamos intervals.
- **Race condition en signOut**: el bg task puede estar a mitad de un
  insert cuando se llama `stopGpsTask`. RLS rechazará el insert post-logout,
  pero el task ya sale en la siguiente iteración cuando no encuentra state.
  Hay un breve gap donde fallan warnings (cosmético, no funcional).
- **App killed por OS** (Doze mode / battery saver agresivo en algunas
  marcas como Xiaomi/Huawei): el foreground service ayuda pero no es
  garantía total. Issue #182 abierto para documentar workarounds por marca.
- **Anti-fraude geo client-side**: el chofer puede usar mock-location en
  Dev Options para falsear llegada. Para detectarlo, futuro: pasar
  `pos.mocked` (Android-only, expo-location lo expone) al backend en
  metadata del stop y alertar al supervisor.
- **Validación falsa por GPS pobre indoors**: lectura inicial puede ser
  500m+ desviada antes de fix. El timeout 15s + radius 300m da margen
  para que el chofer obtenga fix bueno. Si falla, mensaje claro "sal a
  un lugar abierto".

**Mejoras futuras:**

- Issue #179: Mover `markArrived` a Edge Function Supabase + validar
  `pos.mocked` en metadata.
- Issue #180: Realtime broadcast sobre breadcrumbs cuando el supervisor
  pida ver al chofer "en vivo" con < 30s de lag.
- Issue #181: Auto-detección de llegada por geofencing
  (`Location.startGeofencingAsync` + radius 50m).
- Issue #182: Doc por marca/OEM sobre cómo deshabilitar battery
  optimization para TripDrive (Xiaomi, Huawei, Samsung).
- Issue #183: Indicador de "última posición enviada hace Xs" en el
  RouteHeader cuando el supervisor reporta lag.
- Issue #184: Caching defensivo del `getStopContext` (hoy hace 3 reads
  cada vez que el chofer abre detalle).
- Issue #185: Pre-fetch del detalle de la próxima parada (la pending) al
  cargar /route — sería tap instantáneo.

## [2026-05-12] ADR-078: Deeplinks de navegación — Waze first, geo: fallback

**Contexto:**
ADR-077 cubre la decisión de qué apps soportar y por qué. Este ADR documenta
la justificación específica del orden de preferencia para que futuras
sesiones no la reviertan accidentalmente.

**Decisión:**
Orden de intento al pulsar "Navegar" en `/stop/[id]`:
1. **Waze** (`waze://?ll=lat,lng&navigate=yes`) — primer intento.
2. **`geo:` URI** Android estándar — picker del sistema.
3. **Google Maps web HTTPS** — fallback último.

**Por qué Waze primero (no Google Maps):**
- Cobertura de tráfico CDMX/MX en Waze supera la de Google Maps Live
  Traffic (datos crowdsourced de mismos usuarios, no de smartphones Android
  genéricos).
- Cultura local: la mayoría de choferes ya usan Waze por costumbre. Forzar
  Google Maps obliga a re-aprender.
- Google Maps queda accesible vía el `geo:` picker si lo prefieren.

**Alternativas consideradas:**
- Hardcodear Google Maps: descartado (ver arriba).
- Dejar que el chofer elija en Settings cuál app usar como default:
  innecesario — el OS Android ya recuerda la elección del picker `geo:`.
- Integrar nuestra propia navegación turn-by-turn con Mapbox Navigation
  SDK: descartado (decisión 2026-05-12 en PLATFORM_STATUS sección 9:
  "navegación turn-by-turn delegada a Waze/Google Maps nativo, no propia").

**Riesgos:**
- iOS no tiene `geo:` estándar; cuando entre iOS (post Android-only V1)
  hay que agregar `LSApplicationQueriesSchemes` con `waze` y `comgooglemaps`
  en Info.plist + usar URLs específicas. Documentado en `lib/deeplinks.ts`.

**Mejoras futuras:**
- Issue #186: Telemetría — qué % de tappers en "Navegar" terminan en Waze
  vs geo: picker vs HTTP. Si HTTP fallback es >10%, algo está roto y
  necesitamos investigar.

## [2026-05-12] ADR-079: Stream B / Fase N4 — OCR proxy via platform (no llamar Anthropic desde el cliente)

**Contexto:**
La Fase N4 introduce la captura del ticket del cliente. El flujo deseado es:
chofer toma foto → app extrae datos con Claude Vision → chofer confirma/edita
→ guarda en `delivery_reports.ticket_data`.

La pregunta técnica clave: ¿quién llama a Anthropic API? Las opciones son
(a) directo desde la app nativa con `ANTHROPIC_API_KEY` embebida en el bundle,
o (b) proxiar a través de un endpoint del platform.

**Decisión:**
Opción (b) — nuevo endpoint **`POST /api/ocr/ticket`** en `apps/platform/`
que recibe `{ imageUrl }`, valida JWT del chofer, valida que el usuario sea
un row en `drivers`, aplica rate limit (30/hora/chofer), y delega a
`extractTicketFromImageUrl` de `@tripdrive/ai` (ya existente para el web).

Nuevo helper en `@tripdrive/supabase`: `createJwtClient(jwt)` para route
handlers que reciben `Authorization: Bearer <jwt>` (vs cookie-based de SSR).

Cliente native: `src/lib/ocr.ts` con `extractTicket(imageUrl)` que llama al
endpoint con el JWT de la sesión y devuelve `OcrResult` discriminado
(`ok`/`reason`). La pantalla degrada a entrada manual si reason ∈
{unavailable, timeout, error}.

**Por qué proxy y no key embebida:**

1. **Seguridad**: la API key en un APK es trivial de extraer (`unzip apk`
   → buscar en bundle JS). Un atacante puede quemar nuestro presupuesto
   Anthropic en minutos.
2. **Rate limit centralizado**: usamos `tripdrive_rate_limit_check` RPC
   (ADR-054) para acotar 30 OCRs/hora/chofer. Sin proxy no podríamos.
3. **Auditoría**: el endpoint puede loggear cada llamada con el `userId`
   para detectar patrones de abuso.
4. **Misma key que el web** (`ANTHROPIC_API_KEY` en Vercel del platform).
   Sin duplicación de billing.

**Alternativas consideradas:**

1. **API key embebida con scope/spend limits en GCP/Anthropic Console**:
   descartado — los limits son agregados, un atacante igual puede agotar
   nuestro presupuesto mensual. Seguro = no exponer la key.
2. **Edge Function de Supabase** en lugar de endpoint del platform:
   descartado por inercia — el platform ya tiene `@tripdrive/ai` instalado
   y el patrón route handler es familiar. Edge Functions agregan otro
   deploy target.
3. **Endpoint sin rate limit** (delegar todo al usage limit de Anthropic):
   descartado — si la app entra en un loop bug, el cliente paga la cuenta.
4. **Llamada desde el bg worker del outbox**: descartado — el OCR es UX-
   inmediato (chofer espera ~3s viendo spinner). Hacerlo offline obligaría
   a chofer entrar datos manual sin saberlo, y al sync se sobreescribirían.

**Riesgos:**

- **`ANTHROPIC_API_KEY` aún no seteada en Vercel** (pendiente del user
  desde Sprint H1). Mientras tanto el endpoint devuelve 503 y la UI muestra
  "OCR no disponible — confirma manualmente". Aceptable como modo
  degradado.
- **Costo por OCR**: Claude Sonnet 4.6 cobra ~$3/M input tokens. Una foto
  de ticket (típico ~1500 tokens encoded) = $0.005 por extracción. 30/h ×
  10 choferes × 8h = 2400 calls/día → $12/día. Si el primer cliente
  excede esto, ajustamos rate limit o cacheamos.
- **Latencia**: 2-4s extra al submit del ticket. Mitigado: la pantalla
  muestra spinner "Leyendo ticket…" y NO bloquea — el chofer puede
  ignorar el OCR result y submit manual.
- **Foto mal capturada**: Claude devuelve `confidence < 0.5` con muchos
  null. La UI muestra `confidence%` para que el chofer decida re-tomar.

**Mejoras futuras:**

- Issue #187: Telemetría de OCR confidence — promediar por chofer/tienda
  para detectar quien necesita re-entrenamiento sobre cómo enfocar la
  cámara.
- Issue #188: Cache OCR por `imageUrl` hash — si el chofer reintenta el
  submit sin retomar foto, no re-OCRamos.
- Issue #189: Streaming responses para mostrar campos a medida que
  Claude los extrae (mejora percibida de latencia).

## [2026-05-12] ADR-080: Stream B / Fase N4 — Outbox offline con expo-sqlite + single-screen entrega

**Contexto:**
La N4 lleva el flujo de evidencia al native. Tres cuestiones técnicas grandes:

1. **¿Multi-step wizard como el web o single-screen?**
2. **¿Cómo soportar offline?** El chofer en CDMX pierde señal entre tiendas;
   no debe perder la entrega si la red cae al submit.
3. **¿Dónde viven las fotos durante el wait?** El bundle del proceso puede
   morir entre captura y upload.

**Decisión:**

### 1. Single-screen evidence (no wizard de 10 pasos)

`app/(driver)/stop/[id]/evidence.tsx` es UNA pantalla con secciones:
- (1) Foto del exhibidor — required.
- (2) Foto del ticket + OCR opcional + editor de fields (número/fecha/total).
- (3) Toggle "¿Hubo merma?" → foto + descripción.
- (4) Toggle "¿Otro incidente?" → descripción libre.
- Botón "Enviar entrega" → encola al outbox, vuelve a `/route`.

El web tiene un flow-engine con 10+ pasos (arrival_exhibit, incident_check,
product_arranged, waste_check, receipt_check, …) para `type='entrega'`.
Replicar eso en native sería deuda significativa sin ROI claro:
- En el web es necesario porque cada step persiste server-side y se puede
  recuperar si el chofer cierra el tab. En native el state vive en
  AsyncStorage/SQLite — la pantalla puede recuperar todo.
- El chofer prefiere "una sola pantalla con todo" sobre "ir y volver".
- 80% de las entregas son felices y no necesitan los branches del wizard.

**Lo que NO cubrimos en N4 (deferred):**
- `type='tienda_cerrada'` y `type='bascula'` — flujos secundarios que
  el web maneja con sus propios wizards (facade/scale → chat_redirect →
  tienda_abierta_check). Issue #190 para N4-bis.
- Multi-paso `incident_cart` que abre chat con supervisor antes de seguir.
  Issue #191 — entra con N5 (chat).
- Productos individuales con `IncidentDetail[]` (rechazo/faltante/sobrante
  por SKU). El web tiene UI completa. En native lo guardamos sólo como
  descripción libre. Issue #192.

### 2. Offline-first via outbox SQLite

`src/lib/outbox/` con 4 archivos:
- `db.ts` — `expo-sqlite` async API, tabla `outbox(id, type, status, payload,
  attempts, last_error, last_attempt_at, created_at)`. Índices por status
  y created_at.
- `types.ts` — `OutboxItem`, `OutboxStatus`, payload tipado por `OutboxOpType`.
- `queue.ts` — `enqueueSubmitDelivery()` copia las fotos a
  `documentDirectory/outbox/{id}/` (persistente) antes de insertar.
  `subscribe()` para que la UI reaccione a cambios.
- `worker.ts` — singleton que:
  - Resetea items `in_flight` huérfanos al start (recovery post-crash).
  - Poll cada 30s + kick inmediato en cambio de NetInfo `isConnected`.
  - Procesa items `pending` o `failed` listos para retry según backoff
    exponencial (5s → 30s → 5min → 30min, cap 1h).
  - Max 10 attempts antes de dead-letter (`failed` permanente).

El handler `handleSubmitDelivery` orquesta el commit a Supabase:
1. Upload exhibit → bucket `evidence` (público).
2. Upload ticket → bucket `ticket-images` (privado, signed URL 1 año).
3. Upload merma (si aplica) → `ticket-images`.
4. `INSERT delivery_reports` con `status='submitted'`,
   `resolution_type='completa'`, todas las URLs + ticketData + flags.
5. `UPDATE stops SET status='completed'`.
6. Si todas las stops done → `UPDATE routes SET status='COMPLETED'`.

**Idempotencia:** cada paso es retry-safe.
- Uploads usan path determinístico `{slot}-{op.createdAt}.jpg` — si retry
  llega después de éxito silencioso, Storage devuelve "Duplicate" que
  interpretamos como already-uploaded.
- INSERT delivery_reports tiene UNIQUE(stop_id); duplicate violation =
  already-applied, seguimos al UPDATE stops.
- UPDATE stops/routes con `SET status=...` son idempotentes por naturaleza.

**Indicador UI** en `RouteHeader`: barra azul "📤 N envíos pendientes"
o amarilla "⚠ N envíos con error · M en cola" si hay failed. Sólo se
renderiza si hay algo en cola (cero ruido cuando todo está sincronizado).

### 3. Persistent storage de fotos

`expo-image-picker` devuelve URIs en `cacheDirectory` que el OS puede
limpiar bajo presión. Antes de encolar, `queue.persistPhoto()` copia las
fotos a `documentDirectory/outbox/{opId}/{slot}.jpg` que el OS NO toca.
Al marcar `done`, el worker borra el directorio completo.

**Alternativas consideradas:**

1. **IndexedDB-like en SQLite (BLOB columns)**: descartado — guardar
   imágenes como BLOB infla la DB y satura el row cache. Mejor: file
   system + path reference en SQLite.
2. **AsyncStorage en lugar de SQLite**: descartado — AsyncStorage es
   un single-key blob, no soporta queries/índices. Para una queue con
   filtros por status + ordenamiento por created_at, SQLite gana.
3. **React Query mutations con `persistor`**: descartado por overkill.
   Una sola op type no justifica la complejidad de React Query.
4. **Encolar fotos individuales (1 op por foto) + 1 op de submit final**:
   descartado — el submit final podría arrancar antes de que terminen
   las fotos por race. Mejor: 1 op atómica que sube todo + crea report.
5. **Background fetch task para sync** (vs polling foreground): descartado
   por ahora. El polling 30s + NetInfo trigger es suficiente para foreground;
   bg sync agresivo requiere otro foreground service Android. Si reportan
   que items quedan stuck con app cerrada, lo retomamos.

**Riesgos:**

- **Race del worker entre tabs/instancias de la app**: no aplica en
  native (1 sola instancia por proceso). En el web sí tendrían que
  manejarlo.
- **JWT expira durante un retry largo**: los Bearer tokens de Supabase
  expiran. supabase-js refresca automáticamente con el refresh token
  guardado en AsyncStorage. Si el refresh también murió (chofer offline
  > 1 mes), el insert falla por auth y el item queda `failed`. Recovery:
  el chofer logea de nuevo y los items se reintentan.
- **Espacio en disco lleno** (cacheDirectory + documentDirectory): la
  copia a documentDirectory duplica espacio temporalmente. Para 10
  fotos de 2MB cada una, +20MB. Aceptable en Android medio (>10GB free).
- **Fotos quedando huérfanas si el item se borra de SQLite manualmente**:
  no hay garbage collector automático del FS. Si reportan, agregamos
  un sweep al worker init que borre `outbox/*/` sin item correspondiente.
- **OCR corre online antes del enqueue** — si el chofer está offline al
  capturar ticket, no hay OCR, se quedan los campos vacíos y el chofer
  los llena manual. El submit igual encola y procesa cuando hay red.
- **Photos enormes desde dispositivos modernos** (Samsung S23 saca 50MP
  → 6-12MB original): expo-image-manipulator comprime a 1600px lado largo +
  JPEG 78% → ~300-500KB. La compresión corre antes de persistir al
  outbox, no después.
- **`UNIQUE(stop_id)` en delivery_reports** vs el caso de re-tomar la
  decisión: si el chofer reportó pero quiere corregir, hoy NO puede
  desde la app. El supervisor puede editar via web. Issue #193.

**Mejoras futuras:**

- Issue #190: `type='tienda_cerrada'` + `type='bascula'` con sus respectivos
  flujos secundarios. Cubre el ~10% de visitas no felices.
- Issue #191: `incident_cart` con chat al supervisor antes de continuar
  (entra con N5).
- Issue #192: UI para reportar `IncidentDetail[]` por SKU (rechazo,
  faltante, sobrante).
- Issue #193: "Editar reporte enviado" — re-abre el outbox item si
  status='draft' o agrega un mecanismo de PATCH al supervisor.
- Issue #194: Compresión defensiva con timeout 5s (caso devices viejos
  donde manipulator se cuelga). Hoy la fallback es usar la imagen original
  sin comprimir.
- Issue #195: Notificar al supervisor cuando un item lleva >2h `failed`
  permanente (push o slack).
- Issue #196: Sweep al worker start que borre `outbox/*/` directorios
  cuyo opId ya no existe en SQLite.

## [2026-05-12] ADR-081: Stream B / Fase N5 — Push notifications nativas (Expo) + tabla compartida

**Contexto:**
Fase N5 introduce push notifications nativas para que el supervisor alcance
al chofer en su app Android. El web driver/platform ya usaba Web Push (VAPID)
con la tabla `push_subscriptions` (endpoint + p256dh + auth). La pregunta
técnica: ¿extendemos la tabla existente o creamos una nueva para Expo?

**Decisión:**

### 1. Extender `push_subscriptions` con `platform` + `expo_token`

Migración `00000000000034_push_subscriptions_expo.sql`:
- Nueva columna `platform TEXT NOT NULL DEFAULT 'web'` (CHECK in 'web'|'expo').
- Nueva columna `expo_token TEXT NULL`.
- Las columnas web-specific (`endpoint`, `p256dh`, `auth`) pasan a NULLABLE.
- CHECK constraint `push_subscriptions_payload_shape` que valida:
  - `platform='web'` ⇒ endpoint + p256dh + auth NOT NULL, expo_token NULL.
  - `platform='expo'` ⇒ expo_token NOT NULL, web fields NULL.
- UNIQUE index parcial `(user_id, expo_token) WHERE expo_token IS NOT NULL`.
- Index `(expo_token) WHERE NOT NULL` para lookup inverso si un cron invalida tokens.

**Backfill:** ninguno necesario. Las filas existentes son todas web; el
DEFAULT 'web' las cubre. Los expo tokens sólo aparecen cuando el native
empieza a registrar.

### 2. Fanout unificado en `push-fanout.ts`

El fanout existente (drive app) ahora trae ambos tipos en la misma query y
divide en dos paths:
- **`sendWebPushBatch`**: usa `web-push` lib como antes. Sin VAPID config →
  warn + skip silente. Tokens 404/410 se borran de la tabla.
- **`sendExpoPushBatch`**: usa `@expo/expo-server-sdk` con `Expo.chunkPushNotifications`
  (cap 100/chunk). Tokens con `DeviceNotRegistered` se borran. Errores otros
  van al logger.

Las dos funciones corren en `Promise.all` para no serializar el fanout.

### 3. Cliente native con `expo-notifications`

`src/lib/push.ts` con `registerPushAsync()` que:
1. Verifica `Device.isDevice` (los pushes no llegan en emulador).
2. Pide permiso (Android 13+ requiere POST_NOTIFICATIONS explícito).
3. Crea Android notification channel `default` con importance HIGH.
4. Obtiene `ExpoPushToken` via `getExpoPushTokenAsync({ projectId })`.
5. Resuelve `role` + `zone_id` del user via `user_profiles`.
6. Upsert al row `push_subscriptions` con `platform='expo'`, `expo_token=<token>`,
   web fields explícitamente null. ON CONFLICT (user_id, expo_token) DO NOTHING
   (idempotencia).

`unregisterPushAsync()` corre en `signOut` y elimina el row del device actual.

**Alternativas consideradas:**

1. **Tabla separada `expo_push_tokens`**: descartado por costo de mantenimiento.
   El fanout tendría que hacer 2 queries + 2 loops. Una tabla con discriminator
   `platform` mantiene la query simple.
2. **Polimorfismo via JSON column**: descartado por debilidad de tipos en TS
   y SQL. Columnas tipadas + CHECK constraint son más explícitas y fallan
   temprano si hay inconsistencia.
3. **OneSignal/Firebase Cloud Messaging directo**: descartado. Expo es un
   wrapper sobre FCM (Android) + APNS (iOS) que nos da:
   - Manejo automático de token rotation.
   - Mismo SDK para iOS (sin código extra cuando entre iOS post V1).
   - SDK server-side simple (`@expo/expo-server-sdk`).
   El trade-off es depender de la relay de Expo (gratis hasta 600/sec).
4. **Encriptar payload del push**: descartado. Los pushes contienen sólo
   metadata (reportId, url). El contenido sensible vive en la app tras
   tap → fetch real.

**Riesgos:**

- **Sin EAS projectId configurado** (`PENDING_EAS_PROJECT_ID` actual):
  `getExpoPushTokenAsync` falla con mensaje claro. La pantalla muestra
  "Falta projectId de EAS. Corre `pnpm eas:configure`." y el usuario sigue
  usando la app sin recibir push. No bloquea login ni operación.
- **Permiso POST_NOTIFICATIONS denegado** (Android 13+): el user_profile
  no tiene token, supervisor no le alcanza. UI documenta status pero no
  fuerza re-pedido — Android no permite re-prompt sin ir a Settings. Issue
  abierta para banner persistente.
- **Migration NO aplicada todavía en BD**: el archivo SQL existe pero el
  user debe aprobar `apply_migration` MCP. Sin aplicar, registerPushAsync
  falla con `column "platform" does not exist`. Está documentado en el
  handoff.
- **Tokens stale** (chofer reinstala app): Expo invalida el viejo, el
  endpoint `getExpoPushTokenAsync` devuelve uno nuevo, el upsert lo registra,
  pero el viejo queda como zombie hasta que un push intente alcanzarlo y
  reciba `DeviceNotRegistered` → entonces lo limpiamos. Aceptable, no afecta
  funcionalidad.
- **Rate limit de Expo Push Service** (600 msg/sec): no debería tocarse
  con un solo cliente. Si llegamos, chunkPushNotifications + retry con
  backoff resuelve.

**Mejoras futuras:**

- Issue #200: Banner persistente en RouteHeader si push no está registrado
  (`registrationResult.ok === false`), con CTA "Activar notificaciones" que
  abre Settings del OS via `Linking.openSettings()`.
- Issue #201: Push handler con deeplink — tap en notif del chat abre
  directo `/(driver)/stop/<stopId>/chat`. Hoy sólo `console.log`. Necesita
  resolver `reportId → stopId` y router push.
- Issue #202: Push del supervisor al chofer cuando el supervisor responde
  en chat — hoy SÓLO el push fanout del *driver* envía al supervisor.
  Falta el inverso: cuando supervisor inserta mensaje desde platform/web,
  trigger fanout al chofer. Requiere extender el endpoint de send message
  en platform.
- Issue #203: Tipos de push (`chat_new`, `route_updated`, `arrival_reminder`)
  para que el handler haga routing distinto por tipo.

## [2026-05-12] ADR-082: Stream B / Fase N5 — Chat native: realtime postgres_changes + insert directo sin AI mediator

**Contexto:**
N5 lleva el chat chofer↔supervisor al native. El web tiene una server action
robusta (`sendDriverMessage`) que: 1) valida texto, 2) corre rate-limit,
3) inserta el message, 4) corre AI mediator (Claude classifyDriverMessage)
que auto-responde a triviales o escala a zone_manager, 5) dispara push fanout.

La pregunta técnica: ¿cómo replicar en native sin server actions Next.js?

**Decisión:**

### 1. Insert directo via Supabase con RLS protegiendo (sin proxy)

`src/lib/actions/send-message.ts` hace `supabase.from('messages').insert(...)`
con `sender='driver'` + `sender_user_id=auth.uid()`. La policy `messages_insert`
(migración 018) valida que el chofer no pueda mentir sobre su rol. El trigger
`tg_messages_open_chat` server-side setea `chat_opened_at`/`timeout_at` al
primer mensaje — eso no cambia.

**Lo que SE PIERDE vs web:**
- **AI mediator** (`classifyDriverMessage`) NO corre. Todos los mensajes del
  chofer escalan al supervisor — sin auto-respuestas de Claude para triviales.
- **Push fanout** al supervisor NO se dispara desde el insert. El trigger
  server-side existe pero sólo abre el chat (campos `chat_opened_at`), no
  dispara webhook/fanout.

**Mitigación temporal:**
- El supervisor sigue viendo el chat en realtime via su web/platform — no
  pierde mensajes, sólo no recibe push hasta que llega un chofer-web user.
- En operación con NETO (primer cliente), el supervisor está pegado al
  dashboard durante la jornada — viendo el chat sin push es viable.

**Cuándo migrar a proxy (issue #198 + #202):**
- Cuando entren clientes con supervisor en mobile-only.
- Cuando reportemos que >X% de mensajes triviales escalan ruidosamente.

Mientras tanto, la opción más limpia para arreglar ambos limitaciones es
agregar un endpoint `POST /api/chat/messages` en el platform (similar al
proxy OCR de ADR-079) que: valida JWT, corre mediator, inserta, dispara
fanout. Native call → ese endpoint en lugar de Supabase directo.

### 2. Realtime con `postgres_changes` (idéntico al web)

`src/hooks/useChatRealtime.ts`:
- Subscribe a `supabase.channel('chat:{reportId}').on('postgres_changes', ...)`.
- Filter server-side `report_id=eq.{X}` + RLS adicional.
- Refetch on AppState `active` (recovery si el WS quedó dormido en bg).
- Dedup por id en caso de doble-deliver.

### 3. Pantalla `/stop/[id]/chat`

Estilo WhatsApp:
- FlatList de mensajes con bubbles diferenciadas por sender.
- KeyboardAvoidingView + TextInput multiline + botón Enviar.
- Auto-scroll al final on new message.
- Botón "Chat con supervisor" en `/stop/[id]/index` que sólo aparece si
  `stop.status ∈ ('completed', 'skipped')` (i.e., hay `delivery_report` row).

**Lo que se difiere a N5-bis:**
- Imagen attachment en chat → issue #199 (reusar evidence capture).
- Iniciar chat sin reporte previo (chofer pide ayuda antes de entregar) →
  necesita flow_engine work o auto-crear report `tienda_cerrada`.
- Marcar chat como `driver_resolved` desde native → button + action.

**Alternativas consideradas:**

1. **Proxy endpoint para insert** (replica del web): descartado por scope.
   Es la migración correcta cuando entren los limitantes de no-mediator y
   no-fanout. Doc en issue #198.
2. **Webhook Postgres → mediator + fanout**: descartado por complejidad.
   Requiere Edge Function de Supabase + manejo de retry. Cuando entre el
   proxy del punto 1, queda más limpio porque toda la lógica vive en un
   sitio.
3. **Replicar mediator client-side** (llamar Claude desde native con la
   API key en bundle): descartado por la misma razón que OCR (ADR-079) —
   key expuesta.
4. **Subscribe a `presence` en lugar de `postgres_changes`**: descartado.
   Presence sirve para "quién está online" no para sync de mensajes.

**Riesgos:**

- **Race con `tg_messages_open_chat`** trigger: el trigger es server-side
  síncrono dentro del mismo statement INSERT, así que el row vuelve con
  campos ya seteados. No hay race.
- **Realtime sin internet**: el channel falla silencioso, no llegan
  mensajes nuevos. Cuando vuelve la red, AppState 'active' → refetch.
- **Mensajes del chofer durante outage**: el insert falla, la UI muestra
  alert. Por ahora NO encolamos al outbox — el chofer tiene que reintentar
  manual. Issue #204 para llevar al outbox.
- **Supervisor responde mientras chofer no tiene red**: el mensaje queda
  en BD; cuando chofer vuelve a red, refetch lo trae. UX correcta.
- **Bubbles del supervisor sin foto/nombre**: sólo "Supervisor" estático.
  Sin context info aún (zone manager X vs Y). Aceptable para V1, mejorable.

**Mejoras futuras:**

- Issue #197: Mediator AI desde native via proxy endpoint platform.
- Issue #198: Push fanout al supervisor cuando native envía mensaje.
- Issue #199: Imagen en chat (reusar `captureAndCompress` + bucket).
- Issue #202: Push del supervisor → chofer (hoy sólo va en el otro sentido).
- Issue #204: Outbox para mensajes de chat (si falla insert, encolar).
- Issue #205: Indicador de typing del supervisor (Realtime presence channel).
- Issue #206: Marcar chat como `driver_resolved` desde native.

## [2026-05-13] ADR-083: Auditoría de seguridad N5+ y hardening pendiente

**Contexto:**
Post-cierre de N5, antes de que el primer chofer use la app native en operación
real (N6), hacemos un audit de seguridad sistemático. La operación con NETO es
con choferes empleados directos (modelo de confianza alta) pero al escalar a
3P/outsourcing los vectores de ataque cambian. Documentamos las medidas YA
implementadas y los gaps pendientes con su severidad.

**Decisión: medidas aplicadas en este ciclo (post-N5)**

### Rate limit en `sendMessage` del native (mitiga AV-#1, AV-#5)
`apps/driver-native/src/lib/actions/send-message.ts` ahora consume el RPC
`tripdrive_rate_limit_check` (ADR-054) con bucket `native-chat-send:{userId}`,
max 30/min. Antes era ilimitado — un chofer comprometido (cookie/JWT robado)
podía saturar al supervisor con miles de mensajes. Si el RPC falla por infra
caída, fail-open con warn al logger (preferimos perder rate-limiting que
bloquear al chofer legítimo).

### Geo-fix retroactivo: TOL-1422
Tienda importada del XLSX tenía coords (18.20, -98.05) — en Cuernavaca, no
Toluca. Re-geocodeada con Google Geocoding desde el address completo:
(19.2532, -99.7299) — Santa Cruz Cuauhtenco, Zinacantepec. Marcada
`coord_verified=false` (APPROXIMATE type, no ROOFTOP) para que la UI alerte.

**Estado del threat model actual**

| ID | Vector | Severidad | Estado | Mitigación actual / mejora futura |
|---|---|---|---|---|
| AV-#1 | Cookie/JWT theft → spam | Media | Mitigado parcial | Rate limit en sendMessage native ✓. Falta: reorderStopsAction native (issue #207). |
| AV-#2 | Service role bypass en driver web actions | Alta | Pendiente | Hoy service role expuesto server-side. Mejora: migrar a sesión del chofer + RLS por field (#63). |
| AV-#3 | Admin reorder sin verificación de zona | Baja | No aplica V1 | Modelo actual sin "admin de zona". Re-evaluar si entra modelo multi-zona. |
| AV-#4 | Info leak por sequence de stops | Muy baja | RLS cubre | Tenant aislado (1 Supabase por cliente). |
| AV-#5 | reason en push notif visible al chofer | Baja | Mitigado | Hoy hardcoded. Falta: sanitizar si entra input dinámico. |
| AV-#6 | Geocoding sin HTTPS verification | Media | Mitigado parcial | Anti-fraude geo (300m radius) bloquea spoof. Falta: anotar `geocode_source` en stores (#83). |

**Nuevos vectores identificados post-N5**

### AV-#7 — Mock location en Android (markArrived bypass)
- **Vector:** chofer activa Dev Options → Mock Location → falsea estar en la tienda → markArrived pasa la validación haversine.
- **Impacto:** medio. Permite check-in sin estar físicamente ahí. RLS valida que el stop sea suyo, pero no detecta mock.
- **Mitigación:** `expo-location` expone `pos.mocked` (Android-only). Persistir en `delivery_reports.metadata.arrival_mocked=true` + alertar al supervisor si frecuencia >5% por chofer.
- **Issue:** #208 (TODO en próximo sprint hardening pre-piloto).

### AV-#8 — `markArrived` validación client-side bypassable
- **Vector:** chofer ingeniero con tool de debug intercepta el call a Supabase y modifica el payload (skip validación geo).
- **Impacto:** medio. El UPDATE de `stops` lo valida RLS pero no el geo. Equivale a AV-#7 pero por otro medio.
- **Mitigación:** mover validación a Edge Function de Supabase (sigue siendo native-callable pero validación server-side imposible de saltar).
- **Issue:** #179 (ya documentado en ADR-077).

### AV-#9 — Cache de fotos en `documentDirectory` accesible a otras apps
- **Vector:** En Android sin SELinux estricto, una app con permiso de leer external storage podría leer `Android/data/xyz.tripdrive.driver/files/`.
- **Impacto:** bajo. Fotos del ticket pueden tener info comercial. Path por scoping de Android moderna (API 30+) está protegido.
- **Mitigación:** API 30+ aplica scoped storage automático. En API 29-, las fotos del outbox quedan accesibles. Documentamos minSdkVersion=30 como recomendación.
- **Issue:** #209.

### AV-#10 — Token Expo Push expuesto en push_subscriptions sin TTL
- **Vector:** atacante con acceso a service role obtiene la lista de Expo Push tokens → puede enviar push spoof.
- **Impacto:** bajo. Spoof solo afecta a UI del chofer (mensajes falsos), no a datos. Expo Push API valida que el sender tenga acceso al projectId — ataque requiere también robar projectId credentials.
- **Mitigación:** rotar `EXPO_ACCESS_TOKEN` 1×/año. No persistir tokens beyond 90 días sin uso.
- **Issue:** #210.

**Issues hardening pendiente para Sprint H8 (pre-piloto extendido)**

| # | Tarea | Por qué | Effort |
|---|---|---|---|
| #207 | Rate limit en `reorderStopsAction` native | AV-#1 ext | XS |
| #208 | Persistir `mocked` flag en arrival_coords metadata | AV-#7 | S |
| #179 | Edge Function para `markArrived` server-side | AV-#8 | M |
| #209 | Doc minSdkVersion=30 + scoped storage check | AV-#9 | XS |
| #210 | TTL en push_subscriptions inactivas >90d | AV-#10 | S |
| #63 | Migrar service_role usage a sesión + RLS field-level | AV-#2 | L |

**Riesgos:**
- **N6 piloto con AV-#7/#8 abiertos:** si NETO usa choferes empleados directos
  (modelo de confianza), riesgo aceptable. Si entra cliente con 3P/outsourcing,
  estos issues son P0.
- **Métricas de detección NO instrumentadas:** hoy no sabemos si AV-#7 está
  ocurriendo en operación real. Issue #211 para agregar dashboard con métricas
  de "% checkins con mocked=true" y "% con distancia >100m al store".

**Mejoras futuras (post-piloto)**
- Issue #211: Dashboard de métricas de fraude (mock %, distancia checkin, etc).
- Issue #212: WAF Cloudflare al frente cuando entren bots/abuse desde IPs externas.
- Issue #213: Pentest profesional antes de cliente Enterprise.
- Issue #214: Rotación automática de Service Role Key vía Vault o similar.

## [2026-05-13] ADR-084: Hardening round 2 — anti-fraude arrival + recalc ETAs + TTL crons + service role audit

**Contexto:**
Sesión de hardening post-N5 para "dejar todo listo para Stream A". 4
entregables que reducen deuda técnica y preparan el terreno multi-customer:

1. Anti-fraude metadata en arrival (mitigation AV-#7).
2. Bug-#L4 mitigation: re-calcular ETAs sin re-optimizar.
3. TTL crons para tablas que crecen sin tope (#53, #210).
4. Audit completo de `createServiceRoleClient()` usage.

**Decisión:**

### 1. Anti-fraude metadata en `stops` (mitigation AV-#7)

Nueva migración `00000000000035_stops_arrival_audit.sql`:
- `arrival_was_mocked BOOLEAN NULL` — popula con `pos.mocked` de expo-location.
- `arrival_distance_meters INT NULL` — distancia haversine al markArrived.
- `arrival_accuracy_meters FLOAT NULL` — precisión GPS reportada.

`markArrived` en native lee `pos.mocked` (Android-only via expo-location) y
lo persiste junto con el UPDATE de stops. Si es `true`, queda flag en BD para
que el supervisor + dashboards de fraude futuros detecten patrones.

Decisión consciente: NO bloqueamos el checkin si está mockeado. El stop sigue
marcando `status='arrived'`. La decisión de qué hacer con esto (alerta,
auto-rechazo, escalar a supervisor) queda en una Edge Function server-side
(issue #179) cuando llegue clientes con choferes 3P. Hoy con NETO (empleados
directos) el flag es solo audit.

### 2. Bug-#L4 mitigation: botón "Re-calcular ETAs"

`recalculateRouteEtasAction` en `apps/platform/src/app/(app)/routes/actions.ts`
expone la función existente `recalculateRouteMetrics` (que ya hace haversine
sobre el orden actual) como server action.

UI: cuando una ruta está post-publish (PUBLISHED/IN_PROGRESS) Y tiene
`version > 1` (i.e., admin reordenó), el banner amarillo "Las paradas se
reordenaron — ETAs son del orden original" ahora incluye un botón
"Re-calcular ETAs" que actualiza planned_arrival_at + planned_departure_at +
total_distance + total_duration sin tocar el orden ni llamar al optimizer.

Trade-off vs `reoptimizeLiveAction` (ADR-074):
- recalcEtas: barato, instantáneo, mantiene orden del admin.
- reoptimizeLive: usa Google Routes con tráfico real, recomendado en
  IN_PROGRESS para reaccionar a atraso real.
- El admin elige cuál aplicar según contexto.

### 3. TTL crons (#53, #210)

Dos endpoints nuevos en `apps/platform/src/app/api/cron/`:

- `chat-decisions-cleanup/route.ts` — DELETE rows de `chat_ai_decisions`
  con `classified_at < now() - 90 days`. Schedule sugerido: 1×/día.
- `push-subs-cleanup/route.ts` — DELETE rows de `push_subscriptions` con
  `created_at < now() - 90 days`. Schedule sugerido: 1×/semana.

Ambos usan el mismo patrón que crons existentes (header `x-cron-token`
vs `CRON_SECRET` + service role + logger.info on delete).

**Importante:** estos crons aún no están en el schedule del user. Cuando
el user agregue Vercel Cron (en lugar de n8n — recordatorio del memory),
debe incluir estos dos endpoints nuevos.

### 4. Service role audit (`SERVICE_ROLE_AUDIT.md`)

Documento nuevo que cataloga los 24 call-sites actuales de
`createServiceRoleClient()` en el monorepo, categorizados:

- ✅ Legítimo (23): crons, push fanout, AI mediator, user mgmt admin API,
  Control Plane, rate-limit helper, audit dashboard.
- ⚠️ Sospechoso (1): `driver/.../route/actions.ts:159` que escribe
  `route_versions` con bypass (AV-#2, issue #63).
- ? Investigar (1): `platform/.../dispatches/actions.ts:549` no obviamente
  justificado.

Plan de eliminación pre-Stream A con 7 issues priorizados (#63, #215-#221).
La métrica de éxito al finalizar Stream A es:
- 0 calls de service role que pueda servirse con sesión + RLS.
- Lint rule (`#221`) que prohíbe el uso fuera del allow-list documentado.

**Alternativas consideradas:**

1. **Mover validación arrival a Edge Function ahora** (issue #179): descartado
   por scope. El flag en BD ya permite detectar fraude post-hoc. La Edge
   Function es para BLOQUEAR fraude — espera a que llegue cliente con
   choferes 3P.
2. **Auto-aplicar recalculateRouteEtasAction** en cada reorder admin:
   descartado — ADR-035 decidió que el admin elige cuándo recalcular para
   no romper expectativa del chofer.
3. **Borrar service role usage del driver en este commit:** descartado por
   riesgo. Refactor de AV-#2 (route_versions) requiere migración SQL para
   nueva policy RLS + test cuidadoso. Pre-Stream A, no de oferta.

**Riesgos:**

- **`pos.mocked` solo en Android:** iOS no lo expone. Cuando entre cliente
  con flota iOS, el flag queda NULL — interpretable como "no detectable
  desde la app" no como "no mockeado". Mitigación: docs claros + dashboard
  filtra solo por mocked=true (NULL ≠ true).
- **TTL crons con retención 90d:** si un cliente Enterprise requiere
  retención más larga por compliance, configurable per-customer es trabajo
  Stream A. Hoy es global 90d.
- **`SERVICE_ROLE_AUDIT.md` es snapshot al 2026-05-13:** nuevos usos pueden
  agregarse y romper el audit. Issue #221 (ESLint rule) lo previene.

**Mejoras futuras:**

- Issue #222: Aplicar las migraciones 035 + la 034 (push_subs_expo) automáticamente
  en branches Supabase (no manual via MCP).
- Issue #223: Tests integration que validan que arrival_was_mocked se
  propaga correctamente desde markArrived al UPDATE.
- Issue #224: Dashboard `/admin/fraud-radar` con paneles de:
  - % stops con arrival_was_mocked=true por chofer/semana.
  - Distribución de arrival_distance_meters (alerta si <10m frecuente).
  - Distribución de arrival_accuracy_meters (alerta si >100m frecuente).



## [2026-05-14] ADR-085: Pre-Stream A — cerrar service_role bypass driver + guardrail de inventario

**Contexto:**
ADR-083 catalogó AV-#2 (driver service_role bypass) y ADR-084 produjo
`SERVICE_ROLE_AUDIT.md` con 24 call-sites + 2 sospechosos (S-1 platform
restructure, S-2 driver route). Stream A introduce RLS escalada por
`customer_id`; cualquier bypass restante desde código cliente del driver
es una potencial puerta abierta multi-tenant. Pre-condición técnica
documentada en `MULTI_CUSTOMER.md` antes de arrancar fase A1.

Adicionalmente, el audit dejó issue #221 abierto: lint rule contra nuevos
usos de `createServiceRoleClient()` fuera del allow-list, para evitar que
el inventario crezca silenciosamente durante el desarrollo de Stream A.

**Decisión:**

1. **AV-#2 / issue #63 — cerrado** vía RPC + refactor:
   - Migration 036 crea `bump_route_version_by_driver(p_route_id, p_reason)
     RETURNS INTEGER`, `SECURITY DEFINER`, `GRANT EXECUTE TO authenticated`.
   - La función valida: caller autenticado, caller es chofer, ruta pertenece
     al chofer, ruta en `PUBLISHED`/`IN_PROGRESS`, reason 1-200 chars.
   - Hace bump atómico de `routes.version` + insert `route_versions` con
     `FOR UPDATE` para evitar race conditions del bump concurrente.
   - `apps/driver/src/app/route/actions.ts:reorderStopsByDriverAction`
     elimina el import de `createServiceRoleClient` y usa
     `supabase.rpc('bump_route_version_by_driver', ...)` con la sesión del
     chofer.
   - `packages/supabase/src/database.ts` agrega la firma de la RPC al tipo
     `Database['public']['Functions']` (curado manualmente).

2. **Issue #218 — resuelto sin refactor** tras investigación:
   - `apps/platform/src/lib/queries/dispatches.ts:145`
     (`getDispatchByPublicToken`) es legítimo — vista pública sin sesión
     `/share/dispatch/[token]`. Reclasificado en `SERVICE_ROLE_AUDIT.md` en
     una nueva sección "lectura pública sin sesión".
   - `apps/platform/src/app/(app)/dispatches/actions.ts:549`
     (`tripdrive_restructure_dispatch`) es legítimo por diseño — la RPC fue
     declarada `SECURITY DEFINER` + `GRANT EXECUTE TO service_role` SOLO,
     deliberadamente bloqueada para sesión normal. La action ya hace
     `requireRole('admin', 'dispatcher')` antes. Se deja issue #226 para
     evaluar reabrir a `authenticated` con check de customer_id durante
     Stream A.

3. **Issue #221 — guardrail más simple que eslint flat config:**
   - El repo aún usa `next lint` default sin flat config compartido. Meter
     un `eslint.config.mjs` por app + plugin custom es overkill para una
     sola regla.
   - En vez de eso, `scripts/check-service-role.sh` + snapshot
     `scripts/service-role-allowlist.txt` con los 16 archivos autorizados.
   - El script falla si aparece un call-site nuevo NO listado, y advierte
     si un archivo del allow-list ya NO usa service_role (limpieza).
   - Expuesto como `pnpm check:service-role`. Pendiente: agregar al CI
     pre-merge cuando se monte el pipeline (issue #227).

**Alternativas consideradas:**

- **Expandir policy `routes_update` con OR para driver** que matchee
  `driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid())`. Se
  rechazó porque la policy aplica a TODA columna del UPDATE: un chofer
  malicioso podría reasignar `vehicle_id`, cambiar `status`, mover la fecha.
  La RPC es más estricta (solo bump version + audit).
- **Edge Function** para encapsular la operación. Más superficie de red
  + más latencia por un endpoint que en realidad solo necesita lógica
  Postgres. RPC SECURITY DEFINER es la solución idiomática.
- **ESLint flat config con `no-restricted-imports`** + plugin custom.
  Funcional pero requiere migrar 3 apps + 7 packages a flat config.
  Postergado a issue #228 (Stream A cleanup) — el bash script entrega
  el mismo guardrail hoy.

**Riesgos / Limitaciones:**

- **Migration 036 NO aplicada en prod aún** — el harness rechazó la
  aplicación directa por seguridad. Hay que correr `supabase db push`
  manual o autorizar el MCP `apply_migration` explícitamente. Hasta
  entonces, la action en prod fallará silenciosamente en el bump (el
  reorden de stops persiste — el catch ya cubre, solo se pierde el audit
  trail). El refactor del código TS ya está mergeable; aplicar migration
  ANTES de deploy.
- El allow-list (`scripts/service-role-allowlist.txt`) es estado mutable:
  cada vez que se justifica un nuevo call-site hay que regenerar con
  `pnpm check:service-role -- --refresh` Y agregar la justificación en
  `SERVICE_ROLE_AUDIT.md`. Si se regenera sin documentar, el guardrail
  pierde sentido. Mitigación: revisión de PR explícita en cualquier
  diff que toque `service-role-allowlist.txt`.
- La RPC `bump_route_version_by_driver` confía que solo
  `reorderStopsByDriverAction` la invoca. Si en el futuro otra action
  (admin) la llamara con el JWT de un chofer, podría bumpear versions sin
  el contexto de "Chofer reordenó". Mitigación: el `reason` es input del
  caller, queda en audit trail; revisar en KPI de fraud-radar (#224)
  patrones de reasons no-estándar.

**Oportunidades de mejora futuras:**

- **#226** — evaluar reabrir `tripdrive_restructure_dispatch` a
  authenticated durante Stream A (eliminar último bypass platform crítico).
- **#225** — `getDispatchByPublicToken` debe incluir `customer_id` en el
  SELECT al introducir multi-tenancy, para que la share page renderice
  branding del customer correcto.
- **#227** — agregar `pnpm check:service-role` al pipeline CI pre-merge.
- **#228** — eventualmente migrar a ESLint flat config + plugin custom
  (`no-restricted-imports` con `paths` específicos) cuando se haga el
  cleanup del Stream A inicial.

**Estado del inventario al cierre de este ADR:**

- 24 call-sites de `createServiceRoleClient()` → **16 archivos
  autorizados** (varios archivos tenían múltiples calls; ej. `push.ts` 3,
  `users.ts` 3, `push-fanout.ts` 3).
- 0 bypasses pendientes en `apps/driver/src/app/route/actions.ts`.
- 0 sospechosos sin clasificar (S-1 y S-2 cerrados).
- Pre-condiciones técnicas de Stream A documentadas en
  `MULTI_CUSTOMER.md` reducidas a: aplicar migration 036 en prod +
  validar 1 mes de operación N6 estable.



