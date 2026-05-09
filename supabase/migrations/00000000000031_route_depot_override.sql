-- Migración 031 (ADR-047): override de depot al nivel ruta.
--
-- Razón: hoy el depot/CEDIS de salida vive en `vehicles` (depot_id, depot_lat/lng).
-- Esto ata cada vehículo a un solo depot — si el cliente abre múltiples CEDIS y
-- quiere rotar el origen por tiro/ruta, hay que cambiar el depot del vehículo
-- (con efectos colaterales sobre otras rutas activas) o crear vehículos
-- "duplicados" por depot. Ambos malos.
--
-- Solución: una columna `depot_override_id` en routes que, cuando está seteada,
-- toma precedencia sobre el depot del vehículo SOLO para esa ruta.
--
-- Resolución del depot:
--   1. route.depot_override_id  → si NOT NULL, usar este depot
--   2. vehicle.depot_id         → fallback al depot del vehículo
--   3. vehicle.depot_lat/lng    → fallback final a coords manuales
--
-- ON DELETE RESTRICT: si alguien intenta borrar un depot referenciado por una
-- ruta, falla — protección contra borrados accidentales con rutas históricas.

BEGIN;

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS depot_override_id UUID NULL
    REFERENCES depots (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS routes_depot_override_idx
  ON routes (depot_override_id)
  WHERE depot_override_id IS NOT NULL;

COMMENT ON COLUMN routes.depot_override_id IS
  'Override del depot de salida/regreso para esta ruta. Si NULL, hereda del vehículo. Si NOT NULL, sobrescribe vehicle.depot_id para esta ruta específica (ADR-047).';

COMMIT;
