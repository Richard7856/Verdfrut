#!/usr/bin/env node
// Crea un tiro CDMX con N camionetas (default 1) llamando heurística NN desde CEDA.
// Las 15 tiendas CDMX-* están coord_verified vía Google Places (Tiendas Neto).
//
// Uso:
//   node scripts/create-cdmx-dispatch.mjs --date=2026-05-12              # 1 camioneta
//   node scripts/create-cdmx-dispatch.mjs --date=2026-05-12 --vehicles=2 # 2 camionetas split lng
//
// Heurística:
//   - 1 camioneta: NN-order desde CEDA con todas las 15 tiendas.
//   - 2 camionetas: split por longitud (mediana lng) → cada camioneta NN-order independiente.
// ETAs: shift_start + cumulative(haversine×1.4 / 25 km/h + 30 min servicio).
// Trade-off: subóptimo vs VROOM real. El admin re-optimiza desde UI cuando MAPBOX_DIRECTIONS_TOKEN esté en Vercel.

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
const dateArg = args.find((a) => a.startsWith('--date='))?.split('=')[1] ?? '2026-05-12';
const vehiclesArg = parseInt(args.find((a) => a.startsWith('--vehicles='))?.split('=')[1] ?? '1', 10);
if (vehiclesArg !== 1 && vehiclesArg !== 2) {
  console.error('--vehicles debe ser 1 o 2');
  process.exit(1);
}

// Constantes operativas (ver project-state.md)
const ZONE_CDMX = '50b842b4-b00d-41db-ac1c-fea0f052cbec';
const DEPOT_CEDA_LAT = 19.3722;
const DEPOT_CEDA_LNG = -99.0907;
const ADMIN_USER_ID = '03a6e456-d95e-4d71-8802-34d1f66818e4';
const TZ_OFFSET_HOURS = 6;
const SHIFT_START_LOCAL = '05:30';
const URBAN_DETOUR = 1.4;
const ASSUMED_MS = 7;
const SERVICE_SECONDS = 1800;

const VEHICLE_KANGOO_1 = 'f7376489-3123-40fc-ab72-9d2c44dd8abb';
const VEHICLE_KANGOO_2 = 'a200f79a-0dd4-4301-9124-56c1a1ea16aa';
const DRIVER_VILLAFRTTY = 'ddc6732a-3116-4e79-af28-17c87c47fdd2';
const DRIVER_CHOFER1 = '0483989d-95f0-4e38-805a-b9ae4f42065d';

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

function nearestNeighborOrder(start, pool) {
  const remaining = [...pool];
  const ordered = [];
  let current = { lat: start.lat, lng: start.lng };
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = haversineMeters(current, remaining[0]);
    for (let i = 1; i < remaining.length; i++) {
      const d = haversineMeters(current, remaining[i]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    ordered.push(remaining[bestIdx]);
    current = remaining[bestIdx];
    remaining.splice(bestIdx, 1);
  }
  return ordered;
}

console.log(`[create-cdmx] tiro ${dateArg}, ${vehiclesArg} camioneta${vehiclesArg>1?'s':''}…`);

// 1. Fetch stores CDMX-*
const stores = await sb('GET', `stores?select=id,code,name,lat,lng&code=like.CDMX-%25&order=code`);
console.log(`[create-cdmx] ${stores.length} tiendas CDMX-* cargadas.`);

// 2. Asignación
const shiftStartUnix = localToUnix(dateArg, SHIFT_START_LOCAL);
const depot = { lat: DEPOT_CEDA_LAT, lng: DEPOT_CEDA_LNG };

let assignments;
if (vehiclesArg === 1) {
  assignments = [{ alias: 'Kangoo 1', vehicleId: VEHICLE_KANGOO_1, driverId: DRIVER_VILLAFRTTY, stores: nearestNeighborOrder(depot, stores) }];
} else {
  // Split por mediana de lng (este vs oeste de CDMX dado el cluster de tiendas)
  const sortedByLng = [...stores].sort((a, b) => a.lng - b.lng);
  const mid = Math.ceil(sortedByLng.length / 2);
  const west = sortedByLng.slice(0, mid);     // lng menor (más al oeste)
  const east = sortedByLng.slice(mid);        // lng mayor (más al este, cerca de CEDA)
  assignments = [
    { alias: 'Kangoo 1 (Este)', vehicleId: VEHICLE_KANGOO_1, driverId: DRIVER_VILLAFRTTY, stores: nearestNeighborOrder(depot, east) },
    { alias: 'Kangoo 2 (Oeste)', vehicleId: VEHICLE_KANGOO_2, driverId: DRIVER_CHOFER1, stores: nearestNeighborOrder(depot, west) },
  ];
}

function buildSteps(order) {
  let cumulativeUnix = shiftStartUnix;
  let cumulativeDistance = 0;
  let cumulativeTravel = 0;
  let prev = depot;
  const steps = [];
  for (const s of order) {
    const distMeters = Math.round(haversineMeters(prev, s) * URBAN_DETOUR);
    const travelSeconds = Math.round(distMeters / ASSUMED_MS);
    const arrivalUnix = cumulativeUnix + travelSeconds;
    const departureUnix = arrivalUnix + SERVICE_SECONDS;
    steps.push({ store: s, arrival: arrivalUnix, departure: departureUnix });
    cumulativeDistance += distMeters;
    cumulativeTravel += travelSeconds;
    cumulativeUnix = departureUnix;
    prev = s;
  }
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

// 3. Crear dispatch
const dispatchName = vehiclesArg === 1
  ? `Tiro CDMX ${dateArg.slice(8,10)}/${dateArg.slice(5,7)} (1 camioneta)`
  : `Tiro CDMX ${dateArg.slice(8,10)}/${dateArg.slice(5,7)} (2 camionetas)`;

const [dispatch] = await sb('POST', 'dispatches', {
  name: dispatchName,
  date: dateArg,
  zone_id: ZONE_CDMX,
  notes: `Auto-creado vía script. ${vehiclesArg === 1 ? '1 camioneta, NN desde CEDA' : '2 camionetas, split por longitud'}. Coords Places-verified 2026-05-09.`,
  created_by: ADMIN_USER_ID,
});
console.log(`[create-cdmx] Dispatch creado: ${dispatch.id}`);

// 4. Crear rutas
for (const a of assignments) {
  const built = buildSteps(a.stores);
  const [route] = await sb('POST', 'routes', {
    name: `${dispatchName} — ${a.alias}`,
    date: dateArg,
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

  await sb('PATCH', `routes?id=eq.${route.id}`, {
    status: 'OPTIMIZED',
    total_distance_meters: built.totalDistance,
    total_duration_seconds: built.totalDuration,
    estimated_start_at: new Date(built.estimatedStartUnix * 1000).toISOString(),
    estimated_end_at: new Date(built.estimatedEndUnix * 1000).toISOString(),
  });

  console.log(
    `[create-cdmx] ${a.alias}: ${built.steps.length} paradas, ` +
      `${(built.totalDistance / 1000).toFixed(1)} km manejo, ` +
      `${Math.round(built.totalDuration / 60)} min en ruta. ` +
      `Total con servicio: ${Math.round((built.estimatedEndUnix - built.estimatedStartUnix) / 60)} min.`,
  );
}

console.log(`\n[create-cdmx] ✅ Listo.`);
console.log(`Ver UI: https://verdfrut-platform.vercel.app/dispatches/${dispatch.id}`);
