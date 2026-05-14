# Hardening Report — TripDrive

> Generado 2026-05-13 antes del onboarding de VerdFrut productivo.
> Foco: **¿cómo rompo este sistema?** y **¿qué dependencia caída me tumba?**

Encontrado vía red-team review (1 agente + verificación manual) + análisis de
resilience. **No es un wishlist** — cada item es un vector real de explotación
o falla, con file:line concreto y fix propuesto.

---

## 📋 Resumen ejecutivo

| Severidad | Cantidad | Fix antes de |
|---|---|---|
| 🔴 CRITICAL | 3 | **Antes de cobrar a VerdFrut** |
| 🟠 HIGH | 5 | Próximas 2 semanas (in-piloto) |
| 🟡 MEDIUM | 5 | Mes 2 post-piloto |
| ⚪ LOW | 3 | Cuando hayan 2+ clientes |
| 🐢 Resilience SPOFs | 4 | Iterar mensual |

Plus **APK crash** (resuelto en código `c5b2055`, falta rebuild EAS).
Plus **2 docs legales** (`/privacidad`, `/terminos`) creados como parte de este sprint.

---

## 🔴 CRITICAL — Antes de cobrar a VerdFrut

### C1. Internal optimize endpoint confía customer_id del body

**Archivo**: [apps/platform/src/app/api/orchestrator/_internal/optimize/route.ts:54](apps/platform/src/app/api/orchestrator/_internal/optimize/route.ts#L54)

**Vector**: cualquier proceso con `INTERNAL_AGENT_TOKEN` puede mandar
`{ caller_customer_id: '<otro-tenant>', dispatch_id: '<su-id>' }` y reescribir
las rutas de ese tenant. El query filtra por `customer_id = body.caller_customer_id`
pero el atacante controla ese valor.

```ts
// HOY (línea 54-66):
if (!body.caller_customer_id || !body.caller_user_id) {
  return Response.json({ error: 'identidad del caller requerida' }, { status: 400 });
}
const admin = createServiceRoleClient();
const { data: dispatch } = await admin
  .from('dispatches')
  .select(...)
  .eq('customer_id', body.caller_customer_id);  // ← cliente controla esto
```

**Fix**: el endpoint debe RECIBIR el `caller_user_id` y RE-derivar el customer
desde la BD (no del body).

```ts
const { data: caller } = await admin
  .from('user_profiles')
  .select('customer_id, role')
  .eq('id', body.caller_user_id)
  .single();
if (!caller || !['admin', 'dispatcher'].includes(caller.role)) {
  return Response.json({ error: 'forbidden' }, { status: 403 });
}
const realCustomerId = caller.customer_id;
// usar realCustomerId, ignorar body.caller_customer_id
```

**Esfuerzo**: 30 min. **Riesgo si no se arregla**: deface cross-tenant total.

---

### C2. Share dispatch URLs no caducan ni rotan

**Archivo**: [apps/platform/src/lib/queries/dispatches.ts:138](apps/platform/src/lib/queries/dispatches.ts#L138)

**Vector**: `crypto.randomUUID()` da 122 bits de entropía (bien), pero el
endpoint `GET /share/dispatch/[token]` no verifica `expires_at`, `revoked_at`,
ni status del dispatch. Un link compartido con un proveedor para ver una ruta
sigue funcionando para siempre.

**Fix mínimo (1 hora)**:
1. Agregar columna `expires_at TIMESTAMPTZ` al row de share (default `NOW() + 7 days`).
2. En `getDispatchByPublicToken`: `WHERE expires_at > NOW() AND revoked_at IS NULL`.
3. UI: botón "Revocar link" en `/dispatches/[id]`.
4. Cron diario que marque shares `revoked_at = NOW()` si el dispatch ya completed/cancelled.

**Riesgo si no se arregla**: leak permanente de coordenadas, choferes, vehículos.

---

### C3. Control Plane login sin rate limit ni MFA

**Archivo**: [apps/control-plane/src/app/login/actions.ts:10](apps/control-plane/src/app/login/actions.ts#L10)

**Vector**: una sola contraseña compartida (`CP_SHARED_PASSWORD`) protege
service_role cross-tenant. Sin rate limit, un atacante puede bruteforcear
online — y si entra, tiene **acceso completo a todos los customers**.

**Fix mínimo (2 horas)**:
1. Agregar rate limit por IP en la action (`rate_limit_buckets` ya existe — mig 033).
   3 intentos / 15 min. Después: 1 hora de bloqueo.
2. Loggear cada intento fallido a `auth_events` (nueva tabla) con IP + UA.
3. Alerta a Sentry si >5 intentos fallidos / hora desde IPs distintas.
4. **Rotar `CP_SHARED_PASSWORD`** ahora a 32+ chars random — no la palabra que tengas.

**Fix correcto (próximo sprint)**: migrar CP a Supabase Auth con whitelist de
emails autorizados + MFA TOTP. Hoy es un riesgo aceptable porque solo tú
tienes la contraseña, pero el primer empleado que contrates necesita esto.

---

## 🟠 HIGH — Antes de salir de piloto VerdFrut (~2 semanas)

### H1. AI orchestrator sin quota per-customer / per-día

**Archivos**:
- [packages/orchestrator/src/runner.ts:24](packages/orchestrator/src/runner.ts#L24) — MAX_TOKENS=8192/turn, MAX_LOOP_ITERATIONS=12/turn
- [apps/platform/src/app/api/orchestrator/chat/route.ts](apps/platform/src/app/api/orchestrator/chat/route.ts) — sin límite global

**Vector**: un admin Pro puede correr miles de turnos al día. Costo Anthropic
explota → factura tuya, no del cliente. Si AI ilimitado es promesa de venta,
necesitas backstop.

**Fix**: agregar contador a `orchestrator_messages`. Antes de cada turn:
```sql
SELECT COALESCE(SUM(token_count), 0) AS today
FROM orchestrator_messages
WHERE customer_id = $1 AND created_at >= CURRENT_DATE;
```
Si > soft-cap del tier (ej. 500k tokens/día Pro, 2M Enterprise): rate limit
con mensaje "estás cerca del fair use, contacta para extender".

**Esfuerzo**: 4 horas. **Riesgo si no se arregla**: factura Anthropic
de $5,000+ MXN por un solo cliente excedido.

---

### H2. Orchestrator session resume sin verificación de owner

**Archivo**: [apps/platform/src/app/api/orchestrator/chat/route.ts:136](apps/platform/src/app/api/orchestrator/chat/route.ts#L136)

**Vector**: el resume solo valida `session.state === 'open'`. Un admin
puede mandar `sessionId` de OTRO dispatcher (mismo customer) y ejecutar
tools "como" ese dispatcher en el audit log. RLS impide cross-customer,
pero NO same-customer.

**Fix** (15 min):
```ts
if (existing.user_id !== profile.id) {
  return Response.json({ error: 'session no es tuya' }, { status: 403 });
}
```

---

### H3. Mock-location flag se persiste pero nunca se enforca

**Archivo**: [apps/driver-native/src/lib/actions/arrive.ts:118](apps/driver-native/src/lib/actions/arrive.ts#L118)

**Vector**: la app native detecta `Location.mocked` y lo persiste en
`stops.arrival_was_mocked`. PERO nada bloquea la entrega ni penaliza el SLA.
Un chofer toggling Dev Options puede marcar entregas "completed" desde la
casa. KPIs operativos (`on_time_rate`) son forgeable.

**Fix mínimo** (2 horas): server-side, en la action `markArrived`,
si `arrival_was_mocked = true`:
- No insertar `actual_arrival_at`
- Forzar `status = 'pending_review'` en lugar de `'arrived'`
- Notificar supervisor con push: "chofer X intentó llegada con mock location en stop Y"

**Riesgo si no se arregla**: SLA mentido → cliente reclama → contrato pierde
credibilidad.

---

### H4. XLSX upload vulnerable a zip-bomb / shared-string explosion

**Archivo**: [apps/platform/src/app/api/orchestrator/upload/route.ts:148](apps/platform/src/app/api/orchestrator/upload/route.ts#L148)

**Vector**: el cap de 5MB es sobre el archivo crudo. Un XLSX bien construido
con shared strings repetidos puede expandir a millones de celdas. `exceljs`
los carga TODOS antes de que el `slice(0, 500)` aplique → RAM del lambda
Vercel explota → función matada → DOS.

**Fix** (1 hora):
- Antes de `workbook.xlsx.load(buffer)`, validar que el zip interno no
  exceda 50MB descomprimido (lib `yauzl` o check de header zip).
- Cap explícito en `eachRow`: parar después de 1000 filas, abortar si más.
- En el response, decir al usuario "archivo demasiado grande" con instrucción.

---

### H5. Stops update sin proof server-side de proximidad GPS

**Archivos**:
- [apps/driver-native/src/lib/actions/arrive.ts](apps/driver-native/src/lib/actions/arrive.ts) — calcula `distance_meters` client-side
- [supabase/migrations/00000000000013_perf_hardening.sql:142](supabase/migrations/00000000000013_perf_hardening.sql#L142) — RLS `stops_update`

**Vector**: el chofer manda `lat, lng` desde el teléfono. El cliente JS
calcula la distancia a la tienda. RLS solo valida que la ruta sea suya
y esté `PUBLISHED/IN_PROGRESS`. **El chofer puede mentir las coords**.

**Fix** (4 horas): cross-validar contra el último breadcrumb registrado
en `route_breadcrumbs` (insertado por el background GPS task, harder to
forge porque viene del foreground service). Si el chofer dice "estoy en
(19.43, -99.13)" pero el último breadcrumb 30s atrás dice "(19.50, -99.20)",
flag para revisión.

---

## 🟡 MEDIUM — Mes 2 post-piloto

### M1. Stops RLS no es customer-scoped explícito (mig 039 lo saltó)

**Archivo**: [supabase/migrations/00000000000013_perf_hardening.sql:142](supabase/migrations/00000000000013_perf_hardening.sql#L142)

Defense-in-depth: agregar `EXISTS (SELECT 1 FROM routes WHERE routes.id = stops.route_id AND routes.customer_id = current_customer_id())` a la policy de stops.

### M2. Driver chat actions con service_role no re-validan report ownership

**Archivo**: `apps/driver/src/app/route/stop/[id]/chat/actions.ts:155`

Validar que `report_id` corresponde al `route_id` del caller antes del insert.

### M3. CP cookie con vida de 7 días sin revocation list

**Archivo**: [apps/control-plane/src/lib/auth-token.ts:14](apps/control-plane/src/lib/auth-token.ts#L14)

Reducir a 24h. Agregar tabla `cp_cookie_revocations` con jti y endpoint
"cerrar todas las sesiones".

### M4. Realtime channel filtros frágiles

Migrar de filter manual a Postgres Changes con RLS aplicado.

### M5. Defense-in-depth: chat route customer_id mismatch en session lookup

**Archivo**: [apps/platform/src/app/api/orchestrator/chat/route.ts:271](apps/platform/src/app/api/orchestrator/chat/route.ts#L271)

Agregar `.eq('customer_id', customerId)` en la query de session.

---

## ⚪ LOW — Cuando haya 2+ clientes

### L1. Upload kind detection trusts extensión OR mime

**Archivo**: [apps/platform/src/app/api/orchestrator/upload/route.ts:48](apps/platform/src/app/api/orchestrator/upload/route.ts#L48)

Validar magic bytes (zip signature `PK\x03\x04` para XLSX).

### L2. Share token nunca rota en permission change

Cron: revocar shares de un dispatch cuando su `created_by` se desactiva.

### L3. Public token rate limit por primer-hop IP

Migrar a Cloudflare Turnstile o key compuesta (IP + UA hash) para hacer
DOS de un token específico más caro.

---

## 🐢 Resilience — Single Points of Failure y missing timeouts

### R1. Anthropic API caída → orquestador + AI enrich muertos sin fallback

**Archivos sin timeout**:
- [packages/orchestrator/src/runner.ts:178](packages/orchestrator/src/runner.ts#L178) — `anthropic.messages.stream` (sin AbortSignal)
- [packages/ai/src/enrich-vehicle.ts:69](packages/ai/src/enrich-vehicle.ts#L69) — `anthropic.messages.create`

**Fix**: `AbortSignal.timeout(45_000)` en stream, `30_000` en enrich.
Si timeout, fallback a "agente no disponible, intenta en 1 min".

### R2. Railway optimizer es instancia única

Si Railway tiene downtime, no hay optimización. Hoy timeout (20s) está
configurado, pero no hay fallback a "armar ruta manual".

**Fix corto** (1 día): cuando optimize falla 3x consecutivas, mostrar al
dispatcher "el optimizador está caído, arma la ruta manualmente y publícala".
La UI ya permite reordenar drag-and-drop, solo falta el banner.

**Fix largo**: Vercel Cron health check al optimizer cada 5 min, alertar
Sentry si responde > 2s consistente.

### R3. Mapbox calls sin timeout — UI puede hangear

**Archivo**: [apps/platform/src/lib/mapbox.ts:68,116](apps/platform/src/lib/mapbox.ts#L68)

```ts
const res = await fetch(url, { method: 'GET' }); // ← sin signal
```

**Fix** (15 min): `AbortSignal.timeout(10_000)`. Si quota Mapbox se acaba,
banner ETA cae a "estimación no disponible" en vez de spinner forever.

### R4. Internal fetch del UI sin timeout

**Archivos**: `chat-client.tsx`, `vehicle-form.tsx`, `stores-map.tsx`, `multi-route-map.tsx`

UI hace `await fetch('/api/...')` sin timeout. Si el server tarda
(Vercel cold start + Anthropic latency = puede ser 30s+), el usuario ve
botón "Cargando" forever sin opción a cancelar.

**Fix**: helper `fetchWithTimeout(url, opts, ms = 30_000)` en `apps/platform/src/lib/fetch.ts`,
usar everywhere.

---

## 📅 Orden de ejecución recomendado

### Esta semana (~1 día efectivo de código)
- [x] APK rebuild (ya hecho en código, falta `eas build --profile preview`)
- [ ] **C1** internal optimize endpoint (30 min)
- [ ] **C2** share URLs con expires_at (1 hora)
- [ ] **C3** rate limit en CP login + rotar `CP_SHARED_PASSWORD` (2 horas)
- [ ] **H3** mock-location enforcement server-side (2 horas)
- [ ] **R3** + **R4** timeouts en Mapbox + helper fetchWithTimeout (1 hora)
- [ ] Privacy + ToS publicados

### Próximas 2 semanas (durante piloto VerdFrut)
- [ ] **H1** quota AI per-customer / día
- [ ] **H2** session ownership check
- [ ] **H4** XLSX zip-bomb hardening
- [ ] **H5** GPS cross-validation con breadcrumbs
- [ ] **R1** timeouts Anthropic + fallback message
- [ ] **R2** optimizer health check + banner fallback

### Mes 2 post-piloto
- [ ] Todos los **M*** (defense-in-depth)

### Cuando haya 2+ clientes
- [ ] **L*** (info disclosure menor)
- [ ] CP migrado a Supabase Auth + MFA

---

## 🛡️ Lo que NO está aquí (ya está bien)

- ✅ Sin secrets en git history (`.env.local` correctamente ignorado)
- ✅ Sin service_role keys hardcoded en código
- ✅ Anon keys en `eas.json` — esto es OK (anon keys son client-bundle-safe by design)
- ✅ RLS aplicada a 8 tablas operativas (mig 039, 31 policies)
- ✅ Sentry integrado (falta config DSN en prod, pero el SDK está)
- ✅ CSP / security headers básicos en `next.config.ts`
- ✅ `requireRole()` correctamente aplicado en todas las actions de admin
- ✅ HTTPS forzado por Vercel
- ✅ Cookies HMAC (no plaintext)

---

## 🔮 Limites conocidos sin fix planeado

- WAF / Cloudflare al frente — no V1, agregar cuando haya 10+ clientes
- Pentest profesional — diferido a post-seed o pre-Series A
- ISO 27001 / SOC 2 — N/A para clientes MX SMB
- Auditoría de código de terceros — opcional, costo $50k+ USD
