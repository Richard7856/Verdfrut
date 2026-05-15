# TripDrive — Roadmap

> Actualizado el 2026-05-15. La plataforma se llama **TripDrive** (dominio `tripdrive.xyz` en Vercel). Primer cliente productivo: **VerdFrut** → NETO CDMX/Toluca.

---

## 🚨 Principio rector activo

**Calidad > costo de tokens.** Toda decisión de arquitectura del agente AI
(modelo, particionamiento, prompts) se evalúa primero por la calidad del
output. El costo MXN es secundario hasta que veamos producción real con
2+ clientes activos. (Confirmado por user 2026-05-15.)

---

## 🎯 Estado pre-demo 2026-05-15 (noche)

**Para presentar al cliente esta noche** → ver [DEMO_RUNBOOK.md](./DEMO_RUNBOOK.md).

**Para entender riesgos / gaps no terminados** → ver sección "Estado Streams OE + R" en [KNOWN_ISSUES.md](./KNOWN_ISSUES.md).

**Resumen ejecutivo**:
- ✅ OE-2 backend (endpoint `internal/propose-routes`) y CLI demo: **demo-ready**.
- ✅ R2 + R3 server-side: **funcional, sin UI**. Solo se activa si el user toca el chat conversacional con intent específico (geo o routing). Defensivo: cualquier sorpresa se mitiga con texto, no crash.
- ❌ UI conversacional (`RouteProposalCard`, badge "modo routing") + tools `propose_route_plan`/`apply_route_plan`: **NO entran en demo**. Sprint OE-3, post-demo.

---

## 🚨 P0 ACTUAL — Dos streams en paralelo

### Stream OE — Optimization Engine (feature central, ADR-096)

**Decisión 2026-05-14 (ADR-096)**: el clustering + asignación geográfica
+ propuesta de N alternativas pasa a ser **el feature principal del
producto**. Todo lo demás es secundario hasta que esto esté funcionando.

Razón: el optimizer VROOM actual resuelve secuencia DENTRO de una ruta
pero no asignación ENTRE rutas. En la demo VerdFrut (21 stops, 2 cam),
ambas camionetas terminaron cruzando toda la zona — la diferencia entre
un dispatcher humano armando rutas a mano y el agente AI proponiendo 2-3
alternativas óptimas es **el value prop completo del producto**.

**Spec detallada**: ver `OPTIMIZATION_ENGINE.md`.

| Sprint | Entrega | Status |
|---|---|---|
| **OE-1** | Capas 1+2 — clustering bisección + asignación greedy | ✅ 2026-05-15 (ADR-097) |
| **OE-2** | Capa 4 — propuesta N alternativas + costo MXN + endpoint `internal/propose-routes` + migración 045 `customers.optimizer_costs` | ✅ 2026-05-15 (ADR-100) |
| **OE-3** | Tools `propose_route_plan` + `apply_route_plan` en el router agent (ver Stream R) + UI `RouteProposalCard` con map preview | ⏳ depende de R3 |
| **OE-4** | Refinamientos: constraints (ventanas horarias, capacity multi-dim), cache matriz Google Routes, A/B testing default option | ⏳ pendiente |

**Métrica de éxito**: km totales por tiro CDMX 21 stops ≤ 280 (vs 421 hoy
con asignación alfabética). Adopción ≥80% de tiros vía agente AI propose.

### Stream R — Multi-agente runtime (calidad geo + routing)

**Decisión 2026-05-15**: partir el orchestrator monolítico en 3 roles
(`orchestrator`, `geo`, `router`) para que cada uno tenga un system prompt
focalizado y un subconjunto de tools relevantes. Motivación: **calidad de
output** en geocoding y routing (los dos dominios donde el orchestrator
general se distrae con tools de otros dominios).

**Baseline medido 2026-05-15** (script `scripts/measure-orchestrator-tokens.ts`):
- 19 tools, ~5k tokens por turno (system + tools), distribuidos:
  - geo 3 tools / 748 tok · routing 4 / 827 · dispatch 4 / 580
  - catalog 3 / 379 · data 2 / 344 · edit 3 / 369

**NO usamos**: Claude Agent SDK como framework (overkill; el loop actual
en `runner.ts` ya hace lo necesario). NO Skills (son dev-time, no runtime).

**Patrones de invocación distintos por rol**:
- **Geo agent** = "tool batch worker": el orchestrator delega via mega-tool
  `delegate_to_geo` con input estructurado. El sub-agente corre 5-10 tool
  calls en loop y devuelve resultado estructurado. El user NO ve el loop
  interno. Caso de uso: validar 50 direcciones, geocodificar bulk.
- **Router agent** = "conversation handoff": cuando el orchestrator detecta
  intent de routing, hace handoff total. El router agent toma la
  conversación con prompt rico (capas 1-4, costos MXN, jornada). El user
  ve un badge "modo routing". El control vuelve al orchestrator cuando el
  user cambia de tema o el router cierra el flujo.

| Sprint | Entrega | Status |
|---|---|---|
| **R1** | Refactor `runner.ts` → `runAgent(role, ...)`. Roles `orchestrator \| geo \| router`. Tool registry filtrado por rol. Sin cambios funcionales todavía. | ✅ 2026-05-15 (ADR-098) |
| **R2** | Geo agent operativo (tool batch worker). `delegate_to_geo` con N=10 max iter. Tests con Excel real de 30 direcciones. | ✅ 2026-05-15 (ADR-099) |
| **R3** | Router agent + handoff de conversación. UI agrega badge "modo routing". Lógica de "cuándo devolver control al orchestrator". | ✅ 2026-05-15 server-side completo (ADR-101). Migración 046 ✅ aplicada. **UI badge pendiente** (no bloquea demo OE-2). |
| **R4** | Migrar tool `optimize_dispatch` actual → `propose_route_plan` del router agent (encaja con OE-3). Cleanup de tools redundantes. | ⏳ depende de R3 + OE-2 |

### Riesgos conocidos (revisar en cada sesión antes de tocar agentes)

1. **Regresión por refactor de runner.ts**: el orchestrator monolítico
   funciona hoy. Partirlo en 3 introduce riesgo de regresión en flujos
   demo (crear tiro, publicar). Mitigación: R1 es refactor PURO (cero
   cambio funcional); R2/R3 activan los nuevos roles uno por uno.
2. **Latencia geo agent**: 5-10 tool calls anidados = 8-15s extra.
   Mitigación: UI progress bar + el geo agent solo se invoca por batch
   workflows, nunca en chat conversacional rápido.
3. **Handoff confusion (router agent)**: si el badge "modo routing" no es
   claro, el user no sabe por qué la AI "sabe más" de rutas de repente.
   Mitigación: copy explícito al entrar al modo + botón "salir de modo
   routing".
4. **State entre agentes**: si el router crea un dispatch y el user dice
   "bórralo", el orchestrator necesita saber qué dispatch. Solución:
   ambos comparten session state en BD (tabla `orchestrator_sessions` ya
   existe).
5. **Tests de regresión faltantes**: el orchestrator no tiene snapshot
   tests del flujo demo. Riesgo de romper sin enterarse hasta producción.
   Mitigación a discutir: snapshot test mínimo en R1 día 0 (recording de
   3 conversaciones reales) ANTES del refactor.
6. **Costo Google Routes en clustering paralelo** (Stream OE): la
   variante `computeClusteredOptimizationPlan` (ADR-097) hace N llamadas
   a VROOM en paralelo = N matrices Google Routes. Mitigación pendiente
   OE-4: cache de pares (lat,lng) en matriz pre-clustering.

### Orden de ejecución recomendado

```
OE-1 (✅ done) → R1 → R2 → OE-2 → R3 → OE-3 → R4 → OE-4
```

R1 va primero porque OE-2/OE-3 incluyen una tool `propose_route_plan`
que diseñamos asumiendo que vive en el router agent (Stream R). Si
hacemos OE-2 antes de R1, hay que migrar la tool después → trabajo
duplicado.

---

## ✅ Estado cerrado al 2026-05-15

- ADR-097 — Sprint OE-1 (capas 1+2 del Optimization Engine):
  package `@tripdrive/router` con `clusterStops` (bisección recursiva
  determinística) + `assignClustersToVehicles` (greedy por haversine).
  20 tests con `tsx --test`. Integración `computeClusteredOptimizationPlan`
  en `optimizer-pipeline.ts` backward-compatible.
- ADR-098 — Sprint R1 (refactor multi-agente runtime): `runner.ts` acepta
  `role: 'orchestrator' | 'geo' | 'router'`. `TOOLS_BY_ROLE` filtra tools
  por rol. Cero cambio funcional — los callers existentes pasan
  `role: 'orchestrator'`.
- ADR-099 — Sprint R2 (geo agent activo): `delegate_to_geo` tool en el
  orchestrator + `runGeoAgent` sub-loop read-only con max 10 iteraciones.
  El orchestrator ya NO ve `geocode_address`/`search_place` directos —
  los usa via delegación. 21 tests unitarios + fixture de 30 direcciones
  CDMX + `scripts/smoke-geo-agent.ts` para smoke test contra Anthropic
  real (manual con API keys, ~$0.10 USD por run).
- ADR-101 — Sprint R3 code-complete (router agent + handoff conversacional):
  prompt real con conocimiento de OE capas 1-4, costos MXN, jornada legal.
  Tools `enter_router_mode` (orchestrator) y `exit_router_mode` (router).
  Endpoint `/api/orchestrator/chat` lee `active_agent_role` de la sesión y
  emite eventos SSE `active_role` + `role_changed` para UI badge. Migración
  046 escrita pero NO aplicada (esperando autorización post-demo). El
  código tiene fallback defensivo a `'orchestrator'` si la columna no
  existe → deploy puede ir antes que la migración sin breakage. 34 tests
  orchestrator pasan.
- ADR-100 — Sprint OE-2 (Capa 4 del Optimization Engine):
  `@tripdrive/router/cost.ts` + `propose.ts` (cost MXN + ranking
  cheapest/balanced/fastest); `apps/platform/src/lib/propose-plans.ts`
  (orquestación con clustering paralelo); endpoint POST
  `/api/orchestrator/internal/propose-routes` con hardening C1;
  migration 045 `customers.optimizer_costs jsonb` aplicada al tenant
  VerdFrut (resto via `scripts/migrate-all-tenants.sh`);
  `scripts/demo-propose-routes.mjs` CLI listo para demo con cliente.
  43 tests pasan (router) + 21 (orchestrator).
- Script `scripts/measure-orchestrator-tokens.ts` (baseline 5k tok / 19 tools).
- Plan multi-agente runtime (Stream R) documentado en este roadmap.

---

## ✅ Estado cerrado al 2026-05-13 y previos

```
✅ Fase 0  — Fundación (monorepo, schema, Docker)
✅ Fase 1  — Logística mínima + optimizer VROOM
✅ Fase 2  — Driver PWA + supervisión en vivo
✅ Fase 3  — Dashboard cliente + KPIs + drill-downs
✅ Sprint 17 — Control Plane foundation
✅ DEPLOY  — Producción Vercel + Railway
✅ Sprint 18 — Estabilizar field-test (ADRs 023-032)
✅ Sprint 18 bonus — ADRs 033-048
✅ Rebrand → TripDrive (ADR-049)
✅ Sprint hardening P0/P1 (ADR-050)
✅ Sprint H1-H6 — Observability + ETAs + Robustez + Performance + Reportería + Domains (ADR-051..056)
✅ Sprint H7-pre — UI shell multi-cliente + import 40 tiendas + logo/favicon + react-doctor (commits 19e8b9a, b8d21f5, cac4672, etc.)
✅ Stream C / Fase O1 — Re-optimización en vivo con Google Routes (ADR-074)
✅ Stream B completo — App nativa Android con 5 fases:
   ✅ N1 — Scaffold Expo + login + placeholder (ADR-075)
   ✅ N2 — Mi ruta del día: mapa nativo + cache offline (ADR-076)
   ✅ N3 — Detalle parada + Navegar (Waze/Maps) + GPS background (ADR-077, ADR-078)
   ✅ N4 — Evidencia: cámara + OCR proxy + outbox SQLite (ADR-079, ADR-080)
   ✅ N5 — Chat realtime + push tokens Expo (ADR-081, ADR-082)
✅ Sprint H8 — Hardening + plan Stream A:
   - Mock-location anti-fraude flag (migration 035)
   - Recalc-ETAs button (Bug-#L4 mitigation)
   - TTL crons: chat_ai_decisions + push_subscriptions
   - SERVICE_ROLE_AUDIT.md (24 call-sites catalogados)
   - MULTI_CUSTOMER.md (640 líneas, plan Stream A completo)
   ADR-083, ADR-084
✅ EAS Build APK preview funcional — 10 iteraciones de fixes (peer deps,
   isolated/hoisted, expo-updates compat, babel-preset-expo, template gradle).
   Stack final: SDK 54-style (RN 0.79.6 + expo-router 5.x).
```

**96 ADRs documentados. 44 migraciones tenant + 1 control plane.**
**Stream B 100% en código. Stream A landed (multi-customer + plans + RLS).
Landing pública live + control-plane live. APK pendiente rebuild EAS.**

### Cierre 2026-05-14 (esta sesión)
- ADR-095 — Feature gating por tier + admin panel (mig 043)
- ADR-096 — Optimization-first architecture (decisión arquitectónica)
- Hardening: 3 CRITICAL fixes (C1 internal optimize, C2 share expiry, C3 CP login rate limit)
- Privacy + ToS publicados en landing (LFPDPPP MX)
- Demo CDMX 55 stops repartidos en 3 dispatches (Lun/Mar/Mié) con
  re-partición geográfica manual (Sur-Oeste/Este, Oriente-Norte/Sur) —
  evidencia del problema que motiva ADR-096

---

## 🚧 Sprint H7 — Pruebas con cliente real *(siguiente, variable)*

### Pre-condición operativa (depende del user):
- [x] Comprar dominio `tripdrive.xyz` (Hostinger ✅ 2026-05-11)
- [x] Configurar DNS: nameservers a Vercel ✅
- [ ] Agregar custom domains en los 3 proyectos Vercel (en curso)
- [ ] `SENTRY_AUTH_TOKEN` (crear Organization Token en Sentry)
- [ ] `NEXT_PUBLIC_SENTRY_DSN` en los 3 proyectos Vercel
- [ ] `MAPBOX_DIRECTIONS_TOKEN` en platform
- [ ] `ANTHROPIC_API_KEY` en driver
- [ ] Redeploy los 3 proyectos para aplicar env vars
- [ ] Configurar 4 schedules n8n (timeout-chats, orphans, breadcrumbs, rate-limit-cleanup)
- [ ] Smoke tests con curl post-deploy
- [ ] Test Sentry (throw error en server action temp)

### Pruebas (Sprint en sí):
- Test piloto con NETO — operación real
- Observar Sentry dashboard durante operación
- Bug hunt según lo reportado
- Validación banner ETA (Mapbox activado) + KPIs reales
- Documentar lecciones aprendidas

---

## 📦 Sprint H6 (CERRADO) — entregables

### Rebrand interno fase 2
- 215 archivos: `@verdfrut/*` → `@tripdrive/*` (sed masivo + type-check 10/10)
- 8 packages renombrados (`@tripdrive/types`, `@tripdrive/ui`, etc.)
- 28 aliases CSS `--td-*` → `--vf-*` (estrategia no-rename, doc en tokens.css)
- Cookie `td-theme` canónica + `vf-theme` legacy con fallback server-side

### `DOMAINS.md` (NUEVO)
- Arquitectura 4+ subdominios documentada
- 5 pasos paso-a-paso DNS + Vercel custom domains
- Patrón multi-tenant subdomain
- Email transaccional con Cloudflare Email Routing
- Triggers para activar Cloudflare WAF en futuro

---

## 📦 Sprint H5 (CERRADO) — qué se entregó

### S5.1 — `/reports` operativo (ya no stub)
- Filtros: rango de fechas + zona
- KPIs: rutas, completadas, cumplimiento %, canceladas, distancia, manejo, paradas completas/pendientes
- Breakdown por status

### S5.2 — Pantalla `/audit/chat-failures` (#122)
- Lista fallos de escalación push del chat
- Link en sidebar (admin only)
- Card de troubleshooting

### S5.3 — Lighthouse audit instructivo (#145)
- `LIGHTHOUSE.md` con cómo correr + métricas target + qué optimizar

### S5.4 — Cron `rate-limit-cleanup` (#142)
- Endpoint `/api/cron/rate-limit-cleanup`
- Schedule documentado en `DEPLOY_CHECKLIST.md`

### S5.5 — Quality of life
- #143: lightbox al click en imagen de chat
- #144: `compressImageFellBack(file)` helper para telemetría de fallback

---

## ⏳ Sprint H5 — Reportería + UX dispatcher pulida (CERRADO arriba)

> El cliente espera ver KPIs específicos durante las pruebas. Foco en visibilidad operativa.

### S5.1 — KPIs operativos pulidos
- On-time delivery rate, % completitud por ruta, incidentes por zona
- Filtros avanzados en `/reports` (fecha, chofer, zona, tipo de incidente)
- Exports XLSX completos con audit trail

### S5.2 — Pantalla `/audit/chat-failures` (issue #122)
- Filtra `chat_ai_decisions` por `category='unknown' AND rationale LIKE 'ESCALATION_PUSH_FAILED%'`
- Permite re-enviar push manualmente

### S5.3 — Lighthouse audit driver PWA (issue #145)
- Bundle size analysis (tree-shaking de mapbox-gl, exceljs)
- TTI en 3G simulado
- Service Worker cache strategy

### S5.4 — Cron de cleanup rate_limit_buckets (issue #142)
- Endpoint `POST /api/cron/rate-limit-cleanup`
- Schedule n8n diario

### S5.5 — Mejoras UX dispatcher (backlog acumulado)
- Issue #146: migrar call sites legacy a `nowUtcIso()`
- Issue #143: click imagen chat → lightbox
- Issue #144: diferenciar timeout iOS LP vs red lenta

---

## ⏳ Sprint H7 — Pruebas con cliente real *(variable)*

- **Test piloto con NETO** — operación real
- Observar Sentry dashboard durante operación
- Bug hunt según lo reportado
- Validación de banner ETA (Mapbox activado) y KPIs reales
- Documentar lecciones aprendidas en KNOWN_ISSUES

---

## 🎯 Condicionales (esperando trigger)

### Sprint H8 — Multi-CEDIS formal *(si NETO abre CEDIS Toluca real)*
- Tabla pivot `depot_zones` (#106)
- Zona "Toluca" formal con stores asignados
- UI cross-zone en `/settings/depots`

### Sprint H9 — Control Plane KPIs *(si llega 2º cliente)*
- Endpoint `POST /api/sync/[slug]`
- Cron diario en n8n
- Page `/` del CP con agregaciones

### Sprint H10 — Onboarding Wizard *(post 2º cliente)*
- `provision-tenant.sh` portado a TS
- Modal "Onboardear cliente"
- Auto-config redirect URLs

### Sprint H11 — Migración driver a Expo *(si iOS GPS background bloqueante)*
- Evaluar 4-8 semanas post field-test
- Triggers: iOS Safari GPS, App Store/Play Store presence

---

## 📊 Sprints H1-H4 — resumen de impacto

| Sprint | Foco | ADR | Entregables clave |
|---|---|---|---|
| H1 | Observability | 051 | Sentry + logger en 3 apps, source maps, 5 critical migrados |
| H2 | ETAs reales + Crons | 052 | Banner ETA demo, crons instrumentados, assetlinks TWA, DEPLOY_CHECKLIST |
| H3 | Robustez split/merge | 053 | RPC atómica two-phase, depot override preservation, banner comparativo, confirm reorders |
| H4 | Performance + escala | 054 | N+1 audit, rate limit Postgres, helpers batch, `<Image>`, iOS LP defensive, PERFORMANCE.md |

---

## 📂 Documentos vivos

- [PROJECT_BRIEF.md](./PROJECT_BRIEF.md) — objetivo, ADRs resumidos, contratos
- [DECISIONS.md](./DECISIONS.md) — 54 ADRs detallados
- [BRAND.md](./BRAND.md) — identidad TripDrive
- [DEPLOY_CHECKLIST.md](./DEPLOY_CHECKLIST.md) — env vars + crons + verificación
- [OBSERVABILITY.md](./OBSERVABILITY.md) — Sentry + logger workflow
- [PERFORMANCE.md](./PERFORMANCE.md) — playbook anti-N+1, rate limit, imágenes
- [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) — issues abiertos

---

## ❌ Lo que NO va en este roadmap (intencional)

- **Custom features per cliente** (color de marca, logos): cuando aparezcan los pedidos.
- **Marketplace de choferes / ride-sharing logic**: no es el negocio.
- **App pública para consumidores finales**: no es el modelo.
- **Pagos en línea**: TripDrive factura al cliente por canales tradicionales.
- **Multi-idioma**: solo es-MX hasta confirmar 2º mercado.
- **API pública para integraciones de 3ros**: no aplica V1-V2.
