// Tests del handoff conversacional R3 — verifica que las invariantes
// estructurales se mantienen tras activar el router agent.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS_BY_ROLE } from './tools/role-mapping';
import { SYSTEM_PROMPTS } from './prompts';
import { TOOLS, getTool } from './tools/registry';
import type { ToolContext, ToolResult } from './types';

function fakeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    customerId: 'cust-test',
    userId: 'user-test',
    sessionId: 'sess-test',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: {} as any,
    timezone: 'America/Mexico_City',
    ...overrides,
  };
}

describe('R3 — wiring de roles', () => {
  test('orchestrator tiene enter_router_mode (pero NO exit_router_mode)', () => {
    assert.ok(TOOLS_BY_ROLE.orchestrator.includes('enter_router_mode'));
    assert.ok(!TOOLS_BY_ROLE.orchestrator.includes('exit_router_mode'));
  });

  test('router tiene exit_router_mode (pero NO enter_router_mode)', () => {
    assert.ok(TOOLS_BY_ROLE.router.includes('exit_router_mode'));
    assert.ok(!TOOLS_BY_ROLE.router.includes('enter_router_mode'));
  });

  test('router NO incluye delegate_to_geo (eso es del orchestrator)', () => {
    // El router puede pedirle al orchestrator que geocodifique via "salir
    // de modo router y pedir geocoding" — no hace geo directo.
    assert.ok(!TOOLS_BY_ROLE.router.includes('delegate_to_geo'));
    assert.ok(!TOOLS_BY_ROLE.router.includes('geocode_address'));
  });

  test('router prompt ya NO es stub defensivo', () => {
    const prompt = SYSTEM_PROMPTS.router;
    assert.ok(!prompt.includes('TODAVÍA NO está activo'));
    assert.ok(prompt.includes('ROUTING'));
    assert.ok(prompt.includes('exit_router_mode'));
  });

  test('orchestrator prompt menciona enter_router_mode', () => {
    const prompt = SYSTEM_PROMPTS.orchestrator;
    assert.ok(prompt.includes('enter_router_mode'));
  });

  test('router prompt menciona los componentes clave del Optimization Engine', () => {
    const prompt = SYSTEM_PROMPTS.router;
    // Conocimientos esperados que diferencian al especialista.
    assert.ok(prompt.includes('Clustering'), 'router debe conocer Capa 1');
    assert.ok(prompt.includes('VROOM'), 'router debe conocer Capa 3');
    assert.ok(prompt.includes('MXN'), 'router debe conocer costos');
    assert.ok(prompt.includes('jornada'), 'router debe conocer constraints LFT');
    assert.ok(prompt.match(/9 ?h|9 h|jornada legal|LFT/), 'router debe mencionar jornada legal MX');
  });
});

describe('R3 — tools de handoff', () => {
  test('enter_router_mode está registrado con shape correcto', () => {
    const tool = getTool('enter_router_mode');
    assert.ok(tool);
    assert.equal(tool!.is_write, false);
    assert.equal(tool!.requires_confirmation, false);
    assert.ok(tool!.input_schema.required?.includes('reason'));
  });

  test('exit_router_mode está registrado con shape correcto', () => {
    const tool = getTool('exit_router_mode');
    assert.ok(tool);
    assert.equal(tool!.is_write, false);
    assert.equal(tool!.requires_confirmation, false);
    assert.ok(tool!.input_schema.required?.includes('outcome'));
  });

  test('enter_router_mode rechaza reason vacío', async () => {
    const tool = getTool('enter_router_mode')!;
    const result = (await tool.handler({ reason: '' }, fakeCtx())) as ToolResult;
    assert.equal(result.ok, false);
  });

  test('exit_router_mode rechaza outcome vacío', async () => {
    const tool = getTool('exit_router_mode')!;
    const result = (await tool.handler({ outcome: '' }, fakeCtx())) as ToolResult;
    assert.equal(result.ok, false);
  });
});

describe('R3 — invariantes globales', () => {
  test('todas las tools del registry siguen mapeadas a algún rol', () => {
    const allRoleNames = new Set([
      ...TOOLS_BY_ROLE.orchestrator,
      ...TOOLS_BY_ROLE.geo,
      ...TOOLS_BY_ROLE.router,
    ]);
    for (const tool of TOOLS) {
      assert.ok(
        allRoleNames.has(tool.name),
        `tool "${tool.name}" no está mapeada a ningún rol — quedará inaccesible`,
      );
    }
  });

  test('router PUEDE tener tools con requires_confirmation (es conversacional)', () => {
    // A diferencia del geo agent (batch worker, no pausa), el router conversa
    // con el user directamente y soporta pausas por confirmation. Tools como
    // `reassign_driver` requieren confirm — es correcto que estén en el router.
    // Este test sólo documenta la asimetría con el geo (donde sí está prohibido).
    const routerToolNames = new Set(TOOLS_BY_ROLE.router);
    const routerToolsWithConfirm = TOOLS.filter(
      (t) => routerToolNames.has(t.name) && t.requires_confirmation,
    );
    // Se espera al menos 1 (al menos reassign_driver). Si en el futuro
    // alguien elimina TODAS las confirmation tools del router, este test
    // dispara para que evaluemos si fue intencional.
    assert.ok(
      routerToolsWithConfirm.length >= 1,
      `router debe tener al menos 1 tool con confirmation (es conversacional). Tools actuales con confirm: ${routerToolsWithConfirm.map((t) => t.name).join(', ') || 'ninguna'}`,
    );
  });

  test('enter/exit son simétricos: orchestrator → router → orchestrator', () => {
    assert.ok(TOOLS_BY_ROLE.orchestrator.includes('enter_router_mode'));
    assert.ok(TOOLS_BY_ROLE.router.includes('exit_router_mode'));
    // No hay forma de quedar atrapado: el router siempre puede volver.
  });
});
