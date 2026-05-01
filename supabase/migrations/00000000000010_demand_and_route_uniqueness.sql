-- Migración 010 — añade columna `demand` a stores (C5) y constraint UNIQUE en routes (#2).
-- Idempotente.

-- ============================================================================
-- C5 — Demand multidimensional por tienda
-- ============================================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS demand INTEGER[] NOT NULL DEFAULT ARRAY[100, 1, 5];

COMMENT ON COLUMN stores.demand IS
  'Demanda típica de la tienda en una entrega [peso_kg, volumen_m3, cajas]. Comparada contra vehicle.capacity por el optimizador.';

-- ============================================================================
-- #2 — Evitar rutas duplicadas para el mismo (vehicle, date) en estados activos
-- ============================================================================

-- Permite múltiples rutas para el mismo camión-día SIEMPRE Y CUANDO las anteriores
-- estén canceladas. Una operación normal nunca debe tener 2 rutas activas para
-- un mismo camión el mismo día.
CREATE UNIQUE INDEX IF NOT EXISTS idx_routes_vehicle_date_active
  ON routes (vehicle_id, date)
  WHERE status IN ('DRAFT', 'OPTIMIZED', 'APPROVED', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED');
