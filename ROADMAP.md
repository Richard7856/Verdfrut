# VerdFrut — Roadmap V2 (post field test)

> Roadmap nuevo armado el 2026-05-07 después del deploy a producción.
> Prioridad #1: estabilizar sistema de rutas para field test real, NO añadir features nuevas hasta validar lo que tenemos en operación real.

---

## Estado actual (cerrado)

```
✅ Fase 0  — Fundación (monorepo, schema, Docker)
✅ Fase 1  — Logística mínima + optimizer
✅ Fase 2  — Driver PWA + supervisión en vivo
✅ Fase 3  — Dashboard cliente con KPIs + drill-downs + export XLSX
✅ Sprint 17 — Control Plane foundation (apps/control-plane + schema)
✅ DEPLOY  — Producción en Vercel + Railway
✅ Field-test prep — Maps/Waze + Reportar problema + bug fixes (6)
```

**31 ADRs documentados. 22 migraciones tenant + 1 control plane. 4 servicios live en producción.**

---

## Sprint 18 — Estabilizar campo (semana 1 post-field-test)

**Objetivo:** lo que aprendamos del field test del 2026-05-08, atacarlo. No añadir features hasta que el flujo principal sea sólido al 100%.

### S18.1 — Bug hunt post-field-test (~2-3 días)

Después del field test, todo lo que el chofer reporte se documenta en `KNOWN_ISSUES.md` con prioridad. Pueden ser:
- UX confuso ("no encontré el botón de X")
- Bugs reales (un step que se traba)
- Problemas operativos (el GPS no llegó en zona Y)

Atacar TODO lo crítico antes de Sprint 18.2.

### S18.2 — Transfer de paradas a otro chofer (~3 días)

**Caso real reportado:** "las camionetas se quedan paradas (llantas, motor) y el pedido tiene que pasar a otro chofer".

**Driver side (~1 día):**
- En el chat realtime, agregar opción "Mi camión NO puede continuar la ruta" con razón (motor / llanta / accidente / otro).
- Marca la ruta como `INTERRUPTED` (necesita migration de enum).

**Admin side (~2 días):**
- En `/routes/[id]` con status IN_PROGRESS, botón "Transferir paradas pendientes".
- Modal: select chofer activo + vehículo disponible + razón.
- Server action `transferRouteRemainder`:
  1. Ruta original → `INTERRUPTED` con metadata.notes = razón.
  2. Crea ruta nueva con stops `pending` re-asignados al new chofer.
  3. Push notification al new chofer.
  4. Log en audit_log.

**Testing:** simular avería en field test artificial.

### S18.3 — Chat AI mediator (~3-4 días)

**Caso:** choferes reportan cosas no accionables ("hay tráfico", "manifestación", "ya voy"). Eso quema la atención del zone_manager.

**Arquitectura:**

```
Chofer escribe mensaje
  ↓
classifyDriverMessage(text) — Claude vía @verdfrut/ai
  ├─ trivial → AI responde + marca message como auto_resolved
  └─ real_problem → flow normal (push al zone_manager)
```

**Categorías triviales (auto-respondidas):**
- Tráfico / manifestación / cierre vial
- "Voy en camino" / "estoy cerca"
- Preguntas sobre cómo usar la app
- "Está difícil llegar"

**Categorías reales (escalan):**
- Avería del camión
- Accidente
- Robo / asalto
- Tienda hostil / problema con receptor
- Mercancía dañada / faltante grave
- Cualquier cosa que el modelo dude → escala (sesgo a la seguridad)

**Auditoría:** todo mensaje + clasificación + respuesta AI se loguea en una nueva tabla `chat_ai_decisions` para revisar quincenalmente y ajustar el prompt.

**Cost:** ~$0.001 per mensaje con Claude Haiku — irrelevante.

### S18.4 — Quitar `DEMO_MODE_BYPASS_GEO` permanente (~10 min)

Después del field test, quitar el código + commit con mensaje claro. El bypass cumplió su propósito (demo) y ya no debe vivir en código de producción ni siquiera apagado por env.

### S18.5 — `ANTHROPIC_API_KEY` en Vercel driver (~5 min)

Si no se hizo durante prep, hacerlo ahora para que OCR de tickets funcione en field tests subsecuentes.

---

## Sprint 19 — Performance + observabilidad (~1 semana)

### S19.1 — Lighthouse audit del driver PWA (~1 día)

Métricas baseline + tunear:
- Bundle size del driver (probably oversized — revisar tree-shaking de mapbox-gl, exceljs no debería estar ahí)
- Time-to-interactive en 3G (chofer puede estar en zona con red mala)
- Service Worker cache strategy (ya tenemos Serwist — confirmar que cachea lo correcto)

### S19.2 — N+1 queries audit (~1 día)

Server Components pueden tener N+1 sin que se note hasta producción. Auditar:
- `/routes` con N rutas → N queries de stops
- `/dispatches` con N tiros → N queries de routes
- `/dashboard/stores/[id]` → query del store + N reports + N drivers

Convertir a JOINs o batched queries donde aplique.

### S19.3 — Sentry / LogTail (~1 día)

Error monitoring real para producción. Sin esto, los errores que el chofer ve en campo se pierden. Vercel runtime logs sirven para debug pero no son persistentes.

### S19.4 — Cron de chat timeout funcionando (~30 min)

`POST /api/cron/mark-timed-out-chats` ya existe pero requiere n8n con `CRON_SECRET`. Configurar en n8n cloud o GitHub Actions con schedule cada 1 min.

### S19.5 — Cron de orphan auth users (~30 min)

`POST /api/cron/reconcile-orphan-users` también existe — config 1×/día en n8n.

---

## Sprint 20 — Polish + compliance (~1 semana)

### S20.1 — Custom domains (~1 día)

Cuando tengas dominio real:
- `platform.verdfrut.com`
- `driver.verdfrut.com`
- `cp.verdfrut.com`

Vercel auto-genera certs SSL. Pasar A records de DNS, listo. Suma 30 min por dominio. Después del field test exitoso esto da peso al producto frente al cliente.

### S20.2 — Drag-drop reorder cross-list de paradas (issue #24, ~1 día)

Hoy puedes mover paradas DENTRO de una ruta (drag-drop) y ENTRE rutas (dropdown "Mover a →" en `/dispatches/[id]`). El issue #24 pide drag-drop cross-route directo. Quality of life para dispatcher.

### S20.3 — Compresión defensiva iOS Low Power Mode (issue #20, ~30 min)

Timeout de 5s en `compressImage`, fallback a subir original sin comprimir. iOS LP mode puede tardar mucho.

### S20.4 — % completitud paradas en `/routes` (~30 min)

Agregar columna en la tabla con barra visual de completitud por ruta.

### S20.5 — KNOWN_ISSUES backlog (~variable)

Lista actual: 9 importantes + 13 cosméticos. Atacar 5-6 cosméticos por sprint hasta vaciar.

---

## Sprint 21 — Control Plane Sprint 18 original (~1 semana)

Lo que originalmente era Sprint 18 del Control Plane (KPIs cross-tenant + sync diario) — postergado a este punto porque:
1. Solo tienes 1 tenant hoy. KPIs cross-tenant es overkill.
2. Cuando llegue el 2º cliente real, retomar.

Cuando se active:
- Endpoint `POST /api/sync/[slug]` que pulla KPIs del tenant via service role.
- Cron diario en n8n.
- Page `/` del CP con agregaciones reales.

---

## Sprint 22 — Onboarding Wizard (~1 semana)

Continuación natural del control plane. Postergado por las mismas razones. Cuando se active:
- Replicate `provision-tenant.sh` en TS llamando Management API.
- Modal "Onboardear cliente" en `/tenants/new`.
- Polling de status `provisioning` → `active`.
- Auto-config de redirect URLs.

---

## Fase 7 (futuro, condicional)

### Migración a Expo (React Native)

**Trigger:** después de 4-8 semanas de operación real con la PWA, evaluar:
- ¿iOS bloqueando GPS background es bloqueante operativamente? (issue #31)
- ¿Choferes piden "app real instalable"?
- ¿El cliente exige presencia en App Store / Play Store?

Si los triggers se cumplen → migrar driver app a Expo (NO Android Studio nativo). 3-4 semanas, reusa packages TS existentes.

### Migración Control Plane a proyecto Supabase separado (Escenario 3 de ADR-030)

**Trigger:** llegada del 2º cliente competidor real. Comando:

```bash
pg_dump --schema=control_plane $CURRENT_DB | psql $NEW_CP_DB
```

+ rotar service_role keys en el deploy nuevo.

---

## Resumen visual de prioridades

```
┌─────────────────────────────────────────────────────────────────┐
│                        Field test 2026-05-08                    │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
    ┌──────────────────────┐       ┌──────────────────────┐
    │ Sprint 18 — Estabilizar │       │   Sprint 19 — Perf   │
    │ • Bug hunt        2-3d │       │  • Lighthouse     1d │
    │ • Route transfer  3d   │       │  • N+1 audit      1d │
    │ • Chat AI         3-4d │       │  • Sentry         1d │
    │ • Cleanup demo    10m  │       │  • Crons          1h │
    └──────────────────────┘       └──────────────────────┘
              │                               │
              └───────────────┬───────────────┘
                              ▼
                  ┌──────────────────────┐
                  │ Sprint 20 — Polish    │
                  │ • Custom domains      │
                  │ • Cosméticos          │
                  │ • #24 / #20 / #28     │
                  └──────────────────────┘
                              │
                              ▼
                ┌──────────────────────────┐
                │ Triggers de Fase 7       │
                │ • iOS bloqueando ops?    │
                │ • 2º cliente competidor? │
                └──────────────────────────┘
```

---

## Lo que NO va en este roadmap (intencional)

- **Custom features per cliente** (color de marca, logos): cuando aparezcan los pedidos.
- **Marketplace de choferes / ride-sharing logic**: no es el negocio.
- **App pública para clientes finales** (consumidores): no es el modelo.
- **Pagos en línea**: cliente paga a VerdFrut por canales tradicionales.
- **Multi-idioma**: solo es-MX.
- **API pública para integraciones de 3ros**: no aplica V1-V2.
