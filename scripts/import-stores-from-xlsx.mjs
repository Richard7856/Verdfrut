#!/usr/bin/env node
// Importador one-shot de tiendas desde el XLSX de expansión 2026-05.
//
// Flujo:
//   1. Lee el XLSX (usando openpyxl via subprocess Python — simple y robusto).
//   2. Para cada fila, construye una query Google: "Tienda Neto <NOMBRE> <ZONA>
//      CDMX, México" y consulta la Geocoding API.
//   3. Imprime tabla con CODE | TIENDA | ZONA | query | lat,lng | confianza.
//   4. En --apply, hace INSERT en stores con coord_verified=false
//      (las coords vienen de Geocoding, NO de catastro oficial — el cliente
//      debe verificarlas en la UI o re-geocodificar con `geocode-stores.mjs`).
//
// Uso:
//   node scripts/import-stores-from-xlsx.mjs             # dry-run, ve resultados
//   node scripts/import-stores-from-xlsx.mjs --apply     # commit INSERTs
//
// Env vars: igual que geocode-stores.mjs (lee .env.local de platform).

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

function loadDotenv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key]) continue;
    let val = raw.trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadDotenv(path.join(ROOT, 'apps/platform/.env.local'));
loadDotenv(path.join(ROOT, 'apps/platform/.env'));

const GOOGLE_KEY = process.env.GOOGLE_GEOCODING_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GOOGLE_KEY) { console.error('FALTA GOOGLE_GEOCODING_API_KEY'); process.exit(1); }
if (!SUPABASE_URL || !SERVICE_ROLE) { console.error('FALTA SUPABASE creds'); process.exit(1); }

const XLSX_PATH = '/Users/richardfigueroa/Downloads/Tiendas Verdefrut expansion 30.04 posible.xlsx';
const apply = process.argv.includes('--apply');

// Zone CDMX y depot CEDA (target para todas las tiendas — son del CEDIS Chalco
// pero la zona operativa actual es CDMX). Sacados de la BD al 2026-05-11.
const ZONE_ID_CDMX = '50b842b4-b00d-41db-ac1c-fea0f052cbec';

// CDMX bbox para sanity check post-geocoding (más amplio para incluir Edomex).
// Si la coord cae fuera, marcar la fila como sospechosa.
const BBOX = { latMin: 19.0, latMax: 19.8, lngMin: -99.5, lngMax: -98.8 };

// ---------------------------------------------------------------------------
// Leer XLSX vía Python (sin agregar dependencia npm).
// ---------------------------------------------------------------------------
function readXlsx() {
  const py = `
import openpyxl, json
wb = openpyxl.load_workbook('${XLSX_PATH}', data_only=True)
sh = wb['Hoja1']
rows = list(sh.iter_rows(values_only=True))
data = []
for r in rows[1:]:
    if r[3] is None: continue
    data.append({
      'cedis': r[0], 'region': r[1], 'zona_neto': r[2],
      'id': int(r[3]), 'tienda': r[4], 'encargado': r[5],
    })
print(json.dumps(data, ensure_ascii=False))
`;
  const out = execSync(`python3 -c "${py.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });
  return JSON.parse(out);
}

// ---------------------------------------------------------------------------
// Google Geocoding
// ---------------------------------------------------------------------------
async function googleGeocode(address) {
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?' +
    new URLSearchParams({
      address,
      components: 'country:MX|administrative_area:Ciudad de México|administrative_area:Estado de México',
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
      locationType: r.geometry.location_type,
      placeId: r.place_id,
    };
  }
  return null;
}

// Title case suave: "AV CAFETALES" → "Av Cafetales".
function titleCase(s) {
  return String(s)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function inBbox(lat, lng) {
  return lat >= BBOX.latMin && lat <= BBOX.latMax && lng >= BBOX.lngMin && lng <= BBOX.lngMax;
}

// ---------------------------------------------------------------------------
// Supabase INSERT helpers
// ---------------------------------------------------------------------------
const REST_HEADERS = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
};

async function insertStore(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/stores`, {
    method: 'POST',
    headers: { ...REST_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
console.log(`[import] ${apply ? 'APPLY' : 'DRY-RUN'} — leyendo XLSX…`);
const rows = readXlsx();
console.log(`[import] ${rows.length} tiendas en el archivo.\n`);

const results = [];
for (const r of rows) {
  // Query estratégica: "Tienda Neto <nombre> <zona neto> CDMX, México".
  // El nombre Neto+ ayuda mucho — los nombres del XLSX son cortos y ambiguos
  // (CANTU, EJE 10, etc.) pero referencian sucursales Neto reales.
  const query = `Tienda Neto ${r.tienda}, ${r.zona_neto}, Ciudad de México, México`;
  let g = null;
  try {
    g = await googleGeocode(query);
  } catch (err) {
    console.error(`✗ ${r.id} (${r.tienda}) fetch falló: ${err.message}`);
  }
  // Si no hubo match, reintentar sin "Tienda Neto" — a veces la query muy específica falla.
  if (!g) {
    const fallback = `${r.tienda}, ${r.zona_neto}, Ciudad de México, México`;
    try {
      g = await googleGeocode(fallback);
    } catch (err) {
      console.error(`✗ ${r.id} (${r.tienda}) fallback falló: ${err.message}`);
    }
  }

  if (!g) {
    results.push({ row: r, error: 'sin resultados' });
    console.log(`  ${String(r.id).padEnd(6)} ${r.tienda.padEnd(28).slice(0, 28)}  ✗ sin resultados`);
  } else {
    const okBbox = inBbox(g.lat, g.lng);
    const flag = !okBbox ? '⚠️ ' : g.locationType === 'ROOFTOP' ? '✓ ' : '· ';
    results.push({ row: r, geo: g, inBbox: okBbox });
    console.log(
      `${flag} ${String(r.id).padEnd(6)} ${r.tienda.padEnd(28).slice(0, 28)}  ` +
        `${g.lat.toFixed(5)},${g.lng.toFixed(5)}  ${g.locationType.padEnd(20)} ` +
        `${okBbox ? '' : 'FUERA BBOX '}${g.formattedAddress}`,
    );
  }
  await new Promise((res) => setTimeout(res, 100));
}

const ok = results.filter((r) => r.geo);
const failed = results.filter((r) => !r.geo);
const outOfBbox = ok.filter((r) => !r.inBbox);

console.log(`\n[import] OK: ${ok.length}/${rows.length}. Fallaron: ${failed.length}. Fuera de bbox CDMX/Edomex: ${outOfBbox.length}.`);

if (failed.length > 0) {
  console.log('\nFallaron (necesitan dirección manual):');
  for (const f of failed) console.log(`  ${f.row.id} — ${f.row.tienda} (zona Neto: ${f.row.zona_neto})`);
}

if (!apply) {
  console.log('\n[import] Dry-run. Revisa la lista. Re-ejecuta con --apply para INSERT en BD.');
  console.log('[import] Las tiendas se insertarán con coord_verified=false (geocoding, no ground truth).');
  process.exit(0);
}

console.log('\n[import] Aplicando INSERT en BD…');
let applied = 0;
for (const r of ok) {
  // Las fuera-de-bbox las skip — probable mal-geocoding (otra ciudad / país).
  if (!r.inBbox) {
    console.log(`  skip ${r.row.id} — fuera de bbox (${r.geo.formattedAddress})`);
    continue;
  }
  const code = `CDMX-${r.row.id}`;
  const name = titleCase(r.row.tienda);
  const address = r.geo.formattedAddress;
  try {
    await insertStore({
      code,
      name,
      address,
      lat: r.geo.lat,
      lng: r.geo.lng,
      zone_id: ZONE_ID_CDMX,
      coord_verified: false, // geocoding, requiere validación cliente.
      // service_time_seconds y demand caen al default (1800s, [100,1,5]).
      contact_name: r.row.encargado && r.row.encargado !== 'POR CONFIRMAR UBICACIÓN' && r.row.encargado !== 'VACANTE'
        ? r.row.encargado
        : null,
      is_active: true,
    });
    console.log(`  ✓ ${code.padEnd(10)} ${name}`);
    applied++;
  } catch (err) {
    console.error(`  ✗ ${code} INSERT falló: ${err.message}`);
  }
}

console.log(`\n[import] Listo. ${applied}/${ok.length} tiendas insertadas.`);
console.log('[import] coord_verified=false — el cliente debe validar coords en /stores o re-correr');
console.log('         scripts/geocode-stores.mjs --apply para refinar contra direcciones oficiales.');
