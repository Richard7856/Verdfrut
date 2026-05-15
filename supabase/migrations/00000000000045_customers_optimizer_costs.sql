-- ADR-100 / OE-2: Costos por customer para el Optimization Engine.
--
-- El feature `propose_route_plan` calcula 3 alternativas y las rankea por
-- costo MXN. Los constants (combustible, salario chofer, peajes, overhead)
-- varían por customer:
--   - Combustible: VerdFrut/NETO opera Kangoo (14 km/l). Otro cliente
--     puede operar camiones más grandes (8 km/l).
--   - Salario chofer: zona CDMX vs Toluca tienen costos distintos.
--   - Overhead despacho: cliente con CEDIS propio paga menos que cliente
--     que renta el espacio.
--
-- Por qué jsonb: los costos son ~5 escalares por customer, raramente
-- editables. Una tabla normalizada agregaría joins sin valor. Idéntico
-- patrón que customers.feature_overrides (ADR-095, migration 043).
--
-- Defaults (mercado MX 2026, OPTIMIZATION_ENGINE.md líneas 215-218):
--   cost_per_km_fuel_mxn:      2.5  (Kangoo 14 km/l, gasolina $35/litro 2026)
--   cost_per_km_wear_mxn:      0.5  (mantenimiento + amortización lineal)
--   driver_hourly_wage_mxn:    80   (~$15k/mes a 200 hrs, chofer MX)
--   dispatch_overhead_mxn:     50   (overhead admin por despacho/día)
--   max_hours_per_driver:      9    (jornada legal LFT MX)
--   max_stops_per_vehicle:     14   (heurística operacional VerdFrut)
--
-- Constraints: tomamos defaults razonables; cada customer puede overridear
-- via UI admin (a implementar en Sprint OE-3 / post-demo).
--
-- Idempotente: re-run no rompe nada (ADD COLUMN IF NOT EXISTS).

BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS optimizer_costs JSONB NOT NULL DEFAULT '{
    "cost_per_km_fuel_mxn": 2.5,
    "cost_per_km_wear_mxn": 0.5,
    "driver_hourly_wage_mxn": 80,
    "dispatch_overhead_mxn": 50,
    "max_hours_per_driver": 9,
    "max_stops_per_vehicle": 14
  }'::JSONB;

COMMENT ON COLUMN customers.optimizer_costs IS
  'ADR-100 / OE-2. Constantes de costo para ranking de alternativas de ' ||
  'ruta. Las keys deben matchear OptimizerCostsConfig en @tripdrive/router. ' ||
  'Defaults para MX 2026; customer admin puede overridear via UI.';

COMMIT;
