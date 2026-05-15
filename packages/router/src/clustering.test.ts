// Tests de la Capa 1 (clustering). Corre con:
//   pnpm --filter @tripdrive/router test
// No usa vitest/jest — solo node --test built-in para evitar dep extra.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { clusterStops, centroid } from './clustering';
import type { GeoPoint } from './types';

// Helper: stop con id generado a partir de coords (legible en errores).
function stop(id: string, lat: number, lng: number): GeoPoint {
  return { id, lat, lng };
}

describe('clusterStops — casos básicos', () => {
  test('k=1 devuelve un solo cluster con todos los stops', () => {
    const stops = [stop('a', 19.4, -99.1), stop('b', 19.5, -99.2)];
    const result = clusterStops(stops, 1);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.length, 2);
  });

  test('stops.length === k → cada stop su propio cluster', () => {
    const stops = [
      stop('a', 19.4, -99.1),
      stop('b', 19.5, -99.2),
      stop('c', 19.6, -99.3),
    ];
    const result = clusterStops(stops, 3);
    assert.equal(result.length, 3);
    for (const c of result) assert.equal(c.length, 1);
  });

  test('stops vacío → array vacío', () => {
    assert.deepEqual(clusterStops([], 3), []);
  });

  test('k=0 lanza error', () => {
    assert.throws(() => clusterStops([stop('a', 0, 0)], 0));
  });

  test('k > stops.length se trunca a stops.length', () => {
    const stops = [stop('a', 19, -99), stop('b', 20, -98)];
    const result = clusterStops(stops, 10);
    assert.equal(result.length, 2);
  });
});

describe('clusterStops — determinismo', () => {
  test('mismo input → mismo output (100 runs)', () => {
    const stops = Array.from({ length: 30 }, (_, i) =>
      stop(`s${i}`, 19.3 + Math.sin(i) * 0.1, -99.15 + Math.cos(i) * 0.1),
    );
    const first = clusterStops(stops, 4);
    for (let i = 0; i < 100; i++) {
      const again = clusterStops(stops, 4);
      assert.deepEqual(again, first);
    }
  });

  test('determinístico aún con coordenadas duplicadas (tie-break por id)', () => {
    // Cinco stops con coords idénticas + uno distinto → bisección debe
    // resolver el tie-break con id, no con orden de inserción.
    const dupes = [
      stop('e', 19.4, -99.1),
      stop('a', 19.4, -99.1),
      stop('c', 19.4, -99.1),
      stop('b', 19.4, -99.1),
      stop('d', 19.4, -99.1),
      stop('z', 20.0, -99.0),
    ];
    const r1 = clusterStops(dupes, 2);
    const r2 = clusterStops([...dupes].reverse(), 2);
    // Los clusters resultantes deben contener los mismos IDs sin importar
    // el orden de entrada.
    const ids1 = r1.map((c) => c.map((s) => s.id).sort()).sort();
    const ids2 = r2.map((c) => c.map((s) => s.id).sort()).sort();
    assert.deepEqual(ids1, ids2);
  });
});

describe('clusterStops — balance', () => {
  test('30 stops, k=3 → clusters de tamaño 10/10/10', () => {
    const stops = Array.from({ length: 30 }, (_, i) =>
      stop(`s${i}`, 19.3 + (i % 6) * 0.05, -99.2 + Math.floor(i / 6) * 0.05),
    );
    const result = clusterStops(stops, 3);
    assert.equal(result.length, 3);
    const sizes = result.map((c) => c.length).sort();
    // Bisección recursiva con k=3 hace 3-way split → no garantiza
    // exactamente 10/10/10, pero sí balance dentro de ±1.
    assert.ok(sizes[2]! - sizes[0]! <= 2, `desbalance excesivo: ${sizes}`);
    // La suma debe respetar el total.
    assert.equal(sizes.reduce((a, b) => a + b, 0), 30);
  });

  test('todos los stops aparecen exactamente una vez', () => {
    const stops = Array.from({ length: 21 }, (_, i) =>
      stop(`s${i}`, 19.3 + Math.random() * 0.2, -99.2 + Math.random() * 0.2),
    );
    const result = clusterStops(stops, 4);
    const flatIds = result.flat().map((s) => s.id);
    assert.equal(flatIds.length, 21);
    assert.equal(new Set(flatIds).size, 21);
  });
});

describe('clusterStops — caso VerdFrut: split sur CDMX', () => {
  // 22 stops sintéticos (11 oeste + 11 este) con gap claro en lng=-99.14.
  // Reproduce el patrón documentado en OPTIMIZATION_ENGINE.md: el dispatcher
  // hizo el split manual aplicando lng=-99.142 como umbral. La bisección
  // automática debe llegar a la misma separación sin que se le diga el valor.
  // Uso 22 (no 21 como producción) porque k=2 sobre 21 deja un split 10/11
  // inevitable y el caso es más legible con conjuntos parejos.
  const SUR_CDMX: GeoPoint[] = [
    // Oeste (11 stops, todos lng ≤ -99.15)
    stop('sw01', 19.32, -99.18),
    stop('sw02', 19.33, -99.17),
    stop('sw03', 19.34, -99.16),
    stop('sw04', 19.31, -99.155),
    stop('sw05', 19.35, -99.165),
    stop('sw06', 19.30, -99.175),
    stop('sw07', 19.36, -99.15),
    stop('sw08', 19.32, -99.16),
    stop('sw09', 19.33, -99.155),
    stop('sw10', 19.34, -99.17),
    stop('sw11', 19.31, -99.18),
    // Este (11 stops, todos lng ≥ -99.13)
    stop('se01', 19.30, -99.13),
    stop('se02', 19.31, -99.12),
    stop('se03', 19.32, -99.11),
    stop('se04', 19.33, -99.10),
    stop('se05', 19.34, -99.09),
    stop('se06', 19.35, -99.13),
    stop('se07', 19.30, -99.125),
    stop('se08', 19.31, -99.13),
    stop('se09', 19.32, -99.12),
    stop('se10', 19.33, -99.11),
    stop('se11', 19.34, -99.10),
  ];

  test('k=2 separa coherentemente oeste/este', () => {
    const result = clusterStops(SUR_CDMX, 2);
    assert.equal(result.length, 2);
    for (const cluster of result) {
      const prefixes = new Set(cluster.map((s) => s.id.slice(0, 2)));
      assert.equal(prefixes.size, 1, `cluster mezclado: ${[...prefixes]}`);
    }
    const sizes = result.map((c) => c.length).sort();
    assert.deepEqual(sizes, [11, 11]);
  });
});

describe('clusterStops — edge cases', () => {
  test('todos los puntos en el mismo lat/lng → 1 cluster aunque k>1', () => {
    const stops = Array.from({ length: 5 }, (_, i) =>
      stop(`s${i}`, 19.4, -99.1),
    );
    const result = clusterStops(stops, 3);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.length, 5);
  });

  test('2 puntos colineales en lng → split por lng', () => {
    const result = clusterStops([stop('a', 19.4, -99.2), stop('b', 19.4, -99.1)], 2);
    assert.equal(result.length, 2);
    assert.equal(result[0]!.length, 1);
    assert.equal(result[1]!.length, 1);
  });
});

describe('centroid', () => {
  test('promedio aritmético de coords', () => {
    const c = centroid([stop('a', 0, 0), stop('b', 10, 20)]);
    assert.equal(c.lat, 5);
    assert.equal(c.lng, 10);
  });

  test('cluster vacío lanza error', () => {
    assert.throws(() => centroid([]));
  });
});
