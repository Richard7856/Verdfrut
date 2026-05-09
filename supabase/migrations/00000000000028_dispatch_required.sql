-- Migración 028 (ADR-040): toda ruta debe pertenecer a un tiro (dispatch).
--
-- Razón: el cliente pidió que el flujo siempre sea "tiro con N rutas dentro".
-- Antes una ruta podía existir suelta (`dispatch_id` NULL) — eso obligaba al
-- dispatcher a crear ruta, después tiro, después asociar (trabajo doble).
-- Con `dispatch_id NOT NULL` + auto-creación de tiro en `createAndOptimizeRoute`,
-- el flujo se simplifica: crear ruta → ya está dentro de un tiro → agregar más
-- rutas al mismo tiro es trivial.
--
-- Cambios:
--   1. Backfill: por cada combo (date, zone_id) con rutas huérfanas, crear UN tiro
--      "auto" y re-asociar las rutas. Rutas del mismo día/zona quedan en el mismo
--      tiro (más natural que un tiro por ruta).
--   2. ALTER routes.dispatch_id SET NOT NULL — constraint a nivel DB.
--   3. Cambiar FK ON DELETE de SET NULL a RESTRICT — no se puede borrar un tiro
--      con rutas vivas. El dispatcher debe cancelar/borrar las rutas primero.
--      Defensivo contra borrado accidental.
--
-- Idempotencia: el WHERE dispatch_id IS NULL del backfill hace que correr 2 veces
-- sea no-op (la 2ª vez no hay huérfanas). El ALTER NOT NULL falla si ya está
-- NOT NULL — usamos DO block para chequear.

BEGIN;

-- 1. Backfill: agrupar rutas huérfanas por (date, zone_id) en tiros nuevos.
WITH new_dispatches AS (
  INSERT INTO dispatches (name, date, zone_id, notes, created_by)
  SELECT
    'Tiro ' || to_char(d.date, 'DD/MM') || ' (auto)',
    d.date,
    d.zone_id,
    'Tiro creado automáticamente por migración 028 (ADR-040): agrupar rutas que existían antes del modelo dispatch_id NOT NULL.',
    -- Usamos el primer admin como created_by. Si no hay admin, fallar
    -- explícitamente (mejor que NULL).
    (SELECT id FROM user_profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1)
  FROM (
    SELECT DISTINCT date, zone_id FROM routes WHERE dispatch_id IS NULL
  ) d
  RETURNING id, date, zone_id
)
UPDATE routes r
SET dispatch_id = nd.id
FROM new_dispatches nd
WHERE r.dispatch_id IS NULL
  AND r.date = nd.date
  AND r.zone_id = nd.zone_id;

-- 2. NOT NULL constraint (idempotente — no falla si ya está NOT NULL).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'routes'
      AND column_name = 'dispatch_id'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE routes ALTER COLUMN dispatch_id SET NOT NULL;
  END IF;
END $$;

-- 3. Cambiar FK de ON DELETE SET NULL a ON DELETE RESTRICT.
-- DROP + ADD porque PG no permite ALTER del action directamente.
DO $$
BEGIN
  -- Solo recrear si el action actual NO es RESTRICT (idempotencia).
  IF (
    SELECT confdeltype FROM pg_constraint
    WHERE conname = 'routes_dispatch_id_fkey'
      AND conrelid = 'public.routes'::regclass
  ) <> 'r' THEN
    ALTER TABLE routes DROP CONSTRAINT routes_dispatch_id_fkey;
    ALTER TABLE routes ADD CONSTRAINT routes_dispatch_id_fkey
      FOREIGN KEY (dispatch_id) REFERENCES dispatches(id) ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
