#!/usr/bin/env node
// Crea un tiro + 2 rutas Toluca llamando al optimizer Railway directamente.
// Replica lo que hace `createAndOptimizeRoute` server action pero sin auth UI.
//
// Uso:
//   node scripts/create-toluca-dispatch.mjs --date=2026-05-11

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
  console.error('Faltan env vars: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const dateArg = args.find((a) => a.startsWith('--date='))?.split('=')[1] ?? '2026-05-11';

// Constantes operativas
const ZONE_CDMX = '50b842b4-b00d-41db-ac1c-fea0f052cbec';
const DEPOT_CEDA_LAT = 19.3722;
const DEPOT_CEDA_LNG = -99.0907;
const ADMIN_USER_ID = '03a6e456-d95e-4d71-8802-34d1f66818e4';
const TZ_OFFSET_HOURS = 6;  // CDMX UTC-6 (no DST)
const SHIFT_START_LOCAL = '04:00';  // las Toluca están lejos, salida muy temprano
const SHIFT_END_LOCAL = '22:00';    // shift extendido por dispersión geográfica

// Vehicles + drivers a usar
const VEHICLE_KANGOO_1 = 'f7376489-3123-40fc-ab72-9d2c44dd8abb';
const VEHICLE_KANGOO_2 = 'a200f79a-0dd4-4301-9124-56c1a1ea16aa';
const DRIVER_VILLAFRTTY = 'ddc6732a-3116-4e79-af28-17c87c47fdd2';
const DRIVER_CHOFER1 = '0483989d-95f0-4e38-805a-b9ae4f42065d';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const REST = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
};

async function sb(method, pathSeg, body) {
  const headers = { ...REST };
  if (method !== 'GET') headers['Prefer'] = 'return=representation';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathSeg}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${pathSeg}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

function localToUnix(date, time) {
  const [hh, mm] = time.split(':').map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCHours(hh + TZ_OFFSET_HOURS, mm, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function haversineMeters(a, b) {
  const R = 6371000;
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const sa = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sa));
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
console.log(`[create-toluca] Creando tiro para ${dateArg} con 2 camionetas + 15 tiendas TOL-*…`);

// 1. Fetch stores TOL-*
const stores = await sb('GET',
  `stores?select=id,code,name,lat,lng&code=like.TOL-%25&order=code`);
console.log(`[create-toluca] ${stores.length} tiendas TOL-* cargadas.`);

// 2. Asignación heurística sin optimizer Railway (más simple para script):
//    a. Split por longitud — tiendas más al este (lng > -99.95) → Kangoo 1, otras → Kangoo 2.
//       Razón: CEDA está al este (lng -99.09), las tiendas del este son las más cercanas.
//    b. Dentro de cada vehículo, ordenar nearest-neighbor desde CEDA.
//    c. Calcular ETAs: shift_start + cumulative(travel haversine×1.4 / 25kmh + 30min servicio).
//    Trade-off: subóptimo vs VROOM real, pero deja el dispatch consumible. El admin puede
//    re-optimizar desde UI cuando MAPBOX_DIRECTIONS_TOKEN esté en Vercel platform.
const shiftStartUnix = localToUnix(dateArg, SHIFT_START_LOCAL);
const URBAN_DETOUR = 1.4;
const ASSUMED_MS = 7;  // 25 km/h en m/s
const SERVICE_SECONDS = 1800;
const SPLIT_LNG = -99.95;

const east = stores.filter((s) => s.lng > SPLIT_LNG);
const west = stores.filter((s) => s.lng <= SPLIT_LNG);

function nearestNeighborOrder(start, pool) {
  const remaining = [...pool];
  const ordered = [];
  let current = { lat: start.lat, lng: start.lng };
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = haversineMeters(current, remaining[0]);
    for (let i = 1; i < remaining.length; i++) {
      const d = haversineMeters(current, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    ordered.push(remaining[bestIdx]);
    current = remaining[bestIdx];
    remaining.splice(bestIdx, 1);
  }
  return ordered;
}

const depot = { lat: DEPOT_CEDA_LAT, lng: DEPOT_CEDA_LNG };
const v1Order = nearestNeighborOrder(depot, east);
const v2Order = nearestNeighborOrder(depot, west);

function buildSteps(order) {
  // Calcula arrival/departure para cada stop + total distance/duration de la ruta
  let cumulativeUnix = shiftStartUnix;
  let cumulativeDistance = 0;
  let cumulativeTravel = 0;  // solo manejo, sin servicio
  let prev = depot;
  const steps = [];
  for (const s of order) {
    const distMeters = Math.round(haversineMeters(prev, s) * URBAN_DETOUR);
    const travelSeconds = Math.round(distMeters / ASSUMED_MS);
    const arrivalUnix = cumulativeUnix + travelSeconds;
    const departureUnix = arrivalUnix + SERVICE_SECONDS;
    steps.push({
      store: s,
      arrival: arrivalUnix,
      departure: departureUnix,
    });
    cumulativeDistance += distMeters;
    cumulativeTravel += travelSeconds;
    cumulativeUnix = departureUnix;
    prev = s;
  }
  // Cierre depot → no agregamos step pero suma a distance/duration
  const closingDist = Math.round(haversineMeters(prev, depot) * URBAN_DETOUR);
  cumulativeDistance += closingDist;
  cumulativeTravel += Math.round(closingDist / ASSUMED_MS);
  return {
    steps,
    totalDistance: cumulativeDistance,
    totalDuration: cumulativeTravel,
    estimatedStartUnix: shiftStartUnix,
    estimatedEndUnix: cumulativeUnix + Math.round(closingDist / ASSUMED_MS),
  };
}

const optResult = {
  routes: [
    { vehicle_id: 1, ...buildSteps(v1Order) },
    { vehicle_id: 2, ...buildSteps(v2Order) },
  ],
  unassigned: [],
};
console.log(`[create-toluca] Asignación heurística: V1=${optResult.routes[0].steps.length} tiendas, V2=${optResult.routes[1].steps.length} tiendas.`);

// 3. Crear dispatch
const [dispatch] = await sb('POST', 'dispatches', {
  name: 'Tiro Toluca 11/05 (2 camionetas)',
  date: dateArg,
  zone_id: ZONE_CDMX,
  notes: 'Auto-creado vía script para probar split entre 2 camionetas Toluca.',
  created_by: ADMIN_USER_ID,
});
console.log(`[create-toluca] Dispatch creado: ${dispatch.id}`);

// 4. Crear 2 rutas + stops
const VEHICLES = [
  { id: VEHICLE_KANGOO_1, alias: 'Kangoo 1', driverId: DRIVER_VILLAFRTTY },
  { id: VEHICLE_KANGOO_2, alias: 'Kangoo 2', driverId: DRIVER_CHOFER1 },
];

for (let i = 0; i < VEHICLES.length; i++) {
  const v = VEHICLES[i];
  const optRoute = optResult.routes.find((r) => r.vehicle_id === i + 1);
  if (!optRoute || optRoute.steps.length === 0) {
    console.log(`[create-toluca] ${v.alias}: sin paradas asignadas, no se crea ruta.`);
    continue;
  }

  const [route] = await sb('POST', 'routes', {
    name: `Tiro Toluca 11/05 — ${v.alias}`,
    date: dateArg,
    vehicle_id: v.id,
    driver_id: v.driverId,
    zone_id: ZONE_CDMX,
    status: 'DRAFT',
    created_by: ADMIN_USER_ID,
    dispatch_id: dispatch.id,
  });

  const stopRows = optRoute.steps.map((step, idx) => ({
    route_id: route.id,
    store_id: step.store.id,
    sequence: idx + 1,
    status: 'pending',
    planned_arrival_at: new Date(step.arrival * 1000).toISOString(),
    planned_departure_at: new Date(step.departure * 1000).toISOString(),
    load: [50, 0, 1],
  }));
  await sb('POST', 'stops', stopRows);

  await sb('PATCH', `routes?id=eq.${route.id}`, {
    status: 'OPTIMIZED',
    total_distance_meters: optRoute.totalDistance,
    total_duration_seconds: optRoute.totalDuration,
    estimated_start_at: new Date(optRoute.estimatedStartUnix * 1000).toISOString(),
    estimated_end_at: new Date(optRoute.estimatedEndUnix * 1000).toISOString(),
  });

  console.log(
    `[create-toluca] ${v.alias}: ${optRoute.steps.length} paradas, ` +
      `${(optRoute.totalDistance / 1000).toFixed(1)} km, ` +
      `${Math.round(optRoute.totalDuration / 60)} min manejo.`,
  );
}

console.log(`\n[create-toluca] ✅ Listo.`);
console.log(`Tiro: ${SUPABASE_URL.replace('.supabase.co','')} | dispatch_id=${dispatch.id}`);
console.log(`Ver en UI: https://verdfrut-platform.vercel.app/dispatches/${dispatch.id}`);

if (optResult.unassigned?.length > 0) {
  console.log(`\n⚠️ Tiendas no asignadas (${optResult.unassigned.length}):`);
  for (const u of optResult.unassigned) {
    const s = stores[u.job_id - 1];
    console.log(`   ${s.code} ${s.name} — razón: ${u.reason}`);
  }
}
