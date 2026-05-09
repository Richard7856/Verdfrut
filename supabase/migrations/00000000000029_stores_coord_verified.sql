-- Migración 029 (ADR-042): trazabilidad de calidad de geocoding por tienda.
--
-- Razón: las tiendas Toluca (`TOL-*`) se cargaron con coords aproximadas
-- vía Nominatim a nivel municipio (margen 100m–2km). Las CDMX (`CDMX-*`)
-- vinieron con lat/lng exactas del xlsx EXPANSION del cliente. La columna
-- `coord_verified` distingue ambos casos para que:
--   - el optimizer pueda excluir/advertir sobre tiendas no verificadas
--   - reportes muestren cuáles tiendas necesitan refinar coords
--   - el script de geocoding (scripts/geocode-toluca-stores.mjs) las marque
--     como verified=true después de re-geocodificar con Google.
--
-- Default false: filosofía conservadora — toda tienda nueva queda como NO
-- verificada hasta que un proceso explícito (script o admin manual) confirme.

BEGIN;

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS coord_verified BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN stores.coord_verified IS
  'true = lat/lng confirmadas (xlsx oficial del cliente, Google Geocoding API, o validación manual). false = aproximadas (Nominatim, pendiente refinar).';

-- Backfill: las tiendas CDMX-* venían con lat/lng exactas en el xlsx EXPANSION
-- del cliente, las marcamos como verified.
UPDATE stores SET coord_verified = true WHERE code LIKE 'CDMX-%';

-- Las TOL-* se quedan como false (Nominatim aproximado). El script las refina.

COMMIT;
