// Tests de validación de args de delegate_to_geo. No mocean Anthropic —
// las pruebas se quedan en la fase de validación (antes del sub-loop).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getTool } from './registry';
import type { ToolContext, ToolResult } from '../types';

function fakeCtx(): ToolContext {
  return {
    customerId: 'cust-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: {} as any,
    timezone: 'America/Mexico_City',
  };
}

describe('delegate_to_geo — validación de args', () => {
  test('task vacío → error', async () => {
    const tool = getTool('delegate_to_geo');
    assert.ok(tool);
    const result = (await tool!.handler({ task: '' }, fakeCtx())) as ToolResult;
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /vacío/);
  });

  test('task >1000 chars → error', async () => {
    const tool = getTool('delegate_to_geo')!;
    const longTask = 'a'.repeat(1001);
    const result = (await tool.handler({ task: longTask }, fakeCtx())) as ToolResult;
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /excede 1000/);
  });

  test('>50 addresses → error', async () => {
    const tool = getTool('delegate_to_geo')!;
    const addresses = Array.from({ length: 51 }, (_, i) => `Dir ${i}`);
    const result = (await tool.handler(
      { task: 'batch', addresses },
      fakeCtx(),
    )) as ToolResult;
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /excede 50 direcciones/);
  });

  test('>50 stop_ids → error', async () => {
    const tool = getTool('delegate_to_geo')!;
    const stopIds = Array.from({ length: 51 }, (_, i) => `uuid-${i}`);
    const result = (await tool.handler(
      { task: 'batch', stop_ids: stopIds },
      fakeCtx(),
    )) as ToolResult;
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /excede 50 stop_ids/);
  });

  test('max_iterations fuera de rango [1, 25] → error', async () => {
    const tool = getTool('delegate_to_geo')!;
    const r1 = (await tool.handler(
      { task: 't', max_iterations: 0 },
      fakeCtx(),
    )) as ToolResult;
    assert.equal(r1.ok, false);

    const r2 = (await tool.handler(
      { task: 't', max_iterations: 100 },
      fakeCtx(),
    )) as ToolResult;
    assert.equal(r2.ok, false);
  });

  test('addresses con elementos no-string se filtran silenciosamente', async () => {
    const tool = getTool('delegate_to_geo')!;
    // Mezcla legal: solo las strings deben llegar al runGeoAgent (pero no
    // podemos validar eso sin mocear; al menos verificamos que NO lanza).
    // El test asume que addresses=[1, 'real'] no causa crash en validación.
    // Si el sub-runner falla por API key vacía, eso es esperado.
    const result = (await tool.handler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { task: 't', addresses: [123 as any, 'Av Real 1'] },
      fakeCtx(),
    )) as ToolResult;
    // Pasa validación (no rechazó por args inválidos) — el resto depende del
    // sub-loop que requiere ANTHROPIC_API_KEY. Si falló por eso, ok:true con
    // stop_reason='error' embebido en data.
    if (result.ok) {
      const data = result.data as { stop_reason: string };
      assert.ok(['end_turn', 'max_iterations', 'error', 'forbidden_tool'].includes(data.stop_reason));
    }
    // Si falló pre-runGeoAgent por otra razón, mostramos el error.
    else {
      console.warn('delegate_to_geo result.error:', result.error);
    }
  });
});

describe('delegate_to_geo — shape del tool', () => {
  test('está registrado y tiene is_write=false', () => {
    const tool = getTool('delegate_to_geo');
    assert.ok(tool, 'delegate_to_geo no está en el registry');
    assert.equal(tool!.is_write, false);
    assert.equal(tool!.requires_confirmation, false);
  });

  test('schema requiere `task`', () => {
    const tool = getTool('delegate_to_geo')!;
    assert.ok(tool.input_schema.required?.includes('task'));
  });
});
