#!/usr/bin/env node
// Importador v2: Google Places Text Search (no Geocoding API) con bias geográfico.
//
// Diferencia vs v1 (import-stores-from-xlsx.mjs):
//   - Geocoding API es para direcciones — devuelve centroides cuando la query
//     es vaga, lo cual fue catastrófico para nombres como "CANTU" o "EJE 10".
//   - Places Text Search es para POIs (puntos de interés / negocios). Devuelve
//     la sucursal Neto real si existe en Maps. Con bias geográfico (CDMX +
//     50km), evitamos saltar a Zacatecas.
//   - Si Places no responde con confidence aceptable, fallback a Geocoding.
//
// Estrategias de query (en orden):
//   1. "Tienda Neto <nombre>" cerca de centroide zona Neto (si la conocemos)
//   2. "Neto <nombre> <zona Neto>"
//   3. Geocoding API con la query original (fallback)
//
// Uso:
//   node scripts/import-stores-v2-places.mjs           # dry-run
//   node scripts/import-stores-v2-places.mjs --apply   # commit INSERTs

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
const ZONE_ID_CDMX = '50b842b4-b00d-41db-ac1c-fea0f052cbec';

// Bbox amplio CDMX + Edomex valle (cubre Chalco, Texcoco, Ixtapaluca, etc).
const BBOX = { latMin: 19.0, latMax: 19.8, lngMin: -99.5, lngMax: -98.6 };

// Centroides aproximados por zona Neto del XLSX (sacados de Maps).
// Si la zona no está aquí, usamos centro CDMX como bias default.
const ZONE_HINTS = {
  TULYEHUALCO: { lat: 19.249, lng: -99.029 },
  TLALPAN: { lat: 19.293, lng: -99.166 },
  'XOCHIMILCO CENTRO': { lat: 19.257, lng: -99.103 },
  'COYOACAN 2': { lat: 19.347, lng: -99.158 },
  'IZTAPALAPA 2': { lat: 19.358, lng: -99.083 },
  AMECAMECA: { lat: 19.122, lng: -98.766 },
  PLUS: { lat: 19.378, lng: -99.158 },
  CUAUHTEMOC: { lat: 19.435, lng: -99.150 },
  'AYOTLA IXTALUCA': { lat: 19.299, lng: -98.892 }, // Ayotla / Ixtapaluca
  CHICOLOAPAN: { lat: 19.413, lng: -98.901 },
  'LOS REYES': { lat: 19.367, lng: -98.965 }, // Los Reyes La Paz
  NEZA: { lat: 19.413, lng: -99.013 }, // Nezahualcóyotl
  CHIMALHUACAN: { lat: 19.428, lng: -98.952 },
  'LA PAZ NEZA': { lat: 19.350, lng: -98.962 },
  'NEZA ORIENTE': { lat: 19.387, lng: -98.992 },
  'SANTA BARBARA IXTAPALUCA': { lat: 19.305, lng: -98.876 },
  COCOTITLAN: { lat: 19.231, lng: -98.866 },
  'TLAHUAC 2': { lat: 19.286, lng: -99.000 },
  VALLE: { lat: 19.4, lng: -99.1 }, // genérico
  'METRO SUR': { lat: 19.3, lng: -99.1 },
};

const DEFAULT_CENTROID = { lat: 19.4326, lng: -99.1332 }; // CDMX centro

// Overrides manuales del user (5 casos donde Places eligió una sucursal con ID
// distinto al XLSX o cuya zona no coincidía). Estas coords se aceptan como
// ground truth → `coord_verified=true`.
const MANUAL_OVERRIDES = {
  288: { lat: 19.4902, lng: -99.0925, address: 'Neto San Felipe de Jesús — Av. Aztecas 2828, Col. Las Cruces, GAM, Ciudad de México' },
  1680: { lat: 19.3535, lng: -99.0760, address: 'Neto Aldama — Calle Aldama 86, Barrio San Pablo, Iztapalapa, Ciudad de México' },
  139: { lat: 19.3810, lng: -98.9570, address: 'Neto Cantú — Av. Pantitlán, Ancón de los Reyes, La Paz, Estado de México' },
  3698: { lat: 19.4120, lng: -98.9900, address: 'Av. Texcoco, Neza Oriente, Estado de México' },
  832: { lat: 19.383352, lng: -98.952605, address: 'San Sebastián Chimalpa, Los Reyes La Paz, Estado de México' },
};

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
// Google Places Text Search (POI search).
// Doc: https://developers.google.com/maps/documentation/places/web-service/search-text
// ---------------------------------------------------------------------------
async function placesTextSearch(query, center, radiusMeters = 15000) {
  const params = new URLSearchParams({
    query,
    location: `${center.lat},${center.lng}`,
    radius: String(radiusMeters),
    region: 'mx',
    key: GOOGLE_KEY,
  });
  const url = 'https://maps.googleapis.com/maps/api/place/textsearch/json?' + params;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === 'OK' && data.results?.length > 0) {
    const r = data.results[0];
    return {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      formattedAddress: r.formatted_address,
      placeId: r.place_id,
      name: r.name,
      // Si Places devuelve el negocio, lo sabemos cuando "Neto" aparece en name o address
      // o tiene type 'supermarket'/'grocery_or_supermarket'/'store'.
      types: r.types ?? [],
      candidatesCount: data.results.length,
    };
  }
  return null;
}

// Fallback Geocoding
async function geocodingFallback(address) {
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?' +
    new URLSearchParams({ address, components: 'country:MX', key: GOOGLE_KEY });
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

function titleCase(s) {
  return String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function inBbox(lat, lng) {
  return lat >= BBOX.latMin && lat <= BBOX.latMax && lng >= BBOX.lngMin && lng <= BBOX.lngMax;
}

// Heurística: ¿Places devolvió una sucursal "Neto" real?
function isNetoMatch(placesResult) {
  if (!placesResult) return false;
  const n = (placesResult.name ?? '').toLowerCase();
  const a = (placesResult.formattedAddress ?? '').toLowerCase();
  return n.includes('neto') || a.includes('tiendas neto') || n.includes('tienda neto');
}

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
console.log(`[v2] ${apply ? 'APPLY' : 'DRY-RUN'} — leyendo XLSX…`);
const rows = readXlsx();
console.log(`[v2] ${rows.length} tiendas. Usando Places Text Search con bias por zona Neto.\n`);

const results = [];
for (const r of rows) {
  // Si hay override manual, saltarse Places y aceptar coords del user como ground truth.
  if (MANUAL_OVERRIDES[r.id]) {
    const ov = MANUAL_OVERRIDES[r.id];
    results.push({
      row: r,
      geo: { lat: ov.lat, lng: ov.lng, formattedAddress: ov.address, name: null, types: [] },
      source: 'ManualOverride',
      netoConfirmed: true,
      manualOverride: true,
    });
    console.log(`★★ ${String(r.id).padEnd(6)} ${r.tienda.padEnd(28).slice(0, 28)}  ${ov.lat.toFixed(5)},${ov.lng.toFixed(5)}  ManualOverride (verified)            ${ov.address}`);
    continue;
  }

  const center = ZONE_HINTS[r.zona_neto] ?? DEFAULT_CENTROID;

  // Estrategia: 3 intentos en orden, paramos en el primer match útil.
  const queries = [
    `Tienda Neto ${r.tienda}`,
    `Neto ${r.tienda} ${r.zona_neto}`,
    `tiendas neto ${r.zona_neto} ${r.tienda}`,
  ];

  let best = null;
  let bestSource = null;
  for (const q of queries) {
    try {
      const p = await placesTextSearch(q, center, 12000);
      if (p && inBbox(p.lat, p.lng)) {
        if (isNetoMatch(p)) {
          best = p;
          bestSource = `Places+Neto[${q}]`;
          break; // match confiable, paramos
        }
        // Match dentro de bbox pero no claramente Neto — guardamos como tentativo
        if (!best) {
          best = p;
          bestSource = `Places[${q}]`;
        }
      }
    } catch (err) {
      // continuar al siguiente intento
    }
    await new Promise((res) => setTimeout(res, 80));
  }

  // Fallback final: Geocoding API con la query enriquecida.
  if (!best) {
    try {
      const g = await geocodingFallback(`Tienda Neto ${r.tienda}, ${r.zona_neto}, México`);
      if (g && inBbox(g.lat, g.lng)) {
        best = { ...g, name: null, types: [], candidatesCount: 1 };
        bestSource = 'GeocodingFallback';
      }
    } catch {}
  }

  if (!best) {
    results.push({ row: r, error: 'sin resultados útiles dentro del bbox' });
    console.log(`  ✗ ${String(r.id).padEnd(6)} ${r.tienda.padEnd(28).slice(0, 28)}  sin match`);
  } else {
    const netoConfirmed = isNetoMatch(best);
    const flag = netoConfirmed ? '★ ' : '· ';
    results.push({ row: r, geo: best, source: bestSource, netoConfirmed });
    console.log(
      `${flag} ${String(r.id).padEnd(6)} ${r.tienda.padEnd(28).slice(0, 28)}  ` +
        `${best.lat.toFixed(5)},${best.lng.toFixed(5)}  ${bestSource.padEnd(28)} ${best.name ? `"${best.name}" — ` : ''}${best.formattedAddress}`,
    );
  }
  await new Promise((res) => setTimeout(res, 100));
}

const ok = results.filter((r) => r.geo);
const failed = results.filter((r) => !r.geo);
const netoConfirmed = ok.filter((r) => r.netoConfirmed);

console.log(`\n[v2] Total: ${rows.length}. Con coords: ${ok.length}. Fallos: ${failed.length}. Confirmados como sucursal Neto: ${netoConfirmed.length}.`);

if (failed.length > 0) {
  console.log('\nSin match útil:');
  for (const f of failed) console.log(`  ${f.row.id} — ${f.row.tienda} (${f.row.zona_neto})`);
}

if (!apply) {
  console.log('\n[v2] Dry-run. Re-ejecuta con --apply para INSERT (coord_verified=false).');
  process.exit(0);
}

// Detectar alta-confianza: el nombre del POI Places contiene el ID exacto del XLSX.
// Ej: "Neto Saltillo 6684" + XLSX id 6684 → verified=true.
//     "Tiendas Neto" o "Neto Saltillo" sin ID → verified=false.
function isHighConfidence(r) {
  if (r.manualOverride) return true;
  const placesName = r.geo?.name ?? '';
  const ids = placesName.match(/\b(\d{3,5})\b/g) ?? [];
  return ids.includes(String(r.row.id));
}

console.log('\n[v2] Aplicando INSERTs…');
let applied = 0;
for (const r of ok) {
  const code = `CDMX-${r.row.id}`;
  const name = titleCase(r.row.tienda);
  const address = r.geo.formattedAddress;
  const verified = isHighConfidence(r);
  try {
    await insertStore({
      code,
      name,
      address,
      lat: r.geo.lat,
      lng: r.geo.lng,
      zone_id: ZONE_ID_CDMX,
      coord_verified: verified,
      contact_name:
        r.row.encargado && !['POR CONFIRMAR UBICACIÓN', 'VACANTE'].includes(r.row.encargado)
          ? r.row.encargado
          : null,
      is_active: true,
    });
    console.log(`  ✓ ${code.padEnd(10)} ${name}${verified ? ' (verified)' : ''}`);
    applied++;
  } catch (err) {
    console.error(`  ✗ ${code} INSERT falló: ${err.message}`);
  }
}
console.log(`\n[v2] ${applied}/${ok.length} insertadas.`);
