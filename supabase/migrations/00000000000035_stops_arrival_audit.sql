-- Anti-fraude metadata en stops (ADR-084).
--
-- Razón: ADR-083 identificó AV-#7 (mock location) y AV-#8 (markArrived bypass).
-- Mientras movemos la validación a Edge Function (issue #179), agregamos
-- columnas de audit que la app native popula al `markArrived`. Permite al
-- supervisor + dashboards detectar patrones sospechosos:
--   - `arrival_was_mocked=true` → Dev Options activado al checkin.
--   - `arrival_distance_meters` muy bajo siempre → posible spoofing GPS.
--   - `arrival_accuracy_meters` muy alto (>50) → señal débil, mucho margen.
--
-- Las columnas son NULLABLE — los stops legacy NO las tienen y el web
-- driver actual NO las popula tampoco (solo el native). En Stream A se
-- considera obligatorio popular siempre via Edge Function.

ALTER TABLE stops
  ADD COLUMN IF NOT EXISTS arrival_was_mocked BOOLEAN,
  ADD COLUMN IF NOT EXISTS arrival_distance_meters INT,
  ADD COLUMN IF NOT EXISTS arrival_accuracy_meters FLOAT;

COMMENT ON COLUMN stops.arrival_was_mocked IS
  'TRUE si el GPS del chofer reportó pos.mocked=true (Mock Location en Dev Options Android). NULL si markArrived no popula (web driver legacy).';

COMMENT ON COLUMN stops.arrival_distance_meters IS
  'Distancia haversine en metros del chofer a la tienda al momento de markArrived. Para detectar spoof (muchos checkins exactamente a 0m).';

COMMENT ON COLUMN stops.arrival_accuracy_meters IS
  'Precisión GPS reportada por el device al markArrived. >50m = señal débil.';
