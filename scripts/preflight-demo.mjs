#!/usr/bin/env node
// Pre-flight check antes de demo (2026-05-15).
//
// Corre en 30 segundos y verifica que todo está OK para presentar
// OE-2 (propose-routes) sin sorpresas:
//   1. Env vars críticas presentes.
//   2. Migraciones 045 y 046 aplicadas.
//   3. Endpoint /api/orchestrator/_internal/propose-routes reachable.
//   4. El user designado para demo tiene rol admin/dispatcher activo.
//   5. Existe al menos un dispatch con paradas (para no improvisar).
//
// Uso:
//   node scripts/preflight-demo.mjs --user=<UUID> --dispatch=<UUID opcional>
//
// Exit code 0 si todo OK; 1 con detalle si algo falla.

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

const checks = [];

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`);
}

async function main() {
  const args = parseArgs();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TripDrive — Pre-flight check para demo OE-2');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log();

  // ─── 1. Env vars ───
  const requiredEnv = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'INTERNAL_AGENT_TOKEN',
  ];
  for (const e of requiredEnv) {
    record(`env: ${e}`, Boolean(process.env[e]), process.env[e] ? '(set)' : 'falta — revisa .env.local');
  }

  // Anthropic + Google solo si vas a tocar el chat / geo agent. Para OE-2 CLI no es estrictamente necesario,
  // pero documentamos.
  if (process.env.ANTHROPIC_API_KEY) record('env: ANTHROPIC_API_KEY (opcional para CLI demo)', true, 'set');
  else record('env: ANTHROPIC_API_KEY (opcional para CLI demo)', false, 'OK ausente si no usas chat en demo');

  if (process.env.GOOGLE_GEOCODING_API_KEY) record('env: GOOGLE_GEOCODING_API_KEY (opcional)', true);
  else record('env: GOOGLE_GEOCODING_API_KEY (opcional)', false, 'OK ausente si no usas geocoding');

  // ─── 2. Args ───
  if (!args.user) {
    record('arg --user', false, 'requerido (UUID del admin/dispatcher que va a demoar)');
  } else {
    record('arg --user', true, args.user);
  }

  // Si hay errores críticos de env, abortar antes de pegar a Supabase.
  const criticalEnvOk =
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.INTERNAL_AGENT_TOKEN;
  if (!criticalEnvOk || !args.user) {
    console.log();
    console.log('❌ Falla env vars o --user. Resuelve y reintenta.');
    process.exit(1);
  }

  // ─── 3. Supabase: migraciones + user + dispatch ───
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // 3a. customers.optimizer_costs existe (mig 045)?
  try {
    const { error } = await supabase.from('customers').select('optimizer_costs').limit(1);
    record(
      'migración 045 (customers.optimizer_costs)',
      !error,
      error ? error.message : 'columna existe',
    );
  } catch (e) {
    record('migración 045', false, e.message);
  }

  // 3b. orchestrator_sessions.active_agent_role existe (mig 046)?
  try {
    const { error } = await supabase
      .from('orchestrator_sessions')
      .select('active_agent_role')
      .limit(1);
    record(
      'migración 046 (orchestrator_sessions.active_agent_role)',
      !error,
      error ? error.message : 'columna existe',
    );
  } catch (e) {
    record('migración 046', false, e.message);
  }

  // 3c. User existe y es admin/dispatcher activo
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, role, is_active, customer_id')
      .eq('id', args.user)
      .maybeSingle();
    if (error || !data) {
      record('user existe', false, error?.message ?? 'no encontrado');
    } else {
      record('user existe', true, `role=${data.role}, customer_id=${data.customer_id.slice(0, 8)}...`);
      record(
        'user es admin/dispatcher activo',
        ['admin', 'dispatcher'].includes(data.role) && data.is_active,
        data.is_active ? `role=${data.role}` : 'inactivo',
      );
    }
  } catch (e) {
    record('user check', false, e.message);
  }

  // 3d. Si pasaron --dispatch, validar que existe y tiene rutas con paradas
  if (args.dispatch) {
    try {
      const { data: dispatch } = await supabase
        .from('dispatches')
        .select('id, name, date, status')
        .eq('id', args.dispatch)
        .maybeSingle();
      if (!dispatch) {
        record('dispatch existe', false, 'no encontrado');
      } else {
        record('dispatch existe', true, `${dispatch.name} (${dispatch.date}, ${dispatch.status})`);

        const { data: routes } = await supabase
          .from('routes')
          .select('id, name, vehicle_id, status')
          .eq('dispatch_id', args.dispatch);
        record('dispatch tiene rutas', (routes ?? []).length > 0, `${(routes ?? []).length} rutas`);

        if (routes && routes.length > 0) {
          const routeIds = routes.map((r) => r.id);
          const { data: stops } = await supabase
            .from('stops')
            .select('id, store_id, route_id')
            .in('route_id', routeIds);
          const uniqueStores = new Set((stops ?? []).map((s) => s.store_id));
          record('dispatch tiene tiendas', uniqueStores.size > 0, `${uniqueStores.size} tiendas únicas en ${stops?.length ?? 0} paradas`);

          // Idoneidad para demo: ≥10 stops para que la propuesta sea interesante
          if (uniqueStores.size < 5) {
            record('demo-worthy (≥5 stops)', false, `solo ${uniqueStores.size} — propuesta poco interesante`);
          } else {
            record('demo-worthy (≥5 stops)', true);
          }
        }
      }
    } catch (e) {
      record('dispatch check', false, e.message);
    }
  } else {
    console.log('ℹ️  --dispatch no pasado, salto verificación de tiro específico.');
  }

  // ─── 4. Endpoint reachable ───
  const baseUrl = process.env.PLATFORM_BASE_URL ?? 'http://localhost:3000';
  try {
    // Hit el endpoint con un body inválido a propósito — debe responder 400 (no 404 ni 502).
    const res = await fetch(`${baseUrl}/api/orchestrator/_internal/propose-routes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-agent-token': process.env.INTERNAL_AGENT_TOKEN,
      },
      body: JSON.stringify({ caller_user_id: 'no-uuid' }),
      signal: AbortSignal.timeout(5000),
    });
    record(
      `endpoint reachable (${baseUrl})`,
      res.status === 400 || res.status === 403,
      `HTTP ${res.status} (esperado 400 con caller_user_id inválido)`,
    );
  } catch (e) {
    record(
      `endpoint reachable (${baseUrl})`,
      false,
      `${e.message} — ¿pnpm dev está corriendo?`,
    );
  }

  // ─── Resumen ───
  console.log();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const fails = checks.filter((c) => !c.ok);
  if (fails.length === 0) {
    console.log('✅ Pre-flight OK. Listo para demo.');
    process.exit(0);
  } else {
    console.log(`❌ ${fails.length} check(s) fallaron:`);
    for (const f of fails) {
      console.log(`   · ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('💥 Crash inesperado:', err);
  process.exit(2);
});
