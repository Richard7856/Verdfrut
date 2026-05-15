// Tests del mapping de roles (Sprint R2 — verifica invariantes después de
// activar geo agent). Corre con `pnpm --filter @tripdrive/orchestrator test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS_BY_ROLE, getRoleToolNames } from './tools/role-mapping';
import { TOOLS } from './tools/registry';

describe('TOOLS_BY_ROLE — invariantes', () => {
  test('todas las tools referenciadas en TOOLS_BY_ROLE existen en el registry', () => {
    const registryNames = new Set(TOOLS.map((t) => t.name));
    for (const [role, names] of Object.entries(TOOLS_BY_ROLE)) {
      for (const name of names) {
        assert.ok(
          registryNames.has(name),
          `rol "${role}" referencia tool "${name}" que NO está en TOOLS registry`,
        );
      }
    }
  });

  test('orchestrator tiene delegate_to_geo (entry-point a sub-agente)', () => {
    assert.ok(
      TOOLS_BY_ROLE.orchestrator.includes('delegate_to_geo'),
      'el orchestrator debe tener delegate_to_geo para activar el geo agent',
    );
  });

  test('orchestrator NO tiene tools geo crudas (geocode_address/search_place)', () => {
    // Forzar delegación: el orchestrator no debe poder llamar geocode_address
    // directamente. Eso obliga a usar delegate_to_geo para todo geo work.
    assert.ok(
      !TOOLS_BY_ROLE.orchestrator.includes('geocode_address'),
      'geocode_address vive en el geo agent, no en el orchestrator',
    );
    assert.ok(
      !TOOLS_BY_ROLE.orchestrator.includes('search_place'),
      'search_place vive en el geo agent, no en el orchestrator',
    );
  });

  test('orchestrator MANTIENE writes geo (create_store, bulk_create_stores)', () => {
    // Los writes geo viven en orchestrator porque requieren confirmation
    // del user — el geo agent es read-only por diseño.
    assert.ok(TOOLS_BY_ROLE.orchestrator.includes('create_store'));
    assert.ok(TOOLS_BY_ROLE.orchestrator.includes('bulk_create_stores'));
  });

  test('geo NO tiene tools de write', () => {
    const geoNames = new Set(TOOLS_BY_ROLE.geo);
    const geoTools = TOOLS.filter((t) => geoNames.has(t.name));
    for (const tool of geoTools) {
      assert.equal(
        tool.is_write,
        false,
        `tool "${tool.name}" está en rol geo pero es is_write=true — el sub-agente no soporta writes`,
      );
    }
  });

  test('geo NO tiene tools con requires_confirmation', () => {
    // El sub-loop del geo agent no soporta pausa por confirmación.
    const geoNames = new Set(TOOLS_BY_ROLE.geo);
    const geoTools = TOOLS.filter((t) => geoNames.has(t.name));
    for (const tool of geoTools) {
      assert.equal(
        tool.requires_confirmation,
        false,
        `tool "${tool.name}" está en rol geo pero requires_confirmation=true`,
      );
    }
  });

  test('getRoleToolNames devuelve el array correcto', () => {
    assert.deepEqual([...getRoleToolNames('geo')].sort(), [...TOOLS_BY_ROLE.geo].sort());
  });

  test('cada tool del registry está al menos en un rol (no huérfanos)', () => {
    const allRoleNames = new Set([
      ...TOOLS_BY_ROLE.orchestrator,
      ...TOOLS_BY_ROLE.geo,
      ...TOOLS_BY_ROLE.router,
    ]);
    for (const tool of TOOLS) {
      assert.ok(
        allRoleNames.has(tool.name),
        `tool "${tool.name}" está en el registry pero NO en ningún rol → inaccesible`,
      );
    }
  });
});
