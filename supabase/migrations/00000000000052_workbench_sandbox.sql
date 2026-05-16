-- ADR-112 / Workbench WB-1: flag is_sandbox para "modo planeación".
--
-- El concepto Workbench separa "operación diaria" (lo que pasa hoy) de
-- "planeación estratégica" (escenarios, comparativas, what-if). WB-1 es la
-- foundation: un flag is_sandbox por fila en las tablas operativas y de
-- catálogo. Cuando el admin activa el toggle "🧪 Modo planeación":
--   - Las queries devuelven SOLO filas con is_sandbox=true.
--   - Las creaciones tag automáticamente is_sandbox=true.
--   - El cambio NO afecta nada de la operación real (is_sandbox=false).
--
-- Sandbox COMPARTIDO por customer — todos los admins/dispatchers del
-- mismo cliente trabajan sobre el mismo espacio de planeación (colaborativo).
--
-- Tablas afectadas:
--   • dispatches, routes, stops      → tiros/rutas/paradas sandbox
--   • stores, vehicles, drivers      → catálogo: el admin puede meter una
--                                       tienda/camioneta/chofer hipotético
--                                       para simular sin ensuciar el real.
--
-- NOT included en WB-1 foundation:
--   • zones, depots — infraestructura. Si llega un escenario que las pida,
--     se agrega en WB-3/WB-4.
--
-- Idempotente. Sin backfill: todas las filas existentes quedan en false
-- (default), que es lo correcto — todo lo de hoy ES operación real.

BEGIN;

ALTER TABLE dispatches  ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE routes      ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stops       ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stores      ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vehicles    ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE drivers     ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT false;

-- Índices parciales (solo filas sandbox) para que las queries filtradas por
-- is_sandbox=true sean rápidas sin penalizar el path operativo (que es el
-- 99% del uso). El planner usa el partial index cuando el filtro lo permite.
CREATE INDEX IF NOT EXISTS dispatches_sandbox_idx
  ON dispatches (customer_id) WHERE is_sandbox = true;
CREATE INDEX IF NOT EXISTS routes_sandbox_idx
  ON routes (customer_id) WHERE is_sandbox = true;
CREATE INDEX IF NOT EXISTS stops_sandbox_idx
  ON stops (route_id) WHERE is_sandbox = true;
CREATE INDEX IF NOT EXISTS stores_sandbox_idx
  ON stores (customer_id) WHERE is_sandbox = true;
CREATE INDEX IF NOT EXISTS vehicles_sandbox_idx
  ON vehicles (customer_id) WHERE is_sandbox = true;
CREATE INDEX IF NOT EXISTS drivers_sandbox_idx
  ON drivers (customer_id) WHERE is_sandbox = true;

COMMIT;
