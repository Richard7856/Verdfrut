#!/usr/bin/env node
// Re-geocodifica tiendas con Google Geocoding API y actualiza lat/lng en BD.
// ADR-042: las tiendas Toluca se cargaron con coords aproximadas vía Nominatim
// (margen 100m–2km). Este script usa Google Maps Geocoding (mismo dataset que
// Maps consumer) para refinarlas a la dirección exacta.
//
// Modo default: DRY-RUN. Imprime delta de coords y no escribe nada.
// Pasar --apply para hacer UPDATE en BD + marcar coord_verified=true.
//
// Filtros:
//   --filter=TOL-*        Default: solo no-verificadas (coord_verified=false)
//   --filter=ALL          Re-geocodifica TODAS (incluso verified)
//   --code=TOL-1977       Una sola tienda por code
//
// Env vars requeridas (cargadas desde apps/platform/.env.local o ENV del shell):
//   GOOGLE_GEOCODING_API_KEY  ← tu API key de Google Cloud Geocoding API
//   NEXT_PUBLIC_SUPABASE_URL  ← URL del proyecto Supabase
//   SUPABASE_SERVICE_ROLE_KEY ← service role (RLS bypass para UPDATE)
//
// Uso típico:
//   1. node scripts/geocode-stores.mjs                    # dry-run, ve deltas
//   2. node scripts/geocode-stores.mjs --apply            # commit cambios
//   3. node scripts/geocode-stores.mjs --code=TOL-1977 --apply  # solo una

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Sin dependencias externas: usamos fetch directo a Supabase REST API.

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

// ---------------------------------------------------------------------------
// Cargar env vars desde .env.local del platform si no están en el shell.
// Sólo leemos archivo, no lo modificamos.
// ---------------------------------------------------------------------------
function loadDotenv(file) {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key]) continue; // shell ENV gana
    let val = raw.trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadDotenv(path.join(ROOT, 'apps/platform/.env.local'));
loadDotenv(path.join(ROOT, 'apps/platform/.env'));
loadDotenv(path.join(ROOT, '.env.local'));

const GOOGLE_KEY = process.env.GOOGLE_GEOCODING_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GOOGLE_KEY) {
  console.error('[geocode] FALTA GOOGLE_GEOCODING_API_KEY en env (.env.local del platform o shell).');
  process.exit(1);
}
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('[geocode] FALTA NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const filterArg = args.find((a) => a.startsWith('--filter='))?.split('=')[1] ?? null;
const codeArg = args.find((a) => a.startsWith('--code='))?.split('=')[1] ?? null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sa));
}

async function googleGeocode(address) {
  // Components hint: country=MX para evitar resultados ambiguos.
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?' +
    new URLSearchParams({
      address,
      components: 'country:MX',
      key: GOOGLE_KEY,
    });
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === 'OK' && data.results?.[0]) {
    const r = data.results[0];
    return {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      formattedAddress: r.formatted_address,
      // location_type: ROOFTOP (exacto) | RANGE_INTERPOLATED | GEOMETRIC_CENTER | APPROXIMATE
      locationType: r.geometry.location_type,
      placeId: r.place_id,
    };
  }
  throw new Error(`Google geocode status=${data.status} ${data.error_message ?? ''}`.trim());
}

// ---------------------------------------------------------------------------
// Supabase REST helpers (sin SDK externo)
// ---------------------------------------------------------------------------
const REST_HEADERS = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
};

async function selectStores() {
  const params = new URLSearchParams({
    select: 'id,code,name,address,lat,lng,coord_verified',
    order: 'code.asc',
  });
  if (codeArg) {
    params.append('code', `eq.${codeArg}`);
  } else if (filterArg === 'ALL') {
    // sin filtro
  } else if (filterArg && filterArg.includes('*')) {
    params.append('code', `like.${filterArg.replace('*', '%')}`);
  } else {
    params.append('coord_verified', 'eq.false');
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/stores?${params}`, { headers: REST_HEADERS });
  if (!res.ok) throw new Error(`Supabase select: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function updateStore(id, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/stores?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...REST_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
let stores;
try {
  stores = await selectStores();
} catch (err) {
  console.error('[geocode] Error leyendo stores:', err.message);
  process.exit(1);
}

if (!stores || stores.length === 0) {
  console.log('[geocode] No hay tiendas que geocodificar con esos filtros.');
  process.exit(0);
}

console.log(
  `[geocode] ${apply ? 'APPLY' : 'DRY-RUN'} sobre ${stores.length} tienda(s). ` +
    'Pidiendo coords a Google Geocoding API…\n',
);

const results = [];
for (const s of stores) {
  try {
    const g = await googleGeocode(s.address);
    const dist = Math.round(haversineMeters({ lat: s.lat, lng: s.lng }, g));
    const flagDist = dist > 5000 ? '⚠️ ' : dist > 1000 ? '· ' : '✓ ';
    console.log(
      `${flagDist}${s.code.padEnd(10)} ${s.name.padEnd(28).slice(0, 28)}  ` +
        `${dist.toString().padStart(6)}m  ${g.locationType.padEnd(20)} ` +
        `(${g.lat.toFixed(6)}, ${g.lng.toFixed(6)})`,
    );
    results.push({ store: s, geo: g, dist });
  } catch (err) {
    console.error(`✗ ${s.code} FALLÓ: ${err.message}`);
    results.push({ store: s, error: err.message });
  }
  // Google rate limit: 50 req/s gratis, ponemos 100ms entre pedidos por seguridad.
  await new Promise((r) => setTimeout(r, 100));
}

const ok = results.filter((r) => !r.error);
const failed = results.filter((r) => r.error);
const big = ok.filter((r) => r.dist > 5000);

console.log(`\n[geocode] OK: ${ok.length}/${stores.length}. Fallaron: ${failed.length}. Delta >5km: ${big.length}.`);

if (big.length > 0) {
  console.log('\n⚠️  Tiendas con delta >5km — REVISAR antes de aplicar:');
  for (const r of big) {
    console.log(`   ${r.store.code} → ${r.geo.formattedAddress}`);
  }
}

if (!apply) {
  console.log('\n[geocode] Dry-run. Re-ejecuta con --apply para escribir en BD.');
  process.exit(0);
}

if (big.length > 0) {
  console.log('\n[geocode] ⚠️ Hay tiendas con delta >5km. NO se aplican automáticamente.');
  console.log('         Revisa, ajusta dirección en BD, y re-corre el script con --code=XXX --apply.');
  // No abortamos completo: aplicamos las que sean delta razonable, skip las grandes.
}

console.log('\n[geocode] Aplicando UPDATE en BD…');
let applied = 0;
for (const r of ok) {
  if (r.dist > 5000) {
    console.log(`   skip ${r.store.code} (delta ${r.dist}m demasiado grande)`);
    continue;
  }
  try {
    await updateStore(r.store.id, {
      lat: r.geo.lat,
      lng: r.geo.lng,
      coord_verified: true,
    });
    console.log(`   ✓ ${r.store.code} actualizada (Δ ${r.dist}m)`);
    applied++;
  } catch (updErr) {
    console.error(`   ✗ ${r.store.code} UPDATE falló: ${updErr.message}`);
  }
}

console.log(`\n[geocode] Listo. ${applied}/${ok.length} tiendas actualizadas y marcadas verified=true.`);
