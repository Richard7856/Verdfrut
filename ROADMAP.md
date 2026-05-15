# TripDrive — Roadmap

> Actualizado el 2026-05-14. La plataforma se llama **TripDrive** (dominio `tripdrive.xyz` en Vercel). Primer cliente productivo: **VerdFrut** → NETO CDMX/Toluca.

---

## 🚨 P0 ACTUAL — Optimization Engine (feature central)

**Decisión 2026-05-14 (ADR-096)**: el clustering + asignación geográfica
+ propuesta de N alternativas pasa a ser **el feature principal del
producto**. Todo lo demás es secundario hasta que esto esté funcionando.

Razón: el optimizer VROOM actual resuelve secuencia DENTRO de una ruta
pero no asignación ENTRE rutas. En la demo VerdFrut (21 stops, 2 cam),
ambas camionetas terminaron cruzando toda la zona — la diferencia entre
un dispatcher humano armando rutas a mano y el agente AI proponiendo 2-3
alternativas óptimas es **el value prop completo del producto**.

**Spec detallada**: ver `OPTIMIZATION_ENGINE.md`.

**Sprints planeados** (~4 sprints / ~2-3 semanas):
- Sprint 1: Capas 1+2 — clustering bisección recursiva + asignación greedy
- Sprint 2: Capa 4 — propuesta de N alternativas con cálculo de costo MXN
- Sprint 3: Tools del agente + UI `RouteProposalCard` con map preview
- Sprint 4: Refinamientos (constraints, cache matriz, A/B testing)

**Métrica de éxito**: km totales por tiro CDMX 21 stops ≤ 280 (vs 421 hoy
con asignación alfabética). Adopción ≥80% de tiros vía agente AI propose.

---

## ✅ Estado cerrado al 2026-05-14

---

## ✅ Estado cerrado al 2026-05-13

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
