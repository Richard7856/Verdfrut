#!/usr/bin/env node
// Tiro de simulación Toluca saliendo desde CEDIS Toluca (planeado).
// Compara metricas vs salir desde CEDA: km totales y minutos.
//
// Uso:
//   node scripts/create-toluca-from-cedis.mjs --date=2026-05-13 [--vehicles=1]
//
// Pre-requisitos en BD (ya creados):
//   - depot id 5fbd3a9e-5b79-4aa4-b0f8-61f7f04a080d (CEDIS Toluca, lat 19.287404 lng -99.666928)
//   - vehicle id 1e727468-f543-4f79-a44c-6b1cc3b6c457 (Kangoo Toluca sim, depot=CEDIS Toluca)
//
// El script asigna las 15 tiendas TOL-* en NN-order desde el nuevo CEDIS.
// También calcula la métrica de salir desde CEDA para comparar (sin crear tiro CEDA).

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
  console.error('Faltan env vars NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const dateArg = args.find((a) => a.startsWith('--date='))?.split('=')[1] ?? '2026-05-13';

// Constantes
const ZONE_CDMX = '50b842b4-b00d-41db-ac1c-fea0f052cbec';
const DEPOT_CEDIS_TOL = { id: '5fbd3a9e-5b79-4aa4-b0f8-61f7f04a080d', lat: 19.287404, lng: -99.666928 };
const DEPOT_CEDA = { id: '876ae532-24cb-4314-aa7b-a7a5e3ba9708', lat: 19.3722, lng: -99.0907 };
const VEHICLE_KANGOO_TOL = '1e727468-f543-4f79-a44c-6b1cc3b6c457';
const DRIVER_VILLAFRTTY = 'ddc6732a-3116-4e79-af28-17c87c47fdd2';
const ADMIN_USER_ID = '03a6e456-d95e-4d71-8802-34d1f66818e4';
const TZ_OFFSET_HOURS = 6;
const SHIFT_START_LOCAL = '05:30';
const URBAN_DETOUR = 1.4;
const ASSUMED_MS = 7;
const SERVICE_SECONDS = 1800;

const REST = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' };
async function sb(method, p, body) {
  const headers = { ...REST };
  if (method !== 'GET') headers['Prefer'] = 'return=representation';
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`Supabase ${method} ${p}: HTTP ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

function localToUnix(date, time) {
  const [hh, mm] = time.split(':').map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCHours(hh + TZ_OFFSET_HOURS, mm, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function haversineMeters(a, b) {
  const R = 6371000, r = (d) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const sa = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sa));
}

function nearestNeighborOrder(start, pool) {
  const remaining = [...pool], ordered = [];
  let cur = { lat: start.lat, lng: start.lng };
  while (remaining.length) {
    let bi = 0, bd = haversineMeters(cur, remaining[0]);
    for (let i = 1; i < remaining.length; i++) {
      const d = haversineMeters(cur, remaining[i]);
      if (d < bd) { bd = d; bi = i; }
    }
    ordered.push(remaining[bi]);
    cur = remaining[bi];
    remaining.splice(bi, 1);
  }
  return ordered;
}

function buildSteps(order, depot, shiftStartUnix) {
  let cumU = shiftStartUnix, cumD = 0, cumT = 0, prev = depot;
  const steps = [];
  for (const s of order) {
    const distM = Math.round(haversineMeters(prev, s) * URBAN_DETOUR);
    const travelS = Math.round(distM / ASSUMED_MS);
    const arr = cumU + travelS, dep = arr + SERVICE_SECONDS;
    steps.push({ store: s, arrival: arr, departure: dep });
    cumD += distM; cumT += travelS; cumU = dep; prev = s;
  }
  const closeD = Math.round(haversineMeters(prev, depot) * URBAN_DETOUR);
  cumD += closeD; cumT += Math.round(closeD / ASSUMED_MS);
  return { steps, totalDistance: cumD, totalDuration: cumT, estimatedStartUnix: shiftStartUnix, estimatedEndUnix: cumU + Math.round(closeD / ASSUMED_MS) };
}

console.log(`[sim-cedis-tol] tiro Toluca ${dateArg} desde CEDIS Toluca…`);
const stores = await sb('GET', `stores?select=id,code,name,lat,lng&code=like.TOL-%25&order=code`);
console.log(`[sim-cedis-tol] ${stores.length} tiendas TOL-* cargadas.`);

const shiftStartUnix = localToUnix(dateArg, SHIFT_START_LOCAL);

// --- Comparación métricas ---
const orderFromTol = nearestNeighborOrder(DEPOT_CEDIS_TOL, stores);
const builtTol = buildSteps(orderFromTol, DEPOT_CEDIS_TOL, shiftStartUnix);

const orderFromCeda = nearestNeighborOrder(DEPOT_CEDA, stores);
const builtCeda = buildSteps(orderFromCeda, DEPOT_CEDA, shiftStartUnix);

console.log('\n--- Comparativo (15 stops TOL-*, 1 camioneta) ---');
console.log(`Salir desde CEDA          : ${(builtCeda.totalDistance/1000).toFixed(1)} km, ${Math.round(builtCeda.totalDuration/60)} min manejo, total ${Math.round((builtCeda.estimatedEndUnix-builtCeda.estimatedStartUnix)/60)} min`);
console.log(`Salir desde CEDIS Toluca  : ${(builtTol.totalDistance/1000).toFixed(1)} km, ${Math.round(builtTol.totalDuration/60)} min manejo, total ${Math.round((builtTol.estimatedEndUnix-builtTol.estimatedStartUnix)/60)} min`);
const dKm = (builtCeda.totalDistance - builtTol.totalDistance) / 1000;
const dMin = Math.round((builtCeda.totalDuration - builtTol.totalDuration) / 60);
console.log(`Ahorro CEDIS Toluca       : ${dKm.toFixed(1)} km, ${dMin} min manejo (${((dKm/(builtCeda.totalDistance/1000))*100).toFixed(0)}% menos km)`);

// --- Crear tiro real con salida desde CEDIS Toluca ---
const dispatchName = `Tiro Toluca ${dateArg.slice(8,10)}/${dateArg.slice(5,7)} (CEDIS Toluca, sim)`;
const [dispatch] = await sb('POST', 'dispatches', {
  name: dispatchName,
  date: dateArg,
  zone_id: ZONE_CDMX,
  notes: `Simulación: 15 TOL-* saliendo desde CEDIS Toluca (planeado). Ahorro vs CEDA: ${dKm.toFixed(1)} km, ${dMin} min.`,
  created_by: ADMIN_USER_ID,
});
console.log(`\n[sim-cedis-tol] Dispatch creado: ${dispatch.id}`);

const [route] = await sb('POST', 'routes', {
  name: `${dispatchName} — Kangoo Toluca`,
  date: dateArg,
  vehicle_id: VEHICLE_KANGOO_TOL,
  driver_id: DRIVER_VILLAFRTTY,
  zone_id: ZONE_CDMX,
  status: 'DRAFT',
  created_by: ADMIN_USER_ID,
  dispatch_id: dispatch.id,
});

const stopRows = builtTol.steps.map((step, idx) => ({
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
  total_distance_meters: builtTol.totalDistance,
  total_duration_seconds: builtTol.totalDuration,
  estimated_start_at: new Date(builtTol.estimatedStartUnix * 1000).toISOString(),
  estimated_end_at: new Date(builtTol.estimatedEndUnix * 1000).toISOString(),
});

console.log(`[sim-cedis-tol] Route creada: ${route.id} (15 stops, ${(builtTol.totalDistance/1000).toFixed(1)} km, ${Math.round(builtTol.totalDuration/60)} min manejo)`);
console.log(`\n✅ UI: https://verdfrut-platform.vercel.app/dispatches/${dispatch.id}`);
