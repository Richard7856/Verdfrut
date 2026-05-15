import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COSTS,
  parseCostsConfig,
  computePlanCost,
  computeCostBreakdown,
  isPlanFeasible,
} from './cost';

describe('parseCostsConfig — defensa contra jsonb mal formado', () => {
  test('null → defaults', () => {
    assert.deepEqual(parseCostsConfig(null), DEFAULT_COSTS);
  });

  test('objeto vacío → defaults', () => {
    assert.deepEqual(parseCostsConfig({}), DEFAULT_COSTS);
  });

  test('keys parciales se mergean con defaults', () => {
    const result = parseCostsConfig({ cost_per_km_fuel_mxn: 3.0 });
    assert.equal(result.cost_per_km_fuel_mxn, 3.0);
    assert.equal(result.cost_per_km_wear_mxn, DEFAULT_COSTS.cost_per_km_wear_mxn);
  });

  test('valor fuera de rango → cae a default', () => {
    const result = parseCostsConfig({ cost_per_km_fuel_mxn: -5 });
    assert.equal(result.cost_per_km_fuel_mxn, DEFAULT_COSTS.cost_per_km_fuel_mxn);
  });

  test('valor con tipo wrong → cae a default', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = parseCostsConfig({ driver_hourly_wage_mxn: 'cien' as any });
    assert.equal(result.driver_hourly_wage_mxn, DEFAULT_COSTS.driver_hourly_wage_mxn);
  });

  test('non-object input → defaults', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.deepEqual(parseCostsConfig('garbage' as any), DEFAULT_COSTS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.deepEqual(parseCostsConfig(42 as any), DEFAULT_COSTS);
  });
});

describe('computePlanCost — fórmula MXN', () => {
  test('plan vacío (0 km, 0 hrs, 0 vehículos) → 0', () => {
    const cost = computePlanCost(
      { totalKm: 0, totalDriverHours: 0, vehicleCount: 0, maxDriverHours: 0 },
      DEFAULT_COSTS,
    );
    assert.equal(cost, 0);
  });

  test('cálculo VerdFrut típico (100 km, 8 hrs, 2 vehículos)', () => {
    const cost = computePlanCost(
      { totalKm: 100, totalDriverHours: 8, vehicleCount: 2, maxDriverHours: 5 },
      DEFAULT_COSTS,
    );
    // fuel: 100 * 2.5 = 250
    // wear: 100 * 0.5 = 50
    // labor: 8 * 80 = 640
    // overhead: 2 * 50 = 100
    // total: 1040
    assert.equal(cost, 1040);
  });

  test('redondeo a centavos (2 decimales)', () => {
    const cost = computePlanCost(
      { totalKm: 1.333, totalDriverHours: 0.5, vehicleCount: 1, maxDriverHours: 0.5 },
      DEFAULT_COSTS,
    );
    // fuel: 1.333 * 2.5 = 3.3325
    // wear: 1.333 * 0.5 = 0.6665
    // labor: 0.5 * 80 = 40
    // overhead: 1 * 50 = 50
    // total: 93.999 → 94.00
    assert.equal(cost, 94);
  });
});

describe('computeCostBreakdown', () => {
  test('breakdown suma al total', () => {
    const b = computeCostBreakdown(
      { totalKm: 100, totalDriverHours: 8, vehicleCount: 2, maxDriverHours: 5 },
      DEFAULT_COSTS,
    );
    assert.equal(b.fuel_mxn, 250);
    assert.equal(b.wear_mxn, 50);
    assert.equal(b.labor_mxn, 640);
    assert.equal(b.overhead_mxn, 100);
    assert.equal(b.total_mxn, 1040);
    assert.equal(b.fuel_mxn + b.wear_mxn + b.labor_mxn + b.overhead_mxn, b.total_mxn);
  });
});

describe('isPlanFeasible', () => {
  test('chofer dentro de jornada → feasible', () => {
    assert.equal(
      isPlanFeasible(
        { totalKm: 50, totalDriverHours: 7, vehicleCount: 1, maxDriverHours: 7 },
        DEFAULT_COSTS,
      ),
      true,
    );
  });

  test('chofer excede 9 hrs → infeasible', () => {
    assert.equal(
      isPlanFeasible(
        { totalKm: 50, totalDriverHours: 10, vehicleCount: 1, maxDriverHours: 10 },
        DEFAULT_COSTS,
      ),
      false,
    );
  });

  test('borderline exacto = 9 hrs → feasible (LFT permite)', () => {
    assert.equal(
      isPlanFeasible(
        { totalKm: 50, totalDriverHours: 9, vehicleCount: 1, maxDriverHours: 9 },
        DEFAULT_COSTS,
      ),
      true,
    );
  });
});
