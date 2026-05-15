#!/usr/bin/env node
// Demo CLI del feature `propose_route_plan` (ADR-100 / OE-2).
// Llama el endpoint /api/orchestrator/_internal/propose-routes y muestra
// las 3 alternativas en formato legible para presentación al cliente.
//
// Pensado para usar la noche del 2026-05-15 ante NETO / VerdFrut, donde
// el cliente reportó que su contrato de renta los limita por km y necesitan
// optimización agresiva.
//
// Uso (3 modos):
//
//   # A) Por dispatch existente (lo más común para demo):
//   node scripts/demo-propose-routes.mjs --dispatch=<uuid> --user=<uuid>
//
//   # B) Por stops + vehículos explícitos:
//   node scripts/demo-propose-routes.mjs --stops=uuid1,uuid2,... --vehicles=uuid1,... --user=<uuid> --date=2026-05-18
//
//   # C) Por stops + zona (toma todos los vehículos activos):
//   node scripts/demo-propose-routes.mjs --stops=uuid1,... --zone=<uuid> --user=<uuid> --date=2026-05-18
//
// Env vars necesarias (lee de .env.local):
//   PLATFORM_BASE_URL          (default http://localhost:3000)
//   INTERNAL_AGENT_TOKEN

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

function loadDotenv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const k = m[1];
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadDotenv(path.join(ROOT, '.env.local'));
loadDotenv(path.join(ROOT, 'apps/platform/.env.local'));

function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([a-z_]+)=(.+)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function fmt(n, decimals = 1) {
  return Number(n).toLocaleString('es-MX', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtMxn(n) {
  return '$' + Number(n).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const LABEL_ES = {
  cheapest: '💰 Más económica',
  balanced: '⚖️  Balanced',
  fastest: '⚡ Más rápida',
};

async function main() {
  const args = parseArgs();
  const baseUrl = process.env.PLATFORM_BASE_URL ?? 'http://localhost:3000';
  const token = process.env.INTERNAL_AGENT_TOKEN;

  if (!token) {
    console.error('❌ Falta INTERNAL_AGENT_TOKEN en el env.');
    process.exit(1);
  }
  if (!args.user) {
    console.error('❌ Falta --user=<uuid> (caller_user_id; el admin/dispatcher que origina la propuesta).');
    process.exit(1);
  }

  const body = { caller_user_id: args.user };

  if (args.dispatch) {
    body.dispatch_id = args.dispatch;
  } else if (args.stops) {
    body.stop_ids = args.stops.split(',').map((s) => s.trim()).filter(Boolean);
    if (args.vehicles) {
      body.vehicle_ids = args.vehicles.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (args.zone) {
      body.zone_id = args.zone;
    } else {
      console.error('❌ Pasa --vehicles=... o --zone=...');
      process.exit(1);
    }
    if (args.date) body.date = args.date;
  } else {
    console.error('❌ Pasa --dispatch=<uuid> o --stops=uuid1,uuid2,...');
    process.exit(1);
  }

  if (args.shift_start) body.shift_start = args.shift_start;
  if (args.shift_end) body.shift_end = args.shift_end;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TripDrive — Propuesta de alternativas de ruteo (OE-2)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log();
  console.log(`Endpoint: ${baseUrl}/api/orchestrator/_internal/propose-routes`);
  console.log(`Modo:     ${args.dispatch ? 'A (por dispatch)' : args.vehicles ? 'B (stops+vehicles)' : 'C (stops+zone)'}`);
  console.log();
  console.log('Calculando alternativas... (esto puede tardar 30-90s, llama VROOM N veces en paralelo)');
  console.log();

  const startedAt = Date.now();
  let res;
  try {
    res = await fetch(`${baseUrl}/api/orchestrator/_internal/propose-routes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-agent-token': token,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('❌ Fetch falló:', err.message);
    console.error('   ¿El servidor Next.js está corriendo en', baseUrl, '?');
    process.exit(1);
  }

  const elapsedMs = Date.now() - startedAt;

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ HTTP ${res.status}: ${text}`);
    process.exit(1);
  }

  const data = await res.json();

  console.log('━━━ INPUTS ━━━');
  if (data.dispatch) {
    console.log(`Dispatch:        ${data.dispatch.name} (${data.dispatch.id})`);
    console.log(`Fecha:           ${data.dispatch.date}`);
  } else {
    console.log(`Fecha:           ${data.inputs.date}`);
  }
  console.log(`Tiendas:         ${data.inputs.store_count}`);
  console.log(`Vehículos disp:  ${data.inputs.vehicle_count_available}`);
  console.log(`K explorado:     ${data.k_explored.minK}..${data.k_explored.maxK} (${data.total_evaluated} planes calculados)`);
  console.log(`Cómputo:         ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log();

  if (data.always_unassigned_store_ids?.length > 0) {
    console.log('⚠️  ATENCIÓN: estas tiendas no se pudieron asignar en NINGUNA alternativa:');
    for (const id of data.always_unassigned_store_ids) console.log(`     · ${id}`);
    console.log('   Probable causa: ventana horaria imposible o coord inválida. Revisar antes de aplicar.');
    console.log();
  }

  console.log('━━━ COSTOS CONFIGURADOS (customer) ━━━');
  const c = data.costs_config;
  console.log(`  Combustible:        ${fmtMxn(c.cost_per_km_fuel_mxn)} / km`);
  console.log(`  Desgaste:           ${fmtMxn(c.cost_per_km_wear_mxn)} / km`);
  console.log(`  Chofer:             ${fmtMxn(c.driver_hourly_wage_mxn)} / hora`);
  console.log(`  Overhead despacho:  ${fmtMxn(c.dispatch_overhead_mxn)} / vehículo`);
  console.log(`  Jornada máx:        ${c.max_hours_per_driver}h (LFT MX)`);
  console.log();

  if (!data.alternatives || data.alternatives.length === 0) {
    console.log('❌ Ninguna alternativa factible. Revisa constraints / jornada.');
    process.exit(1);
  }

  console.log(`━━━ ALTERNATIVAS (${data.alternatives.length}) ━━━`);
  console.log();
  for (const alt of data.alternatives) {
    const labels = alt.labels.map((l) => LABEL_ES[l] || l).join('  ');
    const feasibilityTag = alt.feasible ? '' : '  ⚠️ INFACTIBLE (chofer > jornada)';
    console.log(`${labels || '(sin label)'}${feasibilityTag}`);
    console.log(`   Plan ${alt.id}  ·  ${alt.vehicle_count} vehículos`);
    console.log(`   Total km:        ${fmt(alt.metrics.total_km)} km`);
    console.log(`   Horas-chofer:    ${fmt(alt.metrics.total_driver_hours)} h totales · chofer max ${fmt(alt.metrics.max_driver_hours)}h`);
    console.log(`   ─────────────────────────────────`);
    console.log(`   Combustible:     ${fmtMxn(alt.cost.fuel_mxn)}`);
    console.log(`   Desgaste:        ${fmtMxn(alt.cost.wear_mxn)}`);
    console.log(`   Chofer:          ${fmtMxn(alt.cost.labor_mxn)}`);
    console.log(`   Overhead:        ${fmtMxn(alt.cost.overhead_mxn)}`);
    console.log(`   TOTAL:           ${fmtMxn(alt.cost.total_mxn)}`);
    console.log();
    console.log(`   Por ruta:`);
    for (const r of alt.routes) {
      console.log(`     · ${r.stop_count} stops · ${fmt(r.distance_km)} km · ${fmt(r.duration_hours)} h  (vehículo ${r.vehicle_id.slice(0, 8)})`);
    }
    console.log();
  }

  // Resumen rápido para el dispatcher.
  const cheapest = data.alternatives.find((a) => a.labels.includes('cheapest'));
  const fastest = data.alternatives.find((a) => a.labels.includes('fastest'));
  if (cheapest && fastest && cheapest.id !== fastest.id) {
    const diff = fastest.cost.total_mxn - cheapest.cost.total_mxn;
    const timeSaved = cheapest.metrics.max_driver_hours - fastest.metrics.max_driver_hours;
    console.log('━━━ COMPARATIVA RÁPIDA ━━━');
    console.log(`  Cambiar de económica a rápida cuesta ${fmtMxn(diff)} más`);
    console.log(`  pero ahorra ${fmt(timeSaved)}h al chofer más cargado.`);
    console.log();
  }
}

main().catch((err) => {
  console.error('❌ Demo crash:', err);
  process.exit(1);
});
