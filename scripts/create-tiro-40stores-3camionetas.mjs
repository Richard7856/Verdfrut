#!/usr/bin/env node
// One-shot: crea un tiro CDMX con las 40 tiendas nuevas del XLSX de expansión
// (los codes con IDs del XLSX 30/04) repartidas en 3 camionetas.
// Fecha: 2026-05-12 (mañana al momento de correr esto).
//
// Approach:
//   - Filtro stores con los 40 IDs del XLSX (codes CDMX-{id})
//   - Split por longitud en 3 tercios (oeste / centro / este)
//   - Para cada camioneta: NN-order desde CEDA + ETAs haversine×1.4 / 25km/h
//   - Status final: OPTIMIZED (admin re-optimiza desde UI cuando MAPBOX listo)
//
// La 3a camioneta arranca sin chofer (solo 2 choferes activos hoy) — el admin
// asigna desde UI con el flujo normal antes de publicar.

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
    if (process.env[m[1]]) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadDotenv(path.join(ROOT, 'apps/platform/.env.local'));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Faltan env vars SUPABASE');
  process.exit(1);
}

// IDs Neto de las 40 tiendas del XLSX de expansión 30/04.
const STORE_IDS = [
  1550, 582, 804, 1294, 805, 288, 1106, 1669, 1680, 1758,
  3838, 567, 6684, 1996, 3622, 139, 774, 303, 3698, 9036,
  3729, 3505, 792, 3557, 257, 1007, 146, 3705, 3900, 456,
  832, 8884, 3621, 907, 293, 795, 3708, 8881, 197, 1655,
];
const STORE_CODES = STORE_IDS.map((id) => `CDMX-${id}`);

const DATE = '2026-05-12';
const ZONE_CDMX = '50b842b4-b00d-41db-ac1c-fea0f052cbec';
const DEPOT_CEDA = { lat: 19.3722, lng: -99.0907 };
const ADMIN_USER_ID = '03a6e456-d95e-4d71-8802-34d1f66818e4';
const TZ_OFFSET_HOURS = 6;
const SHIFT_START_LOCAL = '05:30';
const URBAN_DETOUR = 1.4;
const ASSUMED_MS = 7;       // 7 m/s ~ 25 km/h promedio urbano
const SERVICE_SECONDS = 1800; // 30 min por parada

// Vehículos disponibles (de BD)
const ASSIGNMENTS_TEMPLATE = [
  { alias: 'Kangoo 1 (Oeste)', vehicleId: 'f7376489-3123-40fc-ab72-9d2c44dd8abb', driverId: 'ddc6732a-3116-4e79-af28-17c87c47fdd2' },
  { alias: 'Kangoo 2 (Centro)', vehicleId: 'a200f79a-0dd4-4301-9124-56c1a1ea16aa', driverId: '0483989d-95f0-4e38-805a-b9ae4f42065d' },
  { alias: 'Kangoo 3 (Este)', vehicleId: 'b53a0f16-05a2-4a96-a555-340d60b2c7d7', driverId: null }, // sin chofer asignado — admin lo asigna desde UI
];

const REST = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
};

async function sb(method, p, body) {
  const headers = { ...REST };
  if (method !== 'GET') headers['Prefer'] = 'return=representation';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${p}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

function localToUnix(date, time) {
  const [hh, mm] = time.split(':').map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCHours(hh + TZ_OFFSET_HOURS, mm, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function haversine(a, b) {
  const R = 6371000;
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sa));
}

function nearestNeighborOrder(start, pool) {
  const remaining = [...pool];
  const ordered = [];
  let current = { lat: start.lat, lng: start.lng };
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = haversine(current, remaining[0]);
    for (let i = 1; i < remaining.length; i++) {
      const d = haversine(current, remaining[i]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    ordered.push(remaining[bestIdx]);
    current = remaining[bestIdx];
    remaining.splice(bestIdx, 1);
  }
  return ordered;
}

// Split en 3 tercios por longitud (la cuesta CDMX-Edomex va este-oeste, así que
// dividir por lng minimiza solapamiento entre rutas).
function splitInThirds(stores) {
  const sorted = [...stores].sort((a, b) => a.lng - b.lng);
  const n = sorted.length;
  const t1 = Math.floor(n / 3);
  const t2 = Math.floor((2 * n) / 3);
  return [
    sorted.slice(0, t1),       // oeste (lng menor)
    sorted.slice(t1, t2),      // centro
    sorted.slice(t2),          // este (lng mayor, cerca de CEDA)
  ];
}

function buildSteps(order, shiftStartUnix) {
  let cumulativeUnix = shiftStartUnix;
  let cumulativeDistance = 0;
  let prev = DEPOT_CEDA;
  const steps = [];
  for (const s of order) {
    const distMeters = Math.round(haversine(prev, s) * URBAN_DETOUR);
    const travelSeconds = Math.round(distMeters / ASSUMED_MS);
    const arrivalUnix = cumulativeUnix + travelSeconds;
    const departureUnix = arrivalUnix + SERVICE_SECONDS;
    steps.push({ store: s, arrival: arrivalUnix, departure: departureUnix });
    cumulativeDistance += distMeters;
    cumulativeUnix = departureUnix;
    prev = s;
  }
  const closingDist = Math.round(haversine(prev, DEPOT_CEDA) * URBAN_DETOUR);
  cumulativeDistance += closingDist;
  return {
    steps,
    totalDistance: cumulativeDistance,
    totalDuration: Math.round((cumulativeUnix - shiftStartUnix) / ASSUMED_MS), // se sobreescribe abajo
    estimatedStartUnix: shiftStartUnix,
    estimatedEndUnix: cumulativeUnix + Math.round(closingDist / ASSUMED_MS),
  };
}

// ---------------------------------------------------------------------------
console.log(`[tiro-40] Creando tiro fecha=${DATE} con 3 camionetas, ${STORE_IDS.length} tiendas…`);

// 1. Fetch las 40 tiendas
const codeList = STORE_CODES.map((c) => `"${c}"`).join(',');
const stores = await sb('GET', `stores?select=id,code,name,lat,lng&code=in.(${codeList})&order=code`);
console.log(`[tiro-40] ${stores.length}/${STORE_IDS.length} tiendas encontradas en BD.`);
if (stores.length !== STORE_IDS.length) {
  const found = new Set(stores.map((s) => s.code));
  const missing = STORE_CODES.filter((c) => !found.has(c));
  console.error(`[tiro-40] FALTAN ${missing.length} en BD: ${missing.join(', ')}`);
  process.exit(1);
}

// 2. Split en 3 tercios
const [oeste, centro, este] = splitInThirds(stores);
console.log(`[tiro-40] Split por longitud: oeste=${oeste.length}, centro=${centro.length}, este=${este.length}`);

// 3. Construir asignaciones con NN-order
const shiftStartUnix = localToUnix(DATE, SHIFT_START_LOCAL);
const buckets = [oeste, centro, este];
const assignments = ASSIGNMENTS_TEMPLATE.map((a, i) => ({
  ...a,
  stores: nearestNeighborOrder(DEPOT_CEDA, buckets[i]),
}));

// 4. Resolver dispatch: si se pasó --reuse-dispatch=<id>, usar ese (idempotencia
// tras fallo a mitad de un intento previo). Si no, crear uno nuevo.
const dispatchName = `Tiro CDMX ${DATE.slice(8, 10)}/${DATE.slice(5, 7)} — Expansión 40 tiendas (3 camionetas)`;
const reuseId = process.argv.find((a) => a.startsWith('--reuse-dispatch='))?.split('=')[1];
let dispatch;
if (reuseId) {
  // Validar que existe, está en la fecha/zona correcta y NO tiene rutas vivas.
  const [existing] = await sb('GET', `dispatches?select=id,date,zone_id&id=eq.${reuseId}`);
  if (!existing) {
    console.error(`[tiro-40] --reuse-dispatch=${reuseId} no encontrado`);
    process.exit(1);
  }
  if (existing.date !== DATE || existing.zone_id !== ZONE_CDMX) {
    console.error(`[tiro-40] El dispatch ${reuseId} es de date=${existing.date} zone=${existing.zone_id} — no coincide`);
    process.exit(1);
  }
  const existingRoutes = await sb('GET', `routes?select=id,status&dispatch_id=eq.${reuseId}`);
  const alive = existingRoutes.filter((r) => !['CANCELLED', 'COMPLETED', 'INTERRUPTED'].includes(r.status));
  if (alive.length > 0) {
    console.error(`[tiro-40] El dispatch ${reuseId} ya tiene ${alive.length} ruta(s) vivas — abortando`);
    process.exit(1);
  }
  dispatch = existing;
  console.log(`[tiro-40] Reusando dispatch existente: ${dispatch.id}`);
} else {
  const [created] = await sb('POST', 'dispatches', {
    name: dispatchName,
    date: DATE,
    zone_id: ZONE_CDMX,
    notes:
      `Auto-creado vía script. Las 40 tiendas nuevas del XLSX de expansión 30/04 (CDMX). ` +
      `Split por longitud en 3 tercios (oeste/centro/este), NN-order desde CEDA. ` +
      `ETAs aproximadas haversine×1.4 / 25km/h — re-optimizar desde UI con Mapbox para precisión.`,
    created_by: ADMIN_USER_ID,
  });
  dispatch = created;
  console.log(`[tiro-40] Dispatch creado: ${dispatch.id}`);
}

// 5. Crear rutas + stops + marcar OPTIMIZED
for (const a of assignments) {
  const built = buildSteps(a.stores, shiftStartUnix);
  const [route] = await sb('POST', 'routes', {
    name: `${dispatchName} — ${a.alias}`,
    date: DATE,
    vehicle_id: a.vehicleId,
    driver_id: a.driverId,
    zone_id: ZONE_CDMX,
    status: 'DRAFT',
    created_by: ADMIN_USER_ID,
    dispatch_id: dispatch.id,
  });

  const stopRows = built.steps.map((step, idx) => ({
    route_id: route.id,
    store_id: step.store.id,
    sequence: idx + 1,
    status: 'pending',
    planned_arrival_at: new Date(step.arrival * 1000).toISOString(),
    planned_departure_at: new Date(step.departure * 1000).toISOString(),
    load: [50, 0, 1],
  }));
  await sb('POST', 'stops', stopRows);

  const totalDurationSec = built.estimatedEndUnix - built.estimatedStartUnix;
  await sb('PATCH', `routes?id=eq.${route.id}`, {
    status: 'OPTIMIZED',
    total_distance_meters: built.totalDistance,
    total_duration_seconds: totalDurationSec,
    estimated_start_at: new Date(built.estimatedStartUnix * 1000).toISOString(),
    estimated_end_at: new Date(built.estimatedEndUnix * 1000).toISOString(),
  });

  console.log(
    `[tiro-40] ${a.alias.padEnd(20)} ${built.steps.length} paradas · ` +
      `${(built.totalDistance / 1000).toFixed(1)} km · ` +
      `${Math.round(totalDurationSec / 60)} min total${a.driverId ? '' : ' (sin chofer)'}`,
  );
}

console.log(`\n[tiro-40] ✅ Listo. Dispatch ID: ${dispatch.id}`);
console.log(`Ver UI:`);
console.log(`  Local: http://localhost:3000/dispatches/${dispatch.id}`);
console.log(`  Prod:  https://verdfrut-platform.vercel.app/dispatches/${dispatch.id}`);
