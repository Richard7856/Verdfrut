-- ADR-108 / UX-Routes: flag para distinguir rutas aprobadas manualmente
-- vs las que pasaron por VROOM.
--
-- El estado machine `DRAFT → OPTIMIZED → APPROVED → PUBLISHED` obligaba
-- al dispatcher a correr el optimizer aunque ya tuviera el orden de
-- paradas correcto (visual builder, edits manuales, etc.). VROOM
-- re-ordenaba y le borraba el trabajo.
--
-- Solución: permitir aprobar DESDE DRAFT, computando métricas básicas con
-- haversine (en lugar de VROOM). El flag aquí marca esas rutas para que:
--   - El badge de UI muestre "manual" en lugar de "optimizada"
--   - Reportería pueda medir adopción real del optimizer
--   - El chofer en su app vea un aviso de "secuencia armada manualmente,
--     no optimizada"
--
-- Idempotente — ADD COLUMN IF NOT EXISTS.

BEGIN;

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS optimization_skipped BOOLEAN NOT NULL DEFAULT false;

-- Backfill: rutas existentes (todas pasaron por OPTIMIZED) quedan en false,
-- que es el default. No hay nada que migrar.

COMMIT;
