-- =============================================================================
-- VerdFrut — Cleanup operational data
-- =============================================================================
-- Borra TODA la data operativa (rutas, paradas, reportes, mensajes) pero CONSERVA
-- el catálogo (zonas, depots, tiendas, vehículos, choferes, usuarios).
--
-- Uso típico: pre-launch a un cliente real. Quitar la data demo/seed pero dejar
-- la estructura organizacional (zona CDMX, las 10 tiendas, vehículos, drivers)
-- para que el cliente arranque con su catálogo ya cargado y solo agregue rutas
-- nuevas con su data real.
--
-- IDEMPOTENTE: se puede correr múltiples veces sin error.
-- DESTRUCTIVO: NO HAY ROLLBACK más allá de un backup. Considera hacer snapshot
-- de Supabase antes de correr (Dashboard → Database → Backups).
--
-- Cómo correrlo:
--   - Vía Supabase Studio → SQL Editor → pega y ejecuta
--   - Vía psql: PGPASSWORD=<db_pass> psql <DB_URL> -f scripts/cleanup-operational-data.sql
--   - Vía MCP: usa execute_sql con el contenido de este archivo

BEGIN;

-- 1. Mensajes del chat (FK a delivery_reports)
DELETE FROM public.messages;

-- 2. Reports de entrega (FK a stops y a routes)
DELETE FROM public.delivery_reports;

-- 3. Stops (FK a routes)
DELETE FROM public.stops;

-- 4. Routes (FK a dispatches)
DELETE FROM public.routes;

-- 5. Dispatches
DELETE FROM public.dispatches;

-- 6. Breadcrumbs históricos del GPS (no FK relevante)
DELETE FROM public.route_breadcrumbs;

-- 7. Push subscriptions huérfanas (opcional — útil si los choferes test ya no van a operar)
-- Comentado por default para evitar borrar suscripciones legítimas en re-runs.
-- DELETE FROM public.push_subscriptions WHERE user_id NOT IN (SELECT id FROM public.user_profiles WHERE is_active = true);

-- 8. (Opcional) Reset de auto-increment en tablas con sequence — no aplica, todas usan UUID

-- LO QUE NO SE BORRA (catálogo):
--   - public.zones
--   - public.depots
--   - public.stores
--   - public.vehicles
--   - public.drivers
--   - public.user_profiles  (admin, dispatcher, zone_manager, drivers — todos siguen)
--   - public.tenants_settings (si existe)
--   - control_plane.*  (registro de tenants y KPI snapshots — no se toca)
--   - auth.users (las cuentas siguen vivas)

-- Verificación post-cleanup
SELECT
  'routes'              AS tabla, COUNT(*) AS rows FROM public.routes
UNION ALL SELECT 'stops',              COUNT(*) FROM public.stops
UNION ALL SELECT 'dispatches',         COUNT(*) FROM public.dispatches
UNION ALL SELECT 'delivery_reports',   COUNT(*) FROM public.delivery_reports
UNION ALL SELECT 'messages',           COUNT(*) FROM public.messages
UNION ALL SELECT 'route_breadcrumbs',  COUNT(*) FROM public.route_breadcrumbs
UNION ALL SELECT 'zones (preserved)',  COUNT(*) FROM public.zones
UNION ALL SELECT 'stores (preserved)', COUNT(*) FROM public.stores
UNION ALL SELECT 'drivers (preserved)', COUNT(*) FROM public.drivers
UNION ALL SELECT 'users (preserved)',  COUNT(*) FROM public.user_profiles
ORDER BY tabla;

COMMIT;

-- Después de correr esto:
-- 1. Verifica que las primeras 6 filas (operativos) muestran 0
-- 2. Verifica que el catálogo (zones, stores, drivers, users) sigue intacto
-- 3. Carga las rutas reales del cliente vía la UI o vía CSV import
