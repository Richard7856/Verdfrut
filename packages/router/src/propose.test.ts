import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rankAndPickAlternatives, computeKRange } from './propose';
import { DEFAULT_COSTS, type CostBreakdown, type PlanMetrics } from './cost';

function makeOption(
  id: string,
  km: number,
  hrsTotal: number,
  maxHrs: number,
  vehicles: number,
  costTotal: number,
): {
  id: string;
  vehicleCount: number;
  metrics: PlanMetrics;
  cost: CostBreakdown;
  feasible: boolean;
  routes: readonly { vehicleId: string; driverId: string | null; stopCount: number; distanceKm: number; durationHours: number }[];
} {
  return {
    id,
    vehicleCount: vehicles,
    metrics: { totalKm: km, totalDriverHours: hrsTotal, vehicleCount: vehicles, maxDriverHours: maxHrs },
    cost: {
      total_mxn: costTotal,
      fuel_mxn: km * 2.5,
      wear_mxn: km * 0.5,
      labor_mxn: hrsTotal * 80,
      overhead_mxn: vehicles * 50,
    },
    feasible: maxHrs <= DEFAULT_COSTS.max_hours_per_driver,
    routes: [],
  };
}

describe('rankAndPickAlternatives — 3 categorías', () => {
  test('caso VerdFrut: 2-cam vs 3-cam, 3-cam es más rápido pero más caro', () => {
    const options = [
      makeOption('K2', 280, 12, 6, 2, 1800),  // 2 cam: barato + balanced
      makeOption('K3', 240, 11, 4, 3, 2150),  // 3 cam: más rápido + más caro
    ];

    const result = rankAndPickAlternatives(options, DEFAULT_COSTS);

    assert.equal(result.length, 2);
    // K2 debe ser cheapest + balanced (maxHrs=6 ≤ 7)
    const k2 = result.find((r) => r.id === 'K2')!;
    assert.ok(k2.labels.includes('cheapest'), `K2 labels: ${k2.labels}`);
    assert.ok(k2.labels.includes('balanced'));
    // K3 debe ser fastest
    const k3 = result.find((r) => r.id === 'K3')!;
    assert.ok(k3.labels.includes('fastest'));
  });

  test('si una opción gana las 3 categorías, aparece UNA vez con 3 labels', () => {
    const options = [
      makeOption('SOLO', 200, 8, 5, 2, 1500),  // gana todo
      makeOption('MAL', 350, 14, 8, 3, 2500),  // pierde todo
    ];

    const result = rankAndPickAlternatives(options, DEFAULT_COSTS);

    const solo = result.find((r) => r.id === 'SOLO')!;
    assert.deepEqual([...solo.labels].sort(), ['balanced', 'cheapest', 'fastest']);
    assert.equal(result.length, 1, 'no debe duplicar la misma opción');
  });

  test('opciones infactibles se descartan', () => {
    const options = [
      makeOption('TOO_LONG', 100, 12, 12, 1, 800),  // chofer 12hrs = infeasible
      makeOption('OK', 200, 9, 5, 2, 1200),
    ];

    const result = rankAndPickAlternatives(options, DEFAULT_COSTS);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, 'OK');
  });

  test('si NADA es factible, devuelve la "menos mala" sin labels (UX edge)', () => {
    const options = [
      makeOption('UGLY1', 100, 20, 11, 1, 1000),
      makeOption('UGLY2', 100, 18, 10, 1, 950),
    ];

    const result = rankAndPickAlternatives(options, DEFAULT_COSTS);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, 'UGLY2'); // maxHrs=10 < 11
    assert.deepEqual([...result[0]!.labels], []);
  });

  test('si no hay balanced (todas >7hrs pero ≤9hrs), omite categoría balanced', () => {
    const options = [
      makeOption('TIGHT1', 200, 9, 8, 2, 1500),  // maxHrs=8, no balanced
      makeOption('TIGHT2', 250, 9, 9, 2, 1650),
    ];

    const result = rankAndPickAlternatives(options, DEFAULT_COSTS);
    // No debe tener label 'balanced' en ninguna
    for (const r of result) {
      assert.ok(!r.labels.includes('balanced'), `${r.id} no debe tener balanced`);
    }
  });

  test('opciones vacías → array vacío', () => {
    assert.deepEqual(rankAndPickAlternatives([], DEFAULT_COSTS), []);
  });
});

describe('computeKRange', () => {
  test('caso VerdFrut: 21 stops, 3 vehículos disponibles', () => {
    const r = computeKRange(21, 3, DEFAULT_COSTS);
    // minK = ceil(21/14) = 2; maxK = min(3, floor(21/4)=5) = 3
    assert.equal(r.minK, 2);
    assert.equal(r.maxK, 3);
  });

  test('pocos stops, muchos vehículos', () => {
    const r = computeKRange(8, 10, DEFAULT_COSTS);
    // minK = ceil(8/14) = 1; maxK = min(10, floor(8/4)=2) = 2
    assert.equal(r.minK, 1);
    assert.equal(r.maxK, 2);
  });

  test('1 stop solo (edge): minK=maxK=1', () => {
    const r = computeKRange(1, 5, DEFAULT_COSTS);
    assert.equal(r.minK, 1);
    assert.equal(r.maxK, 1);
  });

  test('maxK nunca es menor que minK', () => {
    // 30 stops, 1 vehículo disponible: minK debería ser 3 (saturación), pero
    // solo hay 1 vehículo → maxK se fuerza a min(1, ...) que es <minK.
    // computeKRange protege con Math.max(minK, ...).
    const r = computeKRange(30, 1, DEFAULT_COSTS);
    assert.ok(r.maxK >= r.minK, `maxK=${r.maxK} debe ser ≥ minK=${r.minK}`);
  });
});
