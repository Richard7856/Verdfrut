# TripDrive

**SaaS multi-tenant para optimización y ejecución de rutas de reparto.**

🌐 [tripdrive.xyz](https://tripdrive.xyz) *(pendiente de configurar DNS)*

TripDrive (operador) provee el servicio a empresas distribuidoras. El primer cliente productivo es **VerdFrut** (alias *NETO Tiendas* en CDMX y Toluca). Cada cliente opera su flota desde el panel logístico, sus choferes ejecutan con la PWA, sus encargados de zona supervisan en vivo, y TripDrive ve KPIs agregados desde un panel super admin.

📖 **[PROJECT_BRIEF.md](./PROJECT_BRIEF.md)** — objetivo, decisiones arquitectónicas, convenciones, contratos.
📖 **[DECISIONS.md](./DECISIONS.md)** — ADRs detallados con alternativas y riesgos (49 al cierre).
📖 **[BRAND.md](./BRAND.md)** — guidelines de marca: nombre, dominio, paleta, tono.

> ⚠ **Nota de naming interno:** los packages del monorepo todavía se llaman `@tripdrive/*` (legacy del primer nombre). El rebranding a `@tripdrive/*` está documentado en ADR-049 y se ejecuta en una fase 2 atómica para no romper imports en medio del field test. Public-facing (UI, dominio, marca) ya dice TripDrive.

---

## Estructura del Monorepo

```
apps/
├── platform/         # Logística + Dashboard cliente (Next.js)
├── driver/           # PWA chofer + supervisor de zona (Next.js)
└── control-plane/    # Super admin TripDrive (Next.js)

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

## Estado del producto

| Sprint | Objetivo | Estado |
|---|---|---|
| 0 | Fundación: monorepo, schema base, Docker | ✅ |
| 1 | Logística mínima + optimizer VROOM | ✅ |
| 2 | Driver PWA con flujos de ejecución | ✅ |
| 3 | Supervisión + GPS realtime | ✅ |
| 4 | OCR de tickets (Claude Vision) | ✅ |
| 5 | Dashboard cliente con KPIs | ✅ |
| 6 | Control plane SaaS | ✅ |
| 17 | Sprint 17 — Foundation Control Plane | ✅ |
| 18 | Estabilización post field-test | ✅ |
| **19** | **Pre field-test cliente real (TripDrive×VerdFrut)** | 🚧 actual |

49 ADRs documentados. 31 migraciones tenant + 1 control plane. 4 servicios live en producción.

Detalles en [ROADMAP.md](./ROADMAP.md).

## Documentos clave

- [BRAND.md](./BRAND.md) — identidad TripDrive (nombre, dominio, paleta, tono)
- [PROJECT_BRIEF.md](./PROJECT_BRIEF.md) — objetivo, ADRs resumidos, convenciones, contratos
- [DECISIONS.md](./DECISIONS.md) — ADRs detallados con alternativas y riesgos
- [ROADMAP.md](./ROADMAP.md) — sprints actuales y futuros
- [BOOTSTRAP.md](./BOOTSTRAP.md) — cómo crear el primer admin y datos iniciales
- [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) — issues abiertos vivo

---

## Multi-tenant

Cada cliente tiene su propio proyecto Supabase. La resolución del tenant ocurre por subdominio:

- `verdfrut.tripdrive.xyz` → proyecto Supabase de VerdFrut (NETO)
- `<cliente>.tripdrive.xyz` → proyecto Supabase del cliente
- `driver.tripdrive.xyz` → app de chofer (tenant resuelto en login)
- `admin.tripdrive.xyz` → control plane TripDrive

El **registro de tenants** vive en `/etc/tripdrive/tenants.json` en el VPS (NUNCA en el repo). El package `@tripdrive/supabase/tenant-registry` lo lee con cache de 60s (renombre del package pendiente, ADR-049 fase 2).

Para provisionar un nuevo tenant:

```bash
SUPABASE_MANAGEMENT_API_TOKEN=xxx \
SUPABASE_ORG_ID=xxx \
./scripts/provision-tenant.sh <slug> "<Nombre Comercial>" America/Mexico_City
```

---

## Contribuir

Lee [PROJECT_BRIEF.md § Convenciones de Código](./PROJECT_BRIEF.md#convenciones-de-código) antes de mandar cambios. Cada decisión técnica no trivial debe quedar registrada en [DECISIONS.md](./DECISIONS.md) con formato ADR.
