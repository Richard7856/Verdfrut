# VerdFrut — Project Brief

## Objetivo del Sistema

Plataforma SaaS multi-tenant para optimización y ejecución de rutas de reparto. VerdFrut (operador) provee el servicio a empresas distribuidoras (Neto, OXXO, distribuidoras independientes). Cada cliente opera su flota desde el panel logístico, sus choferes ejecutan con la PWA, sus encargados de zona supervisan en vivo, y VerdFrut ve KPIs agregados desde un panel super admin.

**Tres capas funcionales:**
1. **Panel logístico (apps/platform):** crear/optimizar/aprobar/publicar rutas, gestionar tiendas/camiones/usuarios, dashboard de KPIs del cliente.
2. **App de chofer + supervisor (apps/driver):** PWA donde el chofer ejecuta su ruta paso a paso con evidencia, y el encargado de zona supervisa en tiempo real con mapa y chat.
3. **Control plane VerdFrut (apps/control-plane):** super admin que ve KPIs agregados de todos los clientes, onboardea nuevos clientes, gestiona billing.

**Flujo end-to-end:**
```
Logística arma plan → optimizador propone rutas → humano aprueba →
choferes ejecutan → encargados supervisan → datos al dashboard del cliente →
KPIs agregados al control plane VerdFrut
```

---

## Decisiones Arquitectónicas (ADRs)

> Las decisiones detalladas viven en [DECISIONS.md](./DECISIONS.md). Esta sección es resumen.

| ADR | Decisión | Resumen |
|-----|----------|---------|
| 001 | Multi-tenant: 1 proyecto Supabase por cliente | Aislamiento total entre competidores. Zonas dentro del cliente con RLS. |
| 002 | Optimizador: FastAPI + VROOM self-hosted | Costo fijo, ~50ms para 200 paradas. Evita $500-1000/mes de Google. |
| 003 | GPS: Supabase Realtime Broadcast (no DB writes) | Datos transitorios sin colapsar Postgres. |
| 004 | App de chofer: PWA primero, nativa si hace falta | Ship rápido. Migración a Expo solo si iOS bloquea operación. |
| 005 | Platform = una sola app con route groups | Logística + Dashboard comparten auth/tenant/datos. |
| 006 | Mapas: Mapbox GL JS | 50K free loads/mes, vector tiles, opción de self-host futuro. |

---

## Convenciones de Código

### Idioma
- **Código** (variables, funciones, clases, archivos): inglés
- **Comentarios:** español o inglés indistintamente
- **UI / textos al usuario:** español (mexicano)

### Naming
- Funciones TS: `camelCase` (`getUserRoutes`, `validateStore`)
- Funciones Python: `snake_case` (`optimize_routes`, `validate_input`)
- Booleanos: prefijos `is_`, `has_`, `can_` (`isActive`, `hasPermission`)
- Constantes: `UPPER_SNAKE` (`MAX_RETRIES`, `API_BASE_URL`)
- Archivos: `kebab-case` (`user-service.ts`, `route-optimizer.py`)
- Componentes React: `PascalCase` (`EvidenceUpload.tsx`)
- Tablas DB: `snake_case` plural (`stores`, `routes`, `delivery_reports`)

### Comentarios
Explican **por qué**, no qué.

```ts
// MAL: itera sobre choferes
// BIEN: solo notifica a choferes con ruta publicada hoy — los borradores
//       no deben recibir push para evitar confusión
```

### Funciones
1. Comentario de propósito (1 línea sobre qué problema resuelve)
2. Tipos TS estrictos (no `any`)
3. Edge cases documentados

### Errores
- Nunca silenciar (siempre log o propagate)
- Mensajes con contexto: qué se intentó, con qué input
- Integraciones externas: manejar timeout, auth fail, rate limit explícitamente

### Git
Format: `type(scope): description`
- Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`
- Ejemplo: `feat(driver): add GPS broadcast to route channel`

### DECISIONS.md
Cada decisión técnica no trivial se registra con: contexto, decisión, alternativas consideradas, riesgos/limitaciones, oportunidades de mejora.

---

## Variables de Entorno

### Apps de cliente (`apps/platform`, `apps/driver`)

```env
# Supabase del cliente (tenant)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_PROJECT_ID=

# Push notifications (mismas en todos los tenants)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@verdfrut.com

# Mapas
NEXT_PUBLIC_MAPBOX_TOKEN=
MAPBOX_DIRECTIONS_TOKEN=

# IA para tickets
ANTHROPIC_API_KEY=

# Optimizador
OPTIMIZER_URL=http://optimizer:8000
OPTIMIZER_API_KEY=

# App
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_TENANT_SLUG=
```

### Control Plane (`apps/control-plane`)

```env
# Supabase del control plane (NO de un cliente)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Registro de tenants
TENANT_REGISTRY_PATH=/etc/verdfrut/tenants.json

# Para provisioning automático
SUPABASE_MANAGEMENT_API_TOKEN=
```

### Optimizer (`services/optimizer`)

```env
VROOM_BIN_PATH=/usr/local/bin/vroom
OPTIMIZER_API_KEY=
LOG_LEVEL=info
PORT=8000
```

---

## Endpoints / Contratos Clave

### Optimizer (FastAPI)

```
POST /optimize
  Headers: Authorization: Bearer {OPTIMIZER_API_KEY}
  Body: {
    vehicles: [{
      id: number,
      capacity: [number],
      start: [lng, lat],
      end: [lng, lat],
      time_window: [unix_start, unix_end]
    }],
    jobs: [{
      id: number,
      location: [lng, lat],
      service: number,                    // segundos en parada
      time_windows: [[unix_start, unix_end]],
      amount: [number]                    // demanda
    }],
    matrix?: {
      durations: [[seconds]],
      distances: [[meters]]
    }
  }
  Response: {
    routes: [{
      vehicle_id: number,
      steps: [{ job_id, arrival, departure }],
      distance: number,
      duration: number,
      cost: number
    }],
    unassigned: [{ job_id, reason }],
    summary: { total_distance, total_duration, total_cost }
  }
```

### Platform — Rutas

```
POST /api/routes
  Body: { name, date, vehicle_ids[], stop_ids[] }
  Response: { id, status: 'DRAFT' }

POST /api/routes/{id}/optimize
  → llama optimizer
  Response: { id, status: 'OPTIMIZED', routes: [...] }

POST /api/routes/{id}/approve
  Response: { id, status: 'APPROVED' }

POST /api/routes/{id}/publish
  → push notification a choferes asignados
  Response: { id, status: 'PUBLISHED' }

PATCH /api/routes/{id}
  → modificación post-publicación crea nueva versión
```

### Driver — Reportar parada

```
POST /api/stops/{stop_id}/report
  Body: {
    type: 'entrega' | 'tienda_cerrada' | 'bascula',
    evidence: { [key]: image_url },
    ticket_data?: { numero, fecha, total, items[] },
    incident_details?: [{ producto, tipo, cantidad, motivo }]
  }
  Response: { id, status: 'submitted' }

PATCH /api/reports/{id}/resolve
  Body: { resolution_type: 'completa'|'parcial'|'sin_entrega'|'timed_out' }
```

### GPS Broadcast (Supabase Realtime)

```
Canal: gps:{route_id}
Evento: 'position'
Payload: { driver_id, lat, lng, speed, heading, ts }
```

### Control Plane — Sync diario

```
POST /api/control-plane/sync-tenant-kpis
  Headers: Authorization: Bearer {INTERNAL_TOKEN}
  Body: { tenant_slug, date }
  → Lee KPIs agregados del proyecto del tenant
  → Inserta en control plane
  Response: { synced_at, kpis_count }
```

---

## Lo que NO está en scope (V1)

- ❌ App nativa (iOS/Android wrapper) — se evalúa en Fase 7 si iOS bloquea operación
- ❌ Self-service onboarding de tenants — manual con script hasta 10+ clientes
- ❌ Billing automatizado — manual hasta 5+ clientes
- ❌ Predicciones ML (tráfico, demanda, mantenimiento) — fase posterior
- ❌ Integración con ERPs/SAP/Oracle de los clientes
- ❌ App pública para clientes finales (consumidores) — esto es B2B
- ❌ Pagos en línea — los clientes pagan a VerdFrut por canales tradicionales
- ❌ Marketplace de choferes — cada cliente trae los suyos
- ❌ Optimización multi-día (ruta de varios días)
- ❌ Notificaciones SMS/WhatsApp a tiendas — solo entre operadores internos
- ❌ Custom branding por cliente (white-label completo) — todos ven "VerdFrut"
- ❌ API pública para integraciones de terceros — solo APIs internas
- ❌ Versionado complejo de schema con downgrade — solo migraciones forward
- ❌ Soporte multi-idioma — solo español (mexicano)
- ❌ Admin panel completo (UI) — Supabase Studio es suficiente para Fase 0-3

---

## Stack Técnico

| Componente | Tecnología | Versión objetivo |
|-----------|-----------|------------------|
| Monorepo | Turborepo + pnpm | turbo 2.x, pnpm 9.x |
| Frontend (todas las apps) | Next.js App Router | 16.x |
| Lenguaje frontend | TypeScript | 5.x |
| Estilos | Tailwind CSS | 4.x |
| PWA (driver) | Serwist + IndexedDB | latest |
| Backend (apps) | Next.js Server Actions + Route Handlers | — |
| DB / Auth / Storage / Realtime | Supabase | latest |
| Mapas | Mapbox GL JS | 3.x |
| Optimización | FastAPI + VROOM | VROOM v1.14+ |
| OCR tickets | Anthropic Claude Vision | claude-sonnet-4-6 |
| Push notifications | VAPID web push | web-push 3.x |
| Automaciones | n8n | latest |
| Deploy | Docker + Traefik | Docker 24+, Traefik 3.x |
| VPS | Cualquier proveedor con Docker | — |

---

## Estructura del Monorepo

```
verdfrut/
├── apps/
│   ├── platform/          # Logística + Dashboard cliente
│   ├── driver/            # PWA chofer + supervisor de zona
│   └── control-plane/     # Super admin VerdFrut
├── packages/
│   ├── types/             # Interfaces TS compartidas
│   ├── supabase/          # Client factory tenant-aware
│   ├── ui/                # Componentes Tailwind
│   ├── maps/              # Wrapper Mapbox
│   ├── flow-engine/       # Máquina de flujos del driver
│   ├── ai/                # Wrapper Claude Vision
│   └── utils/             # Helpers compartidos
├── services/
│   └── optimizer/         # FastAPI + VROOM
├── supabase/
│   ├── migrations/        # SQL para proyectos cliente
│   └── control-plane/     # SQL para control plane
├── scripts/               # Provisioning, sync, mantenimiento
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
├── PROJECT_BRIEF.md       # Este archivo
├── DECISIONS.md
└── README.md
```

---

## Roadmap Resumido

| Fase | Objetivo | Estimado |
|------|----------|----------|
| 0 | Fundación: monorepo, schema base, Docker | 1-2 semanas |
| 1 | Logística mínima + optimizer | 2-3 semanas |
| 2 | Driver app con flujos de ejecución | 3-4 semanas |
| 3 | Supervisión + GPS realtime | 1-2 semanas |
| 4 | OCR de tickets | 1 semana |
| 5 | Dashboard de ventas del cliente | 1-2 semanas |
| 6 | Control plane VerdFrut | 1-2 semanas |
| 7 (futura) | Migración a nativa (si hace falta) | 6-8 semanas |
| 8 (futura) | Billing automatizado | 1 semana |

**Total V1 (Fases 0-6): ~10-15 semanas**
