-- ADR-095 / Feature gating por plan.
--
-- Por qué ahora: la landing pública ya promete sets de features distintos
-- por tier (Operación / Pro / Enterprise). Antes de cobrarle a NETO o
-- cualquier piloto, necesitamos un mecanismo que (1) mapee tier → features
-- y (2) permita overrides per-customer (ej: regalar AI a un Operación
-- durante piloto). El mapeo tier→features vive en código
-- (`@tripdrive/plans`); el override por-customer vive aquí.
--
-- Por qué jsonb y no tabla normalizada: 3 tiers fijos, ~7 features
-- estables, y los overrides son la excepción no la regla. Una tabla
-- `customer_features(customer_id, feature_key, enabled)` agregaría joins
-- en cada read sin ganar nada vs jsonb { ai: true, customDomain: false }.
-- Si crece a 30+ features dinámicas, migramos.
--
-- Por qué NO renombrar el enum `starter` → `operacion`:
-- - El enum está referenciado por código, seeds y RLS.
-- - Mapeo `starter` → "Operación" sólo en labels de UI (zero risk).
-- - Si en el futuro queremos rename, hacemos migration aparte.
--
-- Idempotente: re-run no rompe nada (ADD COLUMN IF NOT EXISTS).

BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS feature_overrides JSONB NOT NULL DEFAULT '{}'::JSONB;

COMMENT ON COLUMN customers.feature_overrides IS
  'ADR-095. Overrides de features por customer. Las keys deben matchear ' ||
  'PlanFeatures en @tripdrive/plans. Ejemplo: {"ai": true} para activar ' ||
  'AI en un customer Operación. Keys desconocidas se ignoran.';

COMMIT;
