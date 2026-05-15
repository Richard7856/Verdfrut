'use server';

// Server actions del flow "subir Excel → preview en mapa → importar".
// ADR pendiente / Stream UI-1 / 2026-05-15 noche (pre-demo VerdFrut).
//
// Flujo:
//   1. parseAndGeocodeXlsx(formData): parsea XLSX + geocodifica cada row con Google.
//   2. searchPlaceAlternatives(query): para corregir filas dudosas/fallidas.
//   3. bulkImportStores(rows): persiste a BD con bulk_create_stores logic.
//
// NO depende del orchestrator AI — es feature directa.

import ExcelJS from 'exceljs';
import { revalidatePath } from 'next/cache';
import { logger } from '@tripdrive/observability';
import { requireRole } from '@/lib/auth';
import { createServerClient } from '@tripdrive/supabase/server';

// Tipo de retorno propio (el ActionResult global no es genérico).
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}

export type GeocodeQuality = 'rooftop' | 'range_interpolated' | 'geometric_center' | 'approximate' | 'none';

export interface ImportRow {
  /** Índice estable de la fila (para selección/edición desde el UI). */
  rowIdx: number;
  /** Nombre original del XLSX. */
  rawName: string;
  /** Dirección original del XLSX. */
  rawAddress: string;
  /** Código auto-generado o pasado en el XLSX. */
  code: string;
  /** Resultado del geocoding (null si falló). */
  geocoded: {
    formatted_address: string;
    lat: number;
    lng: number;
    place_id: string;
    quality: GeocodeQuality;
  } | null;
  /** Razón si geocoded=null (ZERO_RESULTS, error, etc.). */
  geocodeError: string | null;
}

export interface ParseAndGeocodeResult {
  rows: ImportRow[];
  stats: { total: number; ok: number; doubtful: number; failed: number };
  zonesAvailable: Array<{ id: string; name: string }>;
}

// Quality categorization: lo que Google llama location_type → status traffic light.
function categorizeQuality(locationType: string): { quality: GeocodeQuality; tier: 'ok' | 'doubtful' } {
  const lt = (locationType ?? '').toUpperCase();
  if (lt === 'ROOFTOP') return { quality: 'rooftop', tier: 'ok' };
  if (lt === 'RANGE_INTERPOLATED') return { quality: 'range_interpolated', tier: 'ok' };
  if (lt === 'GEOMETRIC_CENTER') return { quality: 'geometric_center', tier: 'doubtful' };
  if (lt === 'APPROXIMATE') return { quality: 'approximate', tier: 'doubtful' };
  return { quality: 'none', tier: 'doubtful' };
}

type GeocodeOk = NonNullable<ImportRow['geocoded']>;

async function geocodeOne(
  address: string,
  apiKey: string,
): Promise<GeocodeOk | { error: string }> {
  const params = new URLSearchParams({
    address,
    components: 'country:mx',
    key: apiKey,
  });
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const data = (await res.json()) as {
      status: string;
      results?: Array<{
        formatted_address: string;
        geometry: { location: { lat: number; lng: number }; location_type: string };
        place_id: string;
      }>;
      error_message?: string;
    };
    if (data.status === 'OK' && data.results && data.results.length > 0) {
      const r = data.results[0]!;
      const { quality } = categorizeQuality(r.geometry.location_type);
      return {
        formatted_address: r.formatted_address,
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        place_id: r.place_id,
        quality,
      };
    }
    if (data.status === 'ZERO_RESULTS') return { error: 'No se encontraron resultados.' };
    return { error: data.error_message ?? `Google status: ${data.status}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'fetch falló' };
  }
}

/**
 * Parsea un XLSX subido y geocodifica cada fila en paralelo (con cap).
 * Devuelve estructura lista para que el cliente renderice.
 */
export async function parseAndGeocodeXlsx(formData: FormData): Promise<
  Result<ParseAndGeocodeResult>
> {
  await requireRole('admin', 'dispatcher');

  return wrap(async () => {
    const file = formData.get('file');
    if (!(file instanceof Blob)) {
      throw new Error('No se recibió archivo válido.');
    }
    const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_GEOCODING_API_KEY no configurada en el servidor.');
    }

    // Parse XLSX.
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('XLSX sin hojas.');

    // Detectar headers desde la primera fila.
    const headerRow = sheet.getRow(1);
    const headers: Record<string, number> = {};
    headerRow.eachCell((cell, col) => {
      const key = String(cell.value ?? '').trim().toLowerCase();
      headers[key] = col;
    });
    const nameCol = headers['name'] ?? headers['nombre'] ?? headers['tienda'];
    const addressCol = headers['address'] ?? headers['direccion'] ?? headers['dirección'];
    const codeCol = headers['code'] ?? headers['codigo'] ?? headers['código'];
    if (!nameCol || !addressCol) {
      throw new Error(
        'XLSX requiere columnas "name" y "address" (también acepta "nombre" + "direccion"). Headers detectados: ' +
          Object.keys(headers).join(', '),
      );
    }

    // Extraer filas.
    const rawRows: Array<{ name: string; address: string; code: string; rowIdx: number }> = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const name = String(row.getCell(nameCol).value ?? '').trim();
      const address = String(row.getCell(addressCol).value ?? '').trim();
      if (!name && !address) continue; // fila vacía
      const code = codeCol
        ? String(row.getCell(codeCol).value ?? '').trim().toUpperCase()
        : `IMP-${r - 1}`;
      rawRows.push({ name, address, code: code || `IMP-${r - 1}`, rowIdx: r });
    }

    if (rawRows.length === 0) {
      throw new Error('XLSX sin filas con datos.');
    }
    if (rawRows.length > 100) {
      throw new Error(`XLSX tiene ${rawRows.length} filas; máximo 100 por batch.`);
    }

    // Geocode en paralelo con cap (Google rate-limita ~50 RPS; somos conservadores con 10 paralelas).
    const CHUNK = 10;
    const results: ImportRow[] = [];
    for (let i = 0; i < rawRows.length; i += CHUNK) {
      const chunk = rawRows.slice(i, i + CHUNK);
      const chunkResults = await Promise.all(
        chunk.map(async (raw): Promise<ImportRow> => {
          if (!raw.address) {
            return {
              rowIdx: raw.rowIdx,
              rawName: raw.name,
              rawAddress: '',
              code: raw.code,
              geocoded: null,
              geocodeError: 'Sin dirección en el XLSX.',
            };
          }
          const geo = await geocodeOne(raw.address, apiKey);
          if ('error' in geo) {
            return {
              rowIdx: raw.rowIdx,
              rawName: raw.name,
              rawAddress: raw.address,
              code: raw.code,
              geocoded: null,
              geocodeError: geo.error,
            };
          }
          return {
            rowIdx: raw.rowIdx,
            rawName: raw.name,
            rawAddress: raw.address,
            code: raw.code,
            geocoded: geo,
            geocodeError: null,
          };
        }),
      );
      results.push(...chunkResults);
    }

    // Stats por tier.
    let okCount = 0;
    let doubtfulCount = 0;
    let failedCount = 0;
    for (const r of results) {
      if (!r.geocoded) failedCount++;
      else if (['rooftop', 'range_interpolated'].includes(r.geocoded.quality)) okCount++;
      else doubtfulCount++;
    }

    // Zonas disponibles para que el UI permita seleccionar destino.
    // RLS filtra por customer_id automáticamente via la sesión del user.
    const supabase = await createServerClient();
    const { data: zones } = await supabase
      .from('zones')
      .select('id, name')
      .order('name');

    logger.info('stores.import.parse_and_geocode', {
      total: results.length,
      ok: okCount,
      doubtful: doubtfulCount,
      failed: failedCount,
    });

    return {
      rows: results,
      stats: { total: results.length, ok: okCount, doubtful: doubtfulCount, failed: failedCount },
      zonesAvailable: (zones ?? []).map((z) => ({ id: z.id as string, name: z.name as string })),
    };
  });
}

// ─────────────────────────────────────────────────────────────────
// searchPlaceAlternatives — para corregir filas dudosas/fallidas
// ─────────────────────────────────────────────────────────────────

export interface PlaceAlternative {
  name: string;
  formatted_address: string;
  lat: number;
  lng: number;
  place_id: string;
}

export async function searchPlaceAlternatives(query: string): Promise<Result<PlaceAlternative[]>> {
  await requireRole('admin', 'dispatcher');

  return wrap(async () => {
    const q = query.trim();
    if (q.length < 3) throw new Error('Query mínima 3 chars.');

    const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_GEOCODING_API_KEY no configurada.');

    // Google Places Text Search — devuelve hasta 20 resultados con coords y place_id.
    const params = new URLSearchParams({
      query: q,
      region: 'mx',
      key: apiKey,
    });
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const data = (await res.json()) as {
      status: string;
      results?: Array<{
        name: string;
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
        place_id: string;
      }>;
      error_message?: string;
    };
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(data.error_message ?? `Google Places status: ${data.status}`);
    }
    return (data.results ?? []).slice(0, 5).map((r) => ({
      name: r.name,
      formatted_address: r.formatted_address,
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      place_id: r.place_id,
    }));
  });
}

// ─────────────────────────────────────────────────────────────────
// bulkImportStores — persiste filas seleccionadas a la tabla stores
// ─────────────────────────────────────────────────────────────────

export interface ImportStoreInput {
  code: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  zone_id: string;
}

export interface BulkImportResult {
  created: number;
  skipped_duplicates: number;
  failed: Array<{ code: string; reason: string }>;
  created_codes: string[];
}

export async function bulkImportStores(
  stores: ImportStoreInput[],
): Promise<Result<BulkImportResult>> {
  await requireRole('admin', 'dispatcher');

  return wrap(async () => {
    if (!Array.isArray(stores) || stores.length === 0) {
      throw new Error('Lista vacía.');
    }
    if (stores.length > 100) {
      throw new Error('Máx 100 tiendas por batch.');
    }

    const supabase = await createServerClient();

    // Validar zonas pertenecen al customer (RLS via user session).
    const zoneIds = [...new Set(stores.map((s) => s.zone_id))];
    const { data: zones } = await supabase
      .from('zones')
      .select('id')
      .in('id', zoneIds);
    const validZoneIds = new Set((zones ?? []).map((z) => z.id as string));

    const failed: BulkImportResult['failed'] = [];
    const validRows: ImportStoreInput[] = [];
    for (const s of stores) {
      if (!validZoneIds.has(s.zone_id)) {
        failed.push({ code: s.code, reason: 'zone_id no pertenece al customer.' });
        continue;
      }
      if (!/^[A-Z0-9-]{2,30}$/.test(s.code)) {
        failed.push({ code: s.code, reason: 'code inválido (2-30 alfanumérico+guión).' });
        continue;
      }
      if (s.name.length < 2 || s.name.length > 100) {
        failed.push({ code: s.code, reason: 'name 2-100 chars.' });
        continue;
      }
      validRows.push(s);
    }

    if (validRows.length === 0) {
      throw new Error(`Ninguna fila válida. Fallos: ${failed.length}.`);
    }

    // Detectar duplicados por code (skipea, no sobreescribe). RLS filtra.
    const codes = validRows.map((s) => s.code);
    const { data: existing } = await supabase
      .from('stores')
      .select('code')
      .in('code', codes);
    const existingCodes = new Set((existing ?? []).map((s) => s.code as string));
    const toInsert = validRows.filter((s) => !existingCodes.has(s.code));
    const skippedDuplicates = validRows.length - toInsert.length;

    if (toInsert.length === 0) {
      return {
        created: 0,
        skipped_duplicates: skippedDuplicates,
        failed,
        created_codes: [],
      };
    }

    // customer_id lo setea el trigger auto_set_customer_id (mig 037).
    const { error } = await supabase.from('stores').insert(
      toInsert.map((s) => ({
        code: s.code,
        name: s.name,
        address: s.address,
        lat: s.lat,
        lng: s.lng,
        zone_id: s.zone_id,
        // Defaults razonables (mismos que bulk_create_stores).
        service_time_seconds: 300,
        demand: [100, 1, 5],
        coord_verified: true, // el user confirmó visualmente
        is_active: true,
      })) as never,
    );

    if (error) {
      throw new Error(`Insert falló: ${error.message}`);
    }

    revalidatePath('/settings/stores');

    logger.info('stores.import.bulk_done', {
      created: toInsert.length,
      skipped: skippedDuplicates,
      failed: failed.length,
    });

    return {
      created: toInsert.length,
      skipped_duplicates: skippedDuplicates,
      failed,
      created_codes: toInsert.map((s) => s.code),
    };
  });
}
