# Migraciones — Proyectos de Cliente (Tenant)

Estas migraciones se aplican a CADA proyecto Supabase de cliente (Neto, OXXO, etc.).

## Aplicar a un tenant
```bash
SUPABASE_PROJECT_ID=xxxxx supabase db push --db-url "$DB_URL"
```

## Aplicar a TODOS los tenants
```bash
pnpm migrate:all
```

## Convenciones
- Naming: `YYYYMMDDHHMMSS_descripcion.sql`
- Idempotentes cuando sea posible (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS`)
- RLS activado en TODAS las tablas que contienen datos por zona/usuario
- Comentarios en español explicando el porqué de cada decisión no-obvia
- Solo migraciones forward (no downgrade scripts)

## Estructura de archivos
- `00000000000001_extensions.sql` — Extensiones de Postgres
- `00000000000002_enums.sql` — Tipos enumerados
- `00000000000003_core_tables.sql` — Tablas centrales (zones, stores, vehicles, drivers, users)
- `00000000000004_route_tables.sql` — Rutas, paradas, breadcrumbs
- `00000000000005_report_tables.sql` — Reportes de entrega, mensajes
- `00000000000006_push_subscriptions.sql` — Push notifications
- `00000000000007_rls_policies.sql` — Políticas RLS por rol/zona
- `00000000000008_storage_buckets.sql` — Buckets de Storage
- `00000000000009_helper_functions.sql` — Functions / triggers / vistas
