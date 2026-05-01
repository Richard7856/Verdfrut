# VerdFrut

SaaS multi-tenant para optimización y ejecución de rutas de reparto.

VerdFrut (operador) provee el servicio a empresas distribuidoras (Neto, OXXO, etc.). Cada cliente opera su flota desde el panel logístico, sus choferes ejecutan con la PWA, sus encargados de zona supervisan en vivo, y VerdFrut ve KPIs agregados desde un panel super admin.

📖 **[PROJECT_BRIEF.md](./PROJECT_BRIEF.md)** — objetivo, decisiones arquitectónicas, convenciones, contratos.
📖 **[DECISIONS.md](./DECISIONS.md)** — ADRs detallados con alternativas y riesgos.

---

## Estructura del Monorepo

```
apps/
├── platform/         # Logística + Dashboard cliente (Next.js)
├── driver/           # PWA chofer + supervisor de zona (Next.js)
└── control-plane/    # Super admin VerdFrut (Next.js)

packages/
├── types/            # Interfaces TS compartidas
├── supabase/         # Client factory tenant-aware
├── ui/               # Componentes Tailwind
├── maps/             # Wrapper Mapbox GL JS
├── flow-engine/      # Máquina de flujos del driver
├── ai/               # Wrapper Claude Vision
└── utils/            # Helpers (GPS, fechas, imágenes)

services/
└── optimizer/        # FastAPI + VROOM (Docker, Python)

supabase/
├── migrations/       # SQL para proyectos cliente (tenant)
└── control-plane/    # SQL para proyecto control plane

scripts/
├── provision-tenant.sh
└── migrate-all-tenants.sh
```

---

## Quickstart (desarrollo)

### Prerequisitos
- Node.js 20+
- pnpm 9+
- Docker (para optimizer y deploy local)
- Python 3.12+ (para optimizer en dev sin Docker)
- Cuenta de Supabase
- Token de Mapbox
- Token de Anthropic

### Instalación

```bash
pnpm install
cp .env.example apps/platform/.env.local   # configurar valores
cp .env.example apps/driver/.env.local
```

### Levantar todo en dev

```bash
# Terminal 1 — optimizer (Docker)
docker compose up optimizer

# Terminal 2 — apps Next.js (todas en paralelo via Turbo)
pnpm dev
```

### Comandos comunes

```bash
pnpm build               # build de todo
pnpm dev                 # dev de todas las apps en paralelo
pnpm type-check          # validar tipos en todo el monorepo
pnpm lint                # lint
pnpm format              # formatear con Prettier

pnpm provision:tenant    # ./scripts/provision-tenant.sh
pnpm migrate:all         # aplicar migraciones a todos los tenants
```

---

## Roadmap

| Fase | Objetivo | Estado |
|------|----------|--------|
| 0 | Fundación: monorepo, schema base, Docker | ✅ Completa |
| 1 | Logística mínima + optimizer | ✅ Completa |
| 2 | Driver app con flujos de ejecución | 🔜 Siguiente — ver [FASE_2_KICKOFF.md](./FASE_2_KICKOFF.md) |
| 3 | Supervisión + GPS realtime | 🔜 |
| 4 | OCR de tickets | 🔜 |
| 5 | Dashboard de ventas del cliente | 🔜 |
| 6 | Control plane VerdFrut | 🔜 |
| 7 (futura) | Migración a nativa (si hace falta) | — |
| 8 (futura) | Billing automatizado | — |

Detalles en [PROJECT_BRIEF.md](./PROJECT_BRIEF.md#roadmap-resumido).

## Documentos clave

- [PROJECT_BRIEF.md](./PROJECT_BRIEF.md) — objetivo, ADRs resumidos, convenciones, contratos
- [DECISIONS.md](./DECISIONS.md) — ADRs detallados con alternativas y riesgos
- [BOOTSTRAP.md](./BOOTSTRAP.md) — cómo crear el primer admin y datos iniciales
- [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) — issues abiertos vivo (cierre = eliminación)
- [FASE_2_KICKOFF.md](./FASE_2_KICKOFF.md) — plan de arranque para Fase 2 (driver app)

---

## Multi-tenant

Cada cliente (Neto, OXXO, etc.) tiene su propio proyecto Supabase. La resolución del tenant ocurre por subdominio:

- `neto.verdfrut.com` → proyecto Supabase de Neto
- `oxxo.verdfrut.com` → proyecto Supabase de OXXO
- `driver.verdfrut.com` → app de chofer (tenant resuelto en login)
- `admin.verdfrut.com` → control plane VerdFrut

El **registro de tenants** vive en `/etc/verdfrut/tenants.json` en el VPS (NUNCA en el repo). El package `@verdfrut/supabase/tenant-registry` lo lee con cache de 60s.

Para provisionar un nuevo tenant:

```bash
SUPABASE_MANAGEMENT_API_TOKEN=xxx \
SUPABASE_ORG_ID=xxx \
./scripts/provision-tenant.sh neto "Tiendas Neto" America/Mexico_City
```

---

## Contribuir

Lee [PROJECT_BRIEF.md § Convenciones de Código](./PROJECT_BRIEF.md#convenciones-de-código) antes de mandar cambios. Cada decisión técnica no trivial debe quedar registrada en [DECISIONS.md](./DECISIONS.md) con formato ADR.
