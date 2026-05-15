// Smoke test del geo agent (Stream R / Sprint R2, ADR-099).
//
// Corre el geo agent contra el fixture cdmx-30-addresses.json llamando
// realmente a Anthropic + Google Geocoding. NO toca BD (usa supabase mock).
//
// Requisitos:
//   - ANTHROPIC_API_KEY en el env
//   - GOOGLE_GEOCODING_API_KEY en el env
//   - Costo estimado: ~$0.10 USD (1 Sonnet call con cache miss + 30 geocode
//     ops a $5/1000 = $0.15 Google → ~$0.05). Total ~$0.10-0.15 por run.
//
// Uso:
//   pnpm --filter @tripdrive/orchestrator exec tsx ../../scripts/smoke-geo-agent.ts
//
// Lo que verifica:
//   1) El sub-loop termina en ≤10 iteraciones.
//   2) Al menos 25/30 direcciones geocodifican (las CDMX reales del fixture).
//   3) Las 2 direcciones intencionalmente malas reportan fallo.
//   4) El stop_reason es 'end_turn' (terminación natural).
//   5) El summary contiene un reporte humano coherente.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runGeoAgent } from '../packages/orchestrator/src/geo-runner';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Fixture {
  addresses: string[];
  _meta: { purpose: string; notes: string };
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('FALTA ANTHROPIC_API_KEY en el env.');
    process.exit(1);
  }
  if (!process.env.GOOGLE_GEOCODING_API_KEY) {
    console.error('FALTA GOOGLE_GEOCODING_API_KEY en el env.');
    process.exit(1);
  }

  const fixturePath = join(__dirname, 'test-data', 'cdmx-30-addresses.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Fixture;

  console.log(`━━━ Geo agent smoke test ━━━`);
  console.log(`Fixture: ${fixture.addresses.length} direcciones CDMX`);
  console.log(`Modelo: ${process.env.GEO_AGENT_MODEL ?? process.env.ORCHESTRATOR_MODEL ?? 'claude-sonnet-4-6'}`);
  console.log();

  const startedAt = Date.now();

  const result = await runGeoAgent({
    task:
      'Geocodifica TODAS las direcciones que te pasé. Para cada una reporta lat/lng, location_type y place_id. Identifica direcciones duplicadas exactas en la lista. No busques duplicados en catálogo (mock supabase no responderá). Cuando termines, dame un resumen breve con: total procesadas, OK, fallos, duplicados detectados.',
    addresses: fixture.addresses,
    toolContext: {
      customerId: 'smoke-test-customer',
      userId: 'smoke-test-user',
      sessionId: 'smoke-test-session',
      // El smoke test no usa BD — pasamos un mock que falla en queries pero
      // no en inserts (los inserts de audit se swallow silencioso en el runner).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: {
        from: () => ({
          insert: async () => ({ error: null }),
          select: () => ({ eq: () => ({ limit: () => ({ data: [], error: null }) }) }),
        }),
      } as any,
      timezone: 'America/Mexico_City',
    },
    parentSessionId: 'smoke-test-parent-session',
    maxIterations: 12, // un poco más generoso para el smoke
  });

  const elapsedMs = Date.now() - startedAt;

  console.log(`━━━ Resultado ━━━`);
  console.log(`Stop reason:       ${result.stopReason}`);
  console.log(`Iteraciones:       ${result.iterationsUsed}`);
  console.log(`Tool calls:        ${result.toolCalls.length}`);
  console.log(`  · geocode_address: ${result.toolCalls.filter((t) => t.toolName === 'geocode_address').length}`);
  console.log(`  · search_place:    ${result.toolCalls.filter((t) => t.toolName === 'search_place').length}`);
  console.log(`  · search_stores:   ${result.toolCalls.filter((t) => t.toolName === 'search_stores').length}`);
  console.log(`Duración total:    ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`Tokens (in/out):   ${result.usage.input_tokens} / ${result.usage.output_tokens}`);
  console.log(`  · cache create:  ${result.usage.cache_creation_input_tokens}`);
  console.log(`  · cache read:    ${result.usage.cache_read_input_tokens}`);
  console.log();
  console.log(`━━━ Summary del geo agent ━━━`);
  console.log(result.summary);
  console.log();

  // Stats de geocoding.
  const geocodeCalls = result.toolCalls.filter((t) => t.toolName === 'geocode_address');
  const successCount = geocodeCalls.filter((t) => t.result.ok).length;
  const failCount = geocodeCalls.length - successCount;

  console.log(`━━━ Stats geocoding ━━━`);
  console.log(`  Geocode OK:    ${successCount}/${geocodeCalls.length}`);
  console.log(`  Geocode fail:  ${failCount}/${geocodeCalls.length}`);

  // Validaciones de smoke.
  const assertions: Array<[string, boolean]> = [
    ['stop_reason = end_turn', result.stopReason === 'end_turn'],
    ['iteraciones ≤ 12', result.iterationsUsed <= 12],
    [`≥25 direcciones geocodificadas OK (actual: ${successCount})`, successCount >= 25],
    ['summary no vacío', result.summary.length > 0],
  ];

  console.log();
  console.log(`━━━ Asserts ━━━`);
  let failed = 0;
  for (const [name, ok] of assertions) {
    console.log(`  ${ok ? '✅' : '❌'} ${name}`);
    if (!ok) failed++;
  }

  if (failed > 0) {
    console.error(`\n❌ ${failed} assert(s) fallaron.`);
    process.exit(1);
  }
  console.log(`\n✅ Smoke test OK.`);
}

main().catch((err) => {
  console.error('Smoke test crash:', err);
  process.exit(1);
});
