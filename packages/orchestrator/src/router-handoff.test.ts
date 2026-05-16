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
  // R4 / ADR-109 (2026-05-15 noche): handoff conversacional RE-ACTIVADO con
  // UI badge en el chat. El orchestrator vuelve a ofrecer enter_router_mode.
  // Pareja: el router conserva exit_router_mode para devolver el control.

  test('orchestrator tiene enter_router_mode (handoff re-activado en ADR-109)', () => {
    assert.ok(TOOLS_BY_ROLE.orchestrator.includes('enter_router_mode'));
  });

  test('router tiene exit_router_mode (par simétrico)', () => {
    assert.ok(TOOLS_BY_ROLE.router.includes('exit_router_mode'));
  });

  test('router NO incluye delegate_to_geo (eso es del orchestrator)', () => {
    assert.ok(!TOOLS_BY_ROLE.router.includes('delegate_to_geo'));
    assert.ok(!TOOLS_BY_ROLE.router.includes('geocode_address'));
  });

  test('router prompt ya NO es stub defensivo (sigue cableado para R3 futuro)', () => {
    const prompt = SYSTEM_PROMPTS.router;
    assert.ok(!prompt.includes('TODAVÍA NO está activo'));
    assert.ok(prompt.includes('ROUTING'));
  });

  test('router prompt menciona los componentes clave del Optimization Engine', () => {
    const prompt = SYSTEM_PROMPTS.router;
    assert.ok(prompt.includes('Clustering'), 'router debe conocer Capa 1');
    assert.ok(prompt.includes('VROOM'), 'router debe conocer Capa 3');
    assert.ok(prompt.includes('MXN'), 'router debe conocer costos');
    assert.ok(prompt.includes('jornada'), 'router debe conocer constraints LFT');
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
  test('todas las tools del registry están mapeadas (excepto optimize_dispatch deprecado)', () => {
    const allRoleNames = new Set([
      ...TOOLS_BY_ROLE.orchestrator,
      ...TOOLS_BY_ROLE.geo,
      ...TOOLS_BY_ROLE.router,
    ]);
    // R4 / ADR-109: optimize_dispatch sigue en el registry para callers UI
    // legacy pero NO está mapeado a ningún rol (el LLM no debe verlo). El
    // value prop completo lo cubre propose_route_plan + apply_route_plan.
    const ALLOWED_ORPHANS = new Set(['optimize_dispatch']);
    for (const tool of TOOLS) {
      if (ALLOWED_ORPHANS.has(tool.name)) continue;
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

  test('enter_router_mode y exit_router_mode forman un par simétrico activo', () => {
    // ADR-109: handoff re-activado. Enter vive en orchestrator, exit en router.
    const enter = TOOLS.find((t) => t.name === 'enter_router_mode');
    const exit = TOOLS.find((t) => t.name === 'exit_router_mode');
    assert.ok(enter, 'enter_router_mode debe existir en el registry');
    assert.ok(exit, 'exit_router_mode debe existir en el registry');
    assert.ok(TOOLS_BY_ROLE.orchestrator.includes('enter_router_mode'));
    assert.ok(TOOLS_BY_ROLE.router.includes('exit_router_mode'));
  });
});
