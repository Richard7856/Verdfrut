// Tests de helpers puros del geo-runner. NO ejecuta Anthropic API (eso es
// integration test manual con ANTHROPIC_API_KEY — ver scripts/smoke-geo.ts).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { _buildInitialUserMessageForTesting as buildMsg } from './geo-runner';
import type { ToolContext } from './types';

function fakeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    customerId: 'cust-1',
    userId: 'user-1',
    sessionId: 'session-orchestrator-42',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: {} as any,
    timezone: 'America/Mexico_City',
    ...overrides,
  };
}

describe('buildInitialUserMessage', () => {
  test('incluye TAREA prefijo', () => {
    const msg = buildMsg({
      task: 'geocodifica esto',
      toolContext: fakeCtx(),
      parentSessionId: 'sess-X',
    });
    assert.match(msg, /^TAREA: geocodifica esto/);
  });

  test('embebe lista de direcciones con numeración', () => {
    const msg = buildMsg({
      task: 'batch',
      addresses: ['Av Reforma 1, CDMX', 'Insurgentes 100, CDMX'],
      toolContext: fakeCtx(),
      parentSessionId: 'sess-X',
    });
    assert.match(msg, /DIRECCIONES A PROCESAR \(2\)/);
    assert.match(msg, /1\. Av Reforma 1, CDMX/);
    assert.match(msg, /2\. Insurgentes 100, CDMX/);
  });

  test('embebe lista de stop_ids', () => {
    const msg = buildMsg({
      task: 'valida',
      stopIds: ['uuid-1', 'uuid-2'],
      toolContext: fakeCtx(),
      parentSessionId: 'sess-X',
    });
    assert.match(msg, /STOP_IDS A VALIDAR \(2\)/);
    assert.match(msg, /uuid-1/);
  });

  test('incluye customer_id y parentSessionId en contexto', () => {
    const msg = buildMsg({
      task: 't',
      toolContext: fakeCtx({ customerId: 'cust-XYZ' }),
      parentSessionId: 'sess-parent-99',
    });
    assert.match(msg, /customer_id=cust-XYZ/);
    assert.match(msg, /sess-parent-99/);
  });

  test('sin addresses ni stop_ids — solo task + contexto', () => {
    const msg = buildMsg({
      task: 'solo task',
      toolContext: fakeCtx(),
      parentSessionId: 'sess-X',
    });
    assert.match(msg, /TAREA: solo task/);
    assert.doesNotMatch(msg, /DIRECCIONES A PROCESAR/);
    assert.doesNotMatch(msg, /STOP_IDS A VALIDAR/);
  });
});
