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

## [2026-05-01] ADR-010: Flujo entrega — máquina de pasos centralizada en `@verdfrut/flow-engine`, persistencia en `delivery_reports.current_step`

**Contexto:** El flujo de entrega del chofer tiene 14 pasos lineales con bifurcaciones (incident_check → cart o product_arranged; waste_check → waste_ticket o receipt_check; etc.). La lógica de "¿cuál es el siguiente paso?" puede vivir en (a) la UI cliente, (b) el server, o (c) un package compartido. Tomar la decisión incorrecta lleva a duplicación o a inconsistencias entre quién manda al chofer al siguiente paso vs quién persiste el estado.

Además, el chofer puede cerrar la app a la mitad (sin red, batería muerta, llamada). Al volver debe resumir donde estaba.

**Decisión:**
- **Lógica de transiciones** vive en el package puro `@verdfrut/flow-engine` (`nextEntregaStep(currentStep, ctx)`). Funciones determinísticas, testeables sin DB ni browser.
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
