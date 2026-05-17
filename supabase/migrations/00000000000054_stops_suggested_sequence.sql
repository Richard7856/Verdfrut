-- ADR-125 / 2026-05-16: el chofer puede customizar el orden de paradas
-- desde la app, pero queremos preservar el orden ORIGINAL del optimizer
-- (o del admin si publicó manualmente) para que pueda regresar a él en
-- cualquier momento con "Usar orden sugerido".
--
-- `stops.sequence` sigue siendo el orden OPERATIVO (el que el chofer ve y
-- ejecuta). `stops.suggested_sequence` es el snapshot que se hizo al publicar
-- la ruta. Si NULL, no se ha publicado todavía o es una ruta legacy.
--
-- Patrón de uso:
--   - Al transitar route a PUBLISHED, copiar sequence → suggested_sequence
--     para cada stop pending. Stops ya completados/skipped no se tocan.
--   - El chofer puede comparar sequence vs suggested_sequence en UI:
--     si difieren, mostrar badge "(sug: N)".
--   - "Usar orden sugerido" restaura sequence = suggested_sequence.

ALTER TABLE stops
  ADD COLUMN IF NOT EXISTS suggested_sequence INTEGER;

COMMENT ON COLUMN stops.suggested_sequence IS
  'Snapshot del orden sugerido por optimizer/admin al publicar la ruta. NULL = pre-ADR-125 o sin publicar. El driver puede usar este valor para volver al orden propuesto desde su UI.';

-- Backfill defensivo: rutas ya publicadas en producción hoy heredan el orden
-- actual como "sugerido". Aún si el chofer ya reordenó, esto les da un
-- baseline razonable (el orden al momento de aplicar la migración).
UPDATE stops
SET suggested_sequence = sequence
WHERE suggested_sequence IS NULL
  AND route_id IN (
    SELECT id FROM routes
    WHERE status IN ('PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'INTERRUPTED')
  );

-- ADR-125 (parte 2): timestamp para saber si el chofer ya confirmó el orden
-- (sugerido o customizado) la primera vez que abrió la ruta. Si NULL, la app
-- driver redirige a /route/accept para que vea el mapa y decida.
--
-- Caso de uso:
--   - Admin publica ruta → status=PUBLISHED, driver_order_confirmed_at=NULL.
--   - Chofer abre app → ve mapa con stops numerados (suggested_sequence).
--   - Chofer tappea "Usar orden sugerido" o customiza → confirma → server
--     setea driver_order_confirmed_at=now().
--   - Próximas aperturas: ya está confirmado, va directo a la vista normal.

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS driver_order_confirmed_at TIMESTAMPTZ;

COMMENT ON COLUMN routes.driver_order_confirmed_at IS
  'Timestamp cuando el chofer confirmó el orden (sugerido o customizado) al abrir la ruta por primera vez. NULL = aún no la abrió o pre-ADR-125. Driver app usa esto para gatillar el flow de mapa-primero.';

-- Backfill: rutas ya en flight (IN_PROGRESS, COMPLETED, etc.) o YA publicadas
-- hace tiempo NO deben pasar por el flow de aceptación retroactivamente. Las
-- marcamos como confirmadas hace 1 minuto (cualquier timestamp pasado funciona).
UPDATE routes
SET driver_order_confirmed_at = (now() - interval '1 minute')
WHERE driver_order_confirmed_at IS NULL
  AND status IN ('PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'INTERRUPTED');
