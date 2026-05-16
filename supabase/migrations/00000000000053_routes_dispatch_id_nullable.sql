-- ADR-119 / UX-Fase 3: relax routes.dispatch_id NOT NULL.
--
-- Contexto: ADR-040 (2026-04) hizo dispatch_id NOT NULL bajo el principio
-- "toda ruta vive dentro de un tiro". Eso quedó obsoleto cuando /dia
-- emergió como entry-point primario donde el dispatcher piensa en términos
-- de "rutas del día" sin necesidad de un contenedor explícito.
--
-- Cambio MÍNIMO (Opción A del plan UX-Fase 3): solo relajar la restricción.
-- Las rutas existentes mantienen su dispatch_id; las nuevas PUEDEN crearse
-- huérfanas si el flow lo requiere (typical: ruta creada desde /dia sin
-- "Armar tiro" previo).
--
-- NO se elimina el concepto dispatch — la tabla y URLs `/dispatches/[id]`
-- siguen funcionando para data legacy y para casos donde sí tiene sentido
-- agrupar (presentación al cliente, share token, etc.). Eliminación
-- completa del concepto plan queda diferida a UX-Fase 3b si emerge demanda.
--
-- Idempotente: el ALTER COLUMN DROP NOT NULL no falla si la columna ya es
-- nullable (no-op). PG no tiene `IF NOT NULL` en este DDL así que el
-- escape es try-block. Como es deploy-once, lo dejamos directo.

BEGIN;

ALTER TABLE routes ALTER COLUMN dispatch_id DROP NOT NULL;

-- No backfill necesario — todas las rutas existentes tienen dispatch_id
-- válido (heredado de ADR-040). El campo simplemente acepta NULL para
-- creaciones futuras.

COMMIT;
