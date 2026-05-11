# TripDrive — Roadmap (post Sprint H6)

> Actualizado el 2026-05-11. La plataforma se llama **TripDrive** (dominio `tripdrive.xyz` comprado en Hostinger, nameservers en Vercel). Primer cliente productivo: **VerdFrut**, alias operativo de su contrato con NETO Tiendas en CDMX y Toluca.

---

## ✅ Estado cerrado al 2026-05-11

```
✅ Fase 0  — Fundación (monorepo, schema, Docker)
✅ Fase 1  — Logística mínima + optimizer VROOM
✅ Fase 2  — Driver PWA + supervisión en vivo
✅ Fase 3  — Dashboard cliente + KPIs + drill-downs
✅ Sprint 17 — Control Plane foundation
✅ DEPLOY  — Producción Vercel + Railway
✅ Sprint 18 — Estabilizar field-test (ADRs 023-032)
✅ Sprint 18 bonus — ADRs 033-048 (reorder, dnd-kit, dispatch_id NOT NULL,
                     APK TWA, geocoding Places, enlace público, depot
                     override, agregar/quitar camionetas, dedupe cross-ruta)
✅ Rebrand → TripDrive (ADR-049)
✅ Sprint hardening P0/P1 (ADR-050)
✅ Sprint H1 — Observability + Sentry (ADR-051)
✅ Sprint H2 — ETAs reales + crons + APK TWA + banner ETA demo (ADR-052)
✅ Sprint H3 — Robustez del split/merge (ADR-053)
✅ Sprint H4 — Performance + escala (ADR-054)
✅ Sprint H5 — Reportería + audit chat + UX pulida (ADR-055)
✅ Sprint H6 — Custom domains doc + rebrand interno fase 2 (ADR-056)
```

**56 ADRs documentados. 33 migraciones tenant + 1 control plane.**

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
