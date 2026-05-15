#!/usr/bin/env node
// Pre-flight check antes de demo (2026-05-15).
//
// Corre en 30 segundos y verifica que todo está OK para presentar
// OE-2 (propose-routes) sin sorpresas:
//   1. Env vars críticas presentes.
//   2. Migraciones 045 y 046 aplicadas.
//   3. Endpoint /api/orchestrator/internal/propose-routes reachable.
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

function record(name, ok, detail, optional = false) {
  checks.push({ name, ok, detail, optional });
  const icon = ok ? '✅' : optional ? '⚠️ ' : '❌';
  console.log(`${icon} ${name}${detail ? `  — ${detail}` : ''}`);
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

  // Anthropic + Google solo si vas a tocar el chat / geo agent. Para OE-2 CLI no es estrictamente necesario.
  record(
    'env: ANTHROPIC_API_KEY (opcional para CLI demo)',
    Boolean(process.env.ANTHROPIC_API_KEY),
    process.env.ANTHROPIC_API_KEY ? 'set' : 'ausente — OK si no usas chat en demo',
    true,
  );
  record(
    'env: GOOGLE_GEOCODING_API_KEY (opcional)',
    Boolean(process.env.GOOGLE_GEOCODING_API_KEY),
    process.env.GOOGLE_GEOCODING_API_KEY ? 'set' : 'ausente — OK si no usas geocoding',
    true,
  );

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

  // ─── 3. Supabase REST API: migraciones + user + dispatch ───
  // Usamos fetch directo a /rest/v1/ (mismo patrón que create-cdmx-dispatch.mjs)
  // para no depender del SDK @supabase/supabase-js fuera del workspace.
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sbHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  async function sbSelect(path) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders });
    const status = res.status;
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status, body, ok: res.ok };
  }

  // 3a. customers.optimizer_costs existe (mig 045)?
  {
    const { ok, body } = await sbSelect('customers?select=optimizer_costs&limit=1');
    record(
      'migración 045 (customers.optimizer_costs)',
      ok,
      ok ? 'columna existe' : (body?.message ?? `HTTP ${body?.code ?? '?'}`),
    );
  }

  // 3b. orchestrator_sessions.active_agent_role existe (mig 046)?
  {
    const { ok, body } = await sbSelect('orchestrator_sessions?select=active_agent_role&limit=1');
    record(
      'migración 046 (orchestrator_sessions.active_agent_role)',
      ok,
      ok ? 'columna existe' : (body?.message ?? `HTTP ${body?.code ?? '?'}`),
    );
  }

  // 3c. User existe y es admin/dispatcher activo
  {
    const { ok, body } = await sbSelect(
      `user_profiles?id=eq.${args.user}&select=id,role,is_active,customer_id&limit=1`,
    );
    if (!ok || !Array.isArray(body) || body.length === 0) {
      record('user existe', false, body?.message ?? 'no encontrado');
    } else {
      const u = body[0];
      record('user existe', true, `role=${u.role}, customer_id=${u.customer_id?.slice(0, 8)}...`);
      record(
        'user es admin/dispatcher activo',
        ['admin', 'dispatcher'].includes(u.role) && u.is_active,
        u.is_active ? `role=${u.role}` : 'inactivo',
      );
    }
  }

  // 3d. Si pasaron --dispatch, validar que existe y tiene rutas con paradas
  if (args.dispatch) {
    const { ok, body } = await sbSelect(
      `dispatches?id=eq.${args.dispatch}&select=id,name,date,status&limit=1`,
    );
    if (!ok || !Array.isArray(body) || body.length === 0) {
      record('dispatch existe', false, body?.message ?? 'no encontrado');
    } else {
      const d = body[0];
      record('dispatch existe', true, `${d.name} (${d.date}, ${d.status})`);

      const r = await sbSelect(
        `routes?dispatch_id=eq.${args.dispatch}&select=id,name,vehicle_id,status`,
      );
      const routes = Array.isArray(r.body) ? r.body : [];
      record('dispatch tiene rutas', routes.length > 0, `${routes.length} rutas`);

      if (routes.length > 0) {
        const routeIdsCsv = routes.map((rt) => rt.id).join(',');
        const s = await sbSelect(
          `stops?route_id=in.(${routeIdsCsv})&select=id,store_id,route_id`,
        );
        const stops = Array.isArray(s.body) ? s.body : [];
        const uniqueStores = new Set(stops.map((st) => st.store_id));
        record(
          'dispatch tiene tiendas',
          uniqueStores.size > 0,
          `${uniqueStores.size} tiendas únicas en ${stops.length} paradas`,
        );

        if (uniqueStores.size < 5) {
          record('demo-worthy (≥5 stops)', false, `solo ${uniqueStores.size} — propuesta poco interesante`);
        } else {
          record('demo-worthy (≥5 stops)', true);
        }
      }
    }
  } else {
    console.log('ℹ️  --dispatch no pasado, salto verificación de tiro específico.');
  }

  // ─── 4. Endpoint reachable ───
  const baseUrl = process.env.PLATFORM_BASE_URL ?? 'http://localhost:3000';
  try {
    // Hit el endpoint con un body inválido a propósito — debe responder 400 (no 404 ni 502).
    const res = await fetch(`${baseUrl}/api/orchestrator/internal/propose-routes`, {
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
  const fails = checks.filter((c) => !c.ok && !c.optional);
  const optionalMissing = checks.filter((c) => !c.ok && c.optional);
  if (fails.length === 0) {
    if (optionalMissing.length > 0) {
      console.log(`✅ Pre-flight OK. (${optionalMissing.length} opcional/es ausente/s, no bloquea demo.)`);
    } else {
      console.log('✅ Pre-flight OK. Listo para demo.');
    }
    process.exit(0);
  } else {
    console.log(`❌ ${fails.length} check(s) crítico(s) fallaron:`);
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
