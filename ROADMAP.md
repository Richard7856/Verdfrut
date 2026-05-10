# TripDrive — Roadmap (post ADR-049 rebrand)

> Actualizado el 2026-05-09. La plataforma se llama **TripDrive** (dominio `tripdrive.xyz`). El primer cliente productivo es **VerdFrut**, alias operativo de su contrato con NETO Tiendas en CDMX y Toluca.

---

## ✅ Estado cerrado al 2026-05-09

```
✅ Fase 0  — Fundación (monorepo, schema, Docker)
✅ Fase 1  — Logística mínima + optimizer VROOM
✅ Fase 2  — Driver PWA + supervisión en vivo
✅ Fase 3  — Dashboard cliente con KPIs + drill-downs + export XLSX
✅ Sprint 17 — Control Plane foundation
✅ DEPLOY  — Producción Vercel + Railway
✅ Sprint 18 — Estabilizar post field-test (ADRs 023-032)
✅ Sprint 18 bonus — ADRs 033-048: reorder, dnd-kit, dispatch_id NOT NULL,
                     APK TWA, geocoding Places, enlace público, depot override,
                     agregar/quitar camionetas + dedupe cross-ruta
✅ Rebrand — VerdFrut (producto) → TripDrive (producto) / VerdFrut (cliente)
```

**49 ADRs documentados. 31 migraciones tenant + 1 control plane. 4 servicios live.**

---

## 🚧 Sprint 19 — Pre field-test cliente real *(3-5 días, en curso)*

> Antes del field test con NETO. Cerrar todo lo bloqueante operacional.

### S19.1 — Coords ambiguas Toluca *(~30 min)*
- TOL-1977 Avándaro → pedir URL Maps al cliente
- TOL-1274 Amanalco → pedir URL Maps al cliente
- TOL-657 San Juan Huertas → confirmar la coord aplicada

### S19.2 — Tokens en Vercel *(~10 min)*
- `MAPBOX_DIRECTIONS_TOKEN` en platform → habilita matrix real (no haversine)
- `ANTHROPIC_API_KEY` en driver → AI mediator clasifica en prod

### S19.3 — APK full TWA *(~30 min)*
- Deploy de `apps/driver/public/.well-known/assetlinks.json`
- Regenerar APK con SHA-256 confirmado (issue #77)

### S19.4 — Cron schedules en n8n *(~30 min)*
- `mark-timed-out-chats` (cada 1 min)
- `reconcile-orphan-users` (1×/día)
- `archive-breadcrumbs` (1×/semana)

### S19.5 — Smoke con NETO *(1 día)*
- Tiro real CDMX 1 camioneta con MAPBOX activado
- Comparar métricas haversine vs Mapbox
- Confirmar APK abre sin barra Chrome
- Validar coords corregidas en mapa real

---

## 🧪 Sprint 20 — Field test + bug hunt *(variable, depende del campo)*

- Field test con choferes reales NETO (1-2 días)
- Cualquier issue reportado → `KNOWN_ISSUES.md` + priorizar
- UX feedback del dispatcher con tiros productivos

---

## 🛠 Sprint 21 — Robustez del split/merge *(3-4 días)*

> Issues abiertos por ADR-048 y ADR-047.

- **#108** `restructureDispatchInternal` → RPC Postgres atómica
- **#109** Surfacing visual de unassigned stops tras redistribuir
- **#110** Preservar depot override por chofer al redistribuir
- **#111** Banner comparativo "Antes 105 km · Ahora 95 km" tras redistribuir
- **#112** Confirm si las rutas tenían reorders manuales recientes
- **#95** Drag cross-route entre cards del tiro

---

## ⚡ Sprint 22 — Performance + observabilidad *(~1 semana)*

- **S22.1** Lighthouse audit driver PWA (bundle, TTI 3G)
- **S22.2** N+1 audit (`/routes`, `/dispatches`, `/dashboard`)
- **S22.3** Sentry / LogTail integración
- **#67** Paginación de listas
- **S22.4** Mover `dispatch_share_access_log` y observabilidad de enlaces públicos

---

## ✨ Sprint 23 — Polish + compliance *(~1 semana)*

- Custom domains:
  - `app.tripdrive.xyz` (platform)
  - `driver.tripdrive.xyz` (driver)
  - `admin.tripdrive.xyz` (control-plane)
  - `verdfrut.tripdrive.xyz` (tenant VerdFrut)
- **#20** Compresión defensiva iOS Low Power Mode
- % completitud paradas en `/routes`
- Backlog cosméticos: atacar 5-6 por sprint

---

## 🔧 Sprint 24 — Rebranding interno fase 2 *(~2 días)*

> ADR-049 fase 2: renombrar packages, cookies y tokens internos. Postergado hasta DESPUÉS del field test para evitar disruptión.

- `@verdfrut/*` → `@tripdrive/*` en `packages/*` y todos los `package.json`
- Aliasar `--vf-*` CSS vars → `--td-*` (mantener legacy 1 sprint)
- Cookie `vf-theme` → `td-theme` con fallback de lectura
- Rename repo GitHub `Verdfrut` → `TripDrive` (validar redirects)
- Crear org GitHub `@tripdrive` si no existe

---

## 🎯 Condicionales (triggers definidos)

### Sprint 25 — Multi-CEDIS formal *(si NETO abre CEDIS Toluca real)*
- Tabla pivot `depot_zones (depot_id, zone_id)` (#106)
- Zona "Toluca" formal en BD con sus stores asignados
- UI para depots cross-zone en `/settings/depots`

### Sprint 26 — Control Plane KPIs *(si llega 2º cliente)*
- Endpoint `POST /api/sync/[slug]` que pulla KPIs del tenant
- Cron diario en n8n
- Page `/` del CP con agregaciones reales (era Sprint 21 viejo)

### Sprint 27 — Onboarding Wizard *(post 2º cliente)*
- `provision-tenant.sh` portado a TS llamando Management API
- Modal "Onboardear cliente" en `/tenants/new`
- Polling de status `provisioning` → `active`
- Auto-config de redirect URLs

### Sprint 28 — Migración driver a Expo *(si iOS GPS background bloqueante)*
- Evaluar 4-8 semanas post field-test
- Triggers: iOS Safari GPS background, choferes piden "app real", App Store/Play Store presence
- 3-4 semanas de migración

---

## 📊 Vista temporal

```
┌──────────────────────────────────────────────────────────────────────┐
│ MAY 2026                                                             │
└──────────────────────────────────────────────────────────────────────┘
   ─ S19 Pre field-test (3-5d) ──┐
                                  └─ S20 Field test NETO (variable) ──┐
                                                                       │
   JUN 2026                                                            │
   ─ S21 Robustez split/merge (3-4d) ──────────────────────────────────┘
   ─ S22 Performance + observabilidad (1 sem)
   ─ S23 Polish + dominios .tripdrive.xyz (1 sem)

   JUL 2026
   ─ S24 Rebranding interno fase 2 (2d)
   ─ Backlog continuo + atender condicionales según triggers

   ┌──────────────────────────────────────────────────────────────────┐
   │ Triggers monitoreados continuamente:                              │
   │ • NETO abre CEDIS Toluca → S25                                    │
   │ • 2º cliente firmado     → S26, S27                               │
   │ • iOS GPS bloqueante     → S28                                    │
   └──────────────────────────────────────────────────────────────────┘
```

---

## ❌ Lo que NO va en este roadmap (intencional)

- **Custom features per cliente** (color de marca, logos): cuando aparezcan los pedidos.
- **Marketplace de choferes / ride-sharing logic**: no es el negocio.
- **App pública para consumidores finales**: no es el modelo.
- **Pagos en línea**: el cliente paga a TripDrive por canales tradicionales.
- **Multi-idioma**: solo es-MX hasta confirmar 2º mercado.
- **API pública para integraciones de 3ros**: no aplica V1-V2.
