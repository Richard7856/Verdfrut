import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assignClustersToVehicles } from './assignment';
import type { GeoPoint, RouterVehicle } from './types';

function stop(id: string, lat: number, lng: number): GeoPoint {
  return { id, lat, lng };
}

function vehicle(id: string, lat: number, lng: number): RouterVehicle {
  return { id, depot: { lat, lng } };
}

describe('assignClustersToVehicles — happy path', () => {
  test('depots distintos → cluster asignado al depot más cercano', () => {
    // 2 clusters: uno en CDMX sur, otro en CDMX norte.
    const clusterSur = [stop('s1', 19.30, -99.15), stop('s2', 19.32, -99.16)];
    const clusterNorte = [stop('n1', 19.55, -99.12), stop('n2', 19.56, -99.13)];

    // 2 vehículos con depots en sur y norte.
    const vSur = vehicle('vSur', 19.28, -99.16);
    const vNorte = vehicle('vNorte', 19.58, -99.12);

    const result = assignClustersToVehicles(
      [clusterSur, clusterNorte],
      [vSur, vNorte],
    );

    assert.equal(result.size, 2);
    assert.deepEqual(
      result.get('vSur')!.map((s) => s.id).sort(),
      ['s1', 's2'],
    );
    assert.deepEqual(
      result.get('vNorte')!.map((s) => s.id).sort(),
      ['n1', 'n2'],
    );
  });

  test('depots compartidos (caso VerdFrut CEDA) → asignación por orden', () => {
    const c1 = [stop('a', 19.30, -99.15)];
    const c2 = [stop('b', 19.50, -99.10)];
    const ceda = { lat: 19.40, lng: -99.13 };
    const v1 = vehicle('v1', ceda.lat, ceda.lng);
    const v2 = vehicle('v2', ceda.lat, ceda.lng);

    const result = assignClustersToVehicles([c1, c2], [v1, v2]);
    // Como depots son idénticos, ambas distancias son iguales para cualquier
    // centroide → empate, gana el primero en `remaining`. Cluster c1 va a v1.
    assert.deepEqual(result.get('v1')!.map((s) => s.id), ['a']);
    assert.deepEqual(result.get('v2')!.map((s) => s.id), ['b']);
  });
});

describe('assignClustersToVehicles — validación', () => {
  test('más clusters que vehículos → throw', () => {
    assert.throws(() =>
      assignClustersToVehicles(
        [[stop('a', 0, 0)], [stop('b', 1, 1)]],
        [vehicle('v', 0, 0)],
      ),
    );
  });

  test('clusters vacíos se omiten silenciosamente', () => {
    const result = assignClustersToVehicles(
      [[], [stop('a', 19.4, -99.1)]],
      [vehicle('v1', 19.4, -99.1), vehicle('v2', 19.4, -99.1)],
    );
    // Solo 1 cluster no-vacío → solo 1 asignación.
    assert.equal(result.size, 1);
  });

  test('cero clusters → map vacío', () => {
    const result = assignClustersToVehicles([], [vehicle('v', 0, 0)]);
    assert.equal(result.size, 0);
  });
});

describe('assignClustersToVehicles — vehículos extra', () => {
  test('más vehículos que clusters → vehículos sobrantes NO aparecen en el map', () => {
    const c = [stop('a', 19.3, -99.15)];
    const v1 = vehicle('v1', 19.28, -99.16);
    const v2 = vehicle('v2', 19.55, -99.10); // depot lejos del cluster

    const result = assignClustersToVehicles([c], [v1, v2]);
    assert.equal(result.size, 1);
    assert.ok(result.has('v1'));
    assert.ok(!result.has('v2'));
  });
});
