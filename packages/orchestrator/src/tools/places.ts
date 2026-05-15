// Tools de Google Maps Platform — geocoding + Places Text Search.
// Permite al agente:
//   - Resolver una dirección a lat/lng formales antes de crear una tienda.
//   - Buscar un negocio en Maps por nombre+zona (ej. "NETO Toluca centro").
//   - Crear stores con coords validadas conversacionalmente.
//
// Requiere env var GOOGLE_GEOCODING_API_KEY en el server (misma key que
// el script geocode-stores.mjs; ya está en .env.local del platform y debe
// estar en Vercel).

import type { ToolDefinition, ToolResult } from '../types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badArg<T = unknown>(field: string, msg: string): ToolResult<T> {
  return { ok: false, error: `Argumento inválido "${field}": ${msg}` };
}

function getGoogleKey(): string | null {
  return process.env.GOOGLE_GEOCODING_API_KEY ?? null;
}

// ============================================================================
// geocode_address
// ============================================================================
interface GeocodeArgs {
  address: string;
  region?: string;
}

interface GeocodeResult {
  formatted_address: string;
  lat: number;
  lng: number;
  location_type: string;
  place_id: string;
  components: Array<{ long_name: string; short_name: string; types: string[] }>;
}

const geocode_address: ToolDefinition<GeocodeArgs, GeocodeResult> = {
  name: 'geocode_address',
  description:
    'Convierte una dirección postal a coordenadas geográficas exactas usando Google Geocoding. Úsala antes de crear una tienda nueva — NO inventes lat/lng. Mejor calidad si la dirección incluye ciudad y estado (ej. "Av Constituyentes 1234, Toluca, Edomex").',
  is_write: false,
  requires_confirmation: false,
  input_schema: {
    type: 'object',
    properties: {
      address: {
        type: 'string',
        description: 'Dirección postal a geocodificar. Mínimo 5 caracteres.',
      },
      region: {
        type: 'string',
        description: 'Country code ISO (default "mx"). Limita la búsqueda a México.',
      },
    },
    required: ['address'],
  },
  handler: async (args): Promise<ToolResult<GeocodeResult>> => {
    const address = (args.address ?? '').trim();
    if (address.length < 5) return badArg('address', 'mínimo 5 chars.');

    const key = getGoogleKey();
    if (!key) {
      return {
        ok: false,
        error: 'GOOGLE_GEOCODING_API_KEY no configurada en el servidor.',
      };
    }

    const region = (args.region ?? 'mx').toLowerCase();
    const params = new URLSearchParams({
      address,
      components: `country:${region}`,
      key,
    });
    const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const data = (await res.json()) as {
        status: string;
        results?: Array<{
          formatted_address: string;
          geometry: {
            location: { lat: number; lng: number };
            location_type: string;
          };
          place_id: string;
          address_components: Array<{
            long_name: string;
            short_name: string;
            types: string[];
          }>;
        }>;
        error_message?: string;
      };

      if (data.status === 'ZERO_RESULTS') {
        return {
          ok: false,
          error: `Google no encontró resultados para "${address}". Verifica con el usuario el formato de la dirección.`,
        };
      }
      if (data.status !== 'OK' || !data.results?.[0]) {
        return {
          ok: false,
          error: `Geocoding falló: ${data.status} — ${data.error_message ?? 'sin detalle'}`,
        };
      }

      const r = data.results[0];
      return {
        ok: true,
        data: {
          formatted_address: r.formatted_address,
          lat: r.geometry.location.lat,
          lng: r.geometry.location.lng,
          location_type: r.geometry.location_type,
          place_id: r.place_id,
          components: r.address_components.map((c) => ({
            long_name: c.long_name,
            short_name: c.short_name,
            types: c.types,
          })),
        },
        summary:
          `Dirección resuelta: "${r.formatted_address}" (${r.geometry.location.lat.toFixed(5)}, ${r.geometry.location.lng.toFixed(5)}, precisión ${r.geometry.location_type}).`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Error al llamar Geocoding API.',
      };
    }
  },
};

// ============================================================================
// search_place
// ============================================================================
interface SearchPlaceArgs {
  query: string;
  near_lat?: number;
  near_lng?: number;
  radius_meters?: number;
}

interface PlaceCandidate {
  name: string;
  formatted_address: string;
  lat: number;
  lng: number;
  place_id: string;
  types: string[];
  rating?: number;
  user_ratings_total?: number;
}

const search_place: ToolDefinition<SearchPlaceArgs, PlaceCandidate[]> = {
  name: 'search_place',
  description:
    'Busca un lugar (negocio, tienda, dirección) en Google Maps por texto. Devuelve hasta 5 candidatos con coords y dirección formal. Más preciso que geocode_address cuando la búsqueda incluye nombre del negocio (ej. "NETO Toluca Independencia"). Si pasas near_lat/near_lng + radius, restringe a esa zona.',
  is_write: false,
  requires_confirmation: false,
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Texto a buscar (negocio + zona, dirección, etc.). Mínimo 3 chars.',
      },
      near_lat: {
        type: 'number',
        description: 'Latitud central para restringir búsqueda (opcional).',
      },
      near_lng: {
        type: 'number',
        description: 'Longitud central para restringir búsqueda (opcional).',
      },
      radius_meters: {
        type: 'integer',
        description: 'Radio en metros si pasas near_lat/lng. Default 15000 (15km). Max 50000.',
      },
    },
    required: ['query'],
  },
  handler: async (args): Promise<ToolResult<PlaceCandidate[]>> => {
    const query = (args.query ?? '').trim();
    if (query.length < 3) return badArg('query', 'mínimo 3 chars.');

    const key = getGoogleKey();
    if (!key) {
      return {
        ok: false,
        error: 'GOOGLE_GEOCODING_API_KEY no configurada en el servidor.',
      };
    }

    const params = new URLSearchParams({ query, region: 'mx', key });
    if (typeof args.near_lat === 'number' && typeof args.near_lng === 'number') {
      params.set('location', `${args.near_lat},${args.near_lng}`);
      params.set('radius', String(Math.min(args.radius_meters ?? 15_000, 50_000)));
    }
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const data = (await res.json()) as {
        status: string;
        results?: Array<{
          name: string;
          formatted_address: string;
          geometry: { location: { lat: number; lng: number } };
          place_id: string;
          types: string[];
          rating?: number;
          user_ratings_total?: number;
        }>;
        error_message?: string;
      };

      if (data.status === 'ZERO_RESULTS') {
        return {
          ok: true,
          data: [],
          summary: `Google no encontró lugares para "${query}". Probar con búsqueda más específica o usar geocode_address con la dirección.`,
        };
      }
      if (data.status !== 'OK' || !data.results) {
        return {
          ok: false,
          error: `Places Search falló: ${data.status} — ${data.error_message ?? 'sin detalle'}`,
        };
      }

      const candidates: PlaceCandidate[] = data.results.slice(0, 5).map((r) => ({
        name: r.name,
        formatted_address: r.formatted_address,
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        place_id: r.place_id,
        types: r.types,
        rating: r.rating,
        user_ratings_total: r.user_ratings_total,
      }));

      return {
        ok: true,
        data: candidates,
        summary:
          candidates.length === 0
            ? 'Sin candidatos.'
            : `${candidates.length} candidato(s). Top: "${candidates[0]!.name}" en ${candidates[0]!.formatted_address}.`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Error al llamar Places API.',
      };
    }
  },
};

// ============================================================================
// create_store
// ============================================================================
interface CreateStoreArgs {
  code: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  zone_id: string;
  contact_name?: string;
  contact_phone?: string;
  service_time_seconds?: number;
  receiving_window_start?: string;
  receiving_window_end?: string;
}

interface CreateStoreResult {
  store_id: string;
  code: string;
  name: string;
}

const create_store: ToolDefinition<CreateStoreArgs, CreateStoreResult> = {
  name: 'create_store',
  description:
    'Crea una tienda nueva en el catálogo. IMPORTANTE: las lat/lng deben venir de geocode_address o search_place previo — NUNCA inventarlas. El code debe ser único en el customer (ej. "TOL-1422"). Requiere confirmación porque las tiendas son catálogo persistente.',
  is_write: true,
  requires_confirmation: true,
  input_schema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Código único de la tienda. Convención: PREFIJO-NÚMERO (ej. "TOL-1422", "CDMX-0033").',
      },
      name: {
        type: 'string',
        description: 'Nombre comercial visible al chofer (ej. "NETO Independencia").',
      },
      address: {
        type: 'string',
        description: 'Dirección postal completa. Idealmente la `formatted_address` que devolvió Google.',
      },
      lat: {
        type: 'number',
        description: 'Latitud de Google Geocoding o Places (4-7 decimales típico).',
      },
      lng: {
        type: 'number',
        description: 'Longitud de Google Geocoding o Places.',
      },
      zone_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID de la zona operativa donde está la tienda.',
      },
      contact_name: {
        type: 'string',
        description: 'Encargado/contacto en la tienda (opcional).',
      },
      contact_phone: {
        type: 'string',
        description: 'Teléfono del contacto (opcional).',
      },
      service_time_seconds: {
        type: 'integer',
        description: 'Tiempo estimado de servicio en la tienda en segundos. Default 900 (15 min).',
      },
      receiving_window_start: {
        type: 'string',
        description: 'Hora inicio ventana recepción (HH:MM) opcional.',
      },
      receiving_window_end: {
        type: 'string',
        description: 'Hora fin ventana recepción (HH:MM) opcional.',
      },
    },
    required: ['code', 'name', 'address', 'lat', 'lng', 'zone_id'],
  },
  handler: async (args, ctx): Promise<ToolResult<CreateStoreResult>> => {
    const code = (args.code ?? '').toUpperCase().trim();
    if (!/^[A-Z0-9-]{2,30}$/.test(code)) {
      return badArg('code', '2-30 chars alfanum + guiones.');
    }
    const name = (args.name ?? '').trim();
    if (name.length < 2 || name.length > 100) return badArg('name', '2-100 chars.');
    const address = (args.address ?? '').trim();
    if (address.length < 5) return badArg('address', 'mínimo 5 chars.');
    if (typeof args.lat !== 'number' || args.lat < -90 || args.lat > 90) {
      return badArg('lat', 'debe ser número entre -90 y 90.');
    }
    if (typeof args.lng !== 'number' || args.lng < -180 || args.lng > 180) {
      return badArg('lng', 'debe ser número entre -180 y 180.');
    }
    if (!UUID_RE.test(args.zone_id)) return badArg('zone_id', 'UUID inválido.');

    // Validar zone pertenece al customer.
    const { data: zone } = await ctx.supabase
      .from('zones')
      .select('id')
      .eq('id', args.zone_id)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();
    if (!zone) return { ok: false, error: 'Zona no pertenece a tu organización.' };

    // Time validation.
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (args.receiving_window_start && !timeRe.test(args.receiving_window_start)) {
      return badArg('receiving_window_start', 'formato HH:MM.');
    }
    if (args.receiving_window_end && !timeRe.test(args.receiving_window_end)) {
      return badArg('receiving_window_end', 'formato HH:MM.');
    }

    const { data, error } = await ctx.supabase
      .from('stores')
      .insert({
        code,
        name,
        address,
        lat: args.lat,
        lng: args.lng,
        zone_id: args.zone_id,
        customer_id: ctx.customerId,
        contact_name: args.contact_name ?? null,
        contact_phone: args.contact_phone ?? null,
        service_time_seconds: args.service_time_seconds ?? 900,
        receiving_window_start: args.receiving_window_start ?? null,
        receiving_window_end: args.receiving_window_end ?? null,
        coord_verified: true,
        is_active: true,
      })
      .select('id, code, name')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { ok: false, error: `Ya existe una tienda con código "${code}".` };
      }
      return { ok: false, error: `Error de BD: ${error.message}` };
    }

    return {
      ok: true,
      data: {
        store_id: data.id as string,
        code: data.code as string,
        name: data.name as string,
      },
      summary: `Tienda "${code}" creada en ${address}.`,
    };
  },
};

// ============================================================================
// update_store — editar una tienda existente (Phase 2 / 2026-05-15)
// ============================================================================

interface UpdateStoreArgs {
  store_id: string;
  // Todos opcionales — la tool acepta un subset (PATCH semantics).
  code?: string;
  name?: string;
  zone_id?: string;
  address?: string;
  lat?: number;
  lng?: number;
  contact_name?: string | null;
  contact_phone?: string | null;
  receiving_window_start?: string | null;
  receiving_window_end?: string | null;
  service_time_seconds?: number;
  is_active?: boolean;
}

interface UpdateStoreResult {
  store_id: string;
  code: string;
  name: string;
  updated_fields: string[];
}

const update_store: ToolDefinition<UpdateStoreArgs, UpdateStoreResult> = {
  name: 'update_store',
  description:
    'Actualiza campos de una tienda existente. Solo pasa los campos a cambiar (PATCH semantics). Casos comunes: corregir dirección, cambiar nombre, marcar inactiva, cambiar zona, ajustar ventana de recepción. Si cambias lat/lng, deben venir de geocode_address o search_place — NUNCA inventarlas. Cambiar zone_id puede afectar tiros futuros (la tienda dejará de ser elegible para esa zona). Requiere confirmación porque modifica catálogo persistente.',
  is_write: true,
  requires_confirmation: true,
  input_schema: {
    type: 'object',
    properties: {
      store_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID de la tienda a actualizar. Resuélvelo con search_stores si solo tienes el código o nombre.',
      },
      code: {
        type: 'string',
        description: 'Nuevo código (2-30 alfanum + guión). Debe seguir siendo único.',
      },
      name: {
        type: 'string',
        description: 'Nuevo nombre comercial (2-100 chars).',
      },
      zone_id: {
        type: 'string',
        format: 'uuid',
        description: 'Nueva zona operativa. Cambio impactará rutas futuras.',
      },
      address: {
        type: 'string',
        description: 'Nueva dirección postal (mínimo 5 chars).',
      },
      lat: {
        type: 'number',
        description: 'Nueva latitud (-90 a 90). Debe venir de geocoding, no inventada.',
      },
      lng: {
        type: 'number',
        description: 'Nueva longitud (-180 a 180). Debe venir de geocoding, no inventada.',
      },
      contact_name: {
        type: 'string',
        description: 'Nombre del contacto/encargado (pasar string vacío "" para limpiar).',
      },
      contact_phone: {
        type: 'string',
        description: 'Teléfono del contacto (pasar "" para limpiar).',
      },
      receiving_window_start: {
        type: 'string',
        description: 'Hora inicio ventana recepción HH:MM (pasar "" para limpiar).',
      },
      receiving_window_end: {
        type: 'string',
        description: 'Hora fin ventana recepción HH:MM (pasar "" para limpiar).',
      },
      service_time_seconds: {
        type: 'integer',
        description: 'Tiempo estimado de servicio en segundos (default 900 = 15 min).',
      },
      is_active: {
        type: 'boolean',
        description: 'true = activa (elegible para rutas), false = desactivada (oculta del catálogo operativo). Marca false en vez de borrar — preservas historial.',
      },
    },
    required: ['store_id'],
  },
  handler: async (args, ctx): Promise<ToolResult<UpdateStoreResult>> => {
    if (!UUID_RE.test(args.store_id)) return badArg('store_id', 'UUID inválido.');

    // Construir patch object solo con campos provistos.
    const patch: Record<string, unknown> = {};
    const updatedFields: string[] = [];

    if (args.code !== undefined) {
      const code = String(args.code).toUpperCase().trim();
      if (!/^[A-Z0-9-]{2,30}$/.test(code)) return badArg('code', '2-30 chars alfanum + guiones.');
      patch.code = code;
      updatedFields.push('code');
    }
    if (args.name !== undefined) {
      const name = String(args.name).trim();
      if (name.length < 2 || name.length > 100) return badArg('name', '2-100 chars.');
      patch.name = name;
      updatedFields.push('name');
    }
    if (args.zone_id !== undefined) {
      if (!UUID_RE.test(args.zone_id)) return badArg('zone_id', 'UUID inválido.');
      // Validar zone pertenece al customer.
      const { data: zone } = await ctx.supabase
        .from('zones')
        .select('id')
        .eq('id', args.zone_id)
        .eq('customer_id', ctx.customerId)
        .maybeSingle();
      if (!zone) return { ok: false, error: 'Zona no pertenece a tu organización.' };
      patch.zone_id = args.zone_id;
      updatedFields.push('zone_id');
    }
    if (args.address !== undefined) {
      const address = String(args.address).trim();
      if (address.length < 5) return badArg('address', 'mínimo 5 chars.');
      patch.address = address;
      updatedFields.push('address');
    }
    if (args.lat !== undefined) {
      if (typeof args.lat !== 'number' || args.lat < -90 || args.lat > 90) {
        return badArg('lat', 'debe ser número entre -90 y 90.');
      }
      patch.lat = args.lat;
      updatedFields.push('lat');
    }
    if (args.lng !== undefined) {
      if (typeof args.lng !== 'number' || args.lng < -180 || args.lng > 180) {
        return badArg('lng', 'debe ser número entre -180 y 180.');
      }
      patch.lng = args.lng;
      updatedFields.push('lng');
    }
    // Si cambió lat o lng, marcamos coord_verified=true (el AI sólo permite si vino de geocoding).
    if (args.lat !== undefined || args.lng !== undefined) {
      patch.coord_verified = true;
    }

    // Nullable strings: "" → null para limpiar.
    if (args.contact_name !== undefined) {
      patch.contact_name = args.contact_name === '' ? null : args.contact_name;
      updatedFields.push('contact_name');
    }
    if (args.contact_phone !== undefined) {
      patch.contact_phone = args.contact_phone === '' ? null : args.contact_phone;
      updatedFields.push('contact_phone');
    }

    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (args.receiving_window_start !== undefined) {
      if (args.receiving_window_start === '' || args.receiving_window_start === null) {
        patch.receiving_window_start = null;
      } else if (!timeRe.test(args.receiving_window_start)) {
        return badArg('receiving_window_start', 'formato HH:MM (o "" para limpiar).');
      } else {
        patch.receiving_window_start = args.receiving_window_start;
      }
      updatedFields.push('receiving_window_start');
    }
    if (args.receiving_window_end !== undefined) {
      if (args.receiving_window_end === '' || args.receiving_window_end === null) {
        patch.receiving_window_end = null;
      } else if (!timeRe.test(args.receiving_window_end)) {
        return badArg('receiving_window_end', 'formato HH:MM (o "" para limpiar).');
      } else {
        patch.receiving_window_end = args.receiving_window_end;
      }
      updatedFields.push('receiving_window_end');
    }
    if (args.service_time_seconds !== undefined) {
      if (
        typeof args.service_time_seconds !== 'number' ||
        args.service_time_seconds < 0 ||
        args.service_time_seconds > 7200
      ) {
        return badArg('service_time_seconds', 'entre 0 y 7200 (2 hrs máx).');
      }
      patch.service_time_seconds = args.service_time_seconds;
      updatedFields.push('service_time_seconds');
    }
    if (args.is_active !== undefined) {
      patch.is_active = Boolean(args.is_active);
      updatedFields.push('is_active');
    }

    if (updatedFields.length === 0) {
      return {
        ok: false,
        error: 'No se pasaron campos a actualizar. Incluye al menos un campo además de store_id.',
      };
    }

    // Validar que la tienda existe + pertenece al customer (RLS protege también).
    const { data: existing } = await ctx.supabase
      .from('stores')
      .select('id, code, name')
      .eq('id', args.store_id)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();
    if (!existing) {
      return { ok: false, error: 'Tienda no encontrada o no pertenece a tu organización.' };
    }

    const { data, error } = await ctx.supabase
      .from('stores')
      .update(patch as never)
      .eq('id', args.store_id)
      .eq('customer_id', ctx.customerId)
      .select('id, code, name')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { ok: false, error: `Ya existe otra tienda con ese código.` };
      }
      return { ok: false, error: `Error de BD: ${error.message}` };
    }

    return {
      ok: true,
      data: {
        store_id: data.id as string,
        code: data.code as string,
        name: data.name as string,
        updated_fields: updatedFields,
      },
      summary: `Tienda "${data.code}" actualizada (${updatedFields.length} campo${updatedFields.length > 1 ? 's' : ''}: ${updatedFields.join(', ')}).`,
    };
  },
};

// ============================================================================
// archive_store — soft-delete con motivo (Phase 2 / 2026-05-15)
// ============================================================================
//
// Wrapper semántico de update_store(is_active=false). Diferencias:
//   - Verbo más claro para el AI ("archive" vs "update is_active=false").
//   - Acepta un `reason` que va al logger para audit (no toca BD).
//   - Validación más estricta: requiere reason explícito.

interface ArchiveStoreArgs {
  store_id: string;
  reason: string;
}

interface ArchiveStoreResult {
  store_id: string;
  code: string;
  name: string;
  reason: string;
}

const archive_store: ToolDefinition<ArchiveStoreArgs, ArchiveStoreResult> = {
  name: 'archive_store',
  description:
    'Archiva (soft-delete) una tienda: la marca como inactiva, preservando historial. La tienda ya NO aparece en search_stores ni se puede asignar a rutas nuevas, pero los tiros pasados que la incluían siguen visibles. Pide un motivo explícito (ej. "cerró sucursal", "duplicado de XYZ", "cliente terminó relación"). NO usar para borrar datos sensibles — eso es delete físico, otra operación. Requiere confirmación.',
  is_write: true,
  requires_confirmation: true,
  input_schema: {
    type: 'object',
    properties: {
      store_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID de la tienda a archivar. Resuelve con search_stores si solo tienes código/nombre.',
      },
      reason: {
        type: 'string',
        description: 'Motivo claro (5-200 chars). Ej: "cerró sucursal", "duplicado de NETO-1422", "fuera de zona operativa". Va al audit log.',
      },
    },
    required: ['store_id', 'reason'],
  },
  handler: async (args, ctx): Promise<ToolResult<ArchiveStoreResult>> => {
    if (!UUID_RE.test(args.store_id)) return badArg('store_id', 'UUID inválido.');
    const reason = String(args.reason ?? '').trim();
    if (reason.length < 5 || reason.length > 200) {
      return badArg('reason', 'motivo obligatorio (5-200 chars).');
    }

    // Verificar tienda existe + activa actualmente (si ya estaba archived, sería no-op).
    const { data: existing } = await ctx.supabase
      .from('stores')
      .select('id, code, name, is_active')
      .eq('id', args.store_id)
      .eq('customer_id', ctx.customerId)
      .maybeSingle();
    if (!existing) {
      return { ok: false, error: 'Tienda no encontrada o no pertenece a tu organización.' };
    }
    const wasActive = (existing as { is_active: boolean }).is_active;
    if (!wasActive) {
      return {
        ok: false,
        error: `La tienda "${(existing as { code: string }).code}" ya estaba archivada.`,
      };
    }

    const { data, error } = await ctx.supabase
      .from('stores')
      .update({ is_active: false } as never)
      .eq('id', args.store_id)
      .eq('customer_id', ctx.customerId)
      .select('id, code, name')
      .single();
    if (error) {
      return { ok: false, error: `Error de BD: ${error.message}` };
    }

    // El motivo queda en orchestrator_actions (el runner persiste args automáticamente
    // como audit log). Aquí solo lo retornamos en summary para que sea visible al user.
    return {
      ok: true,
      data: {
        store_id: data.id as string,
        code: data.code as string,
        name: data.name as string,
        reason,
      },
      summary: `Tienda "${data.code}" archivada. Motivo: "${reason}".`,
    };
  },
};

// ============================================================================
// Registry export
// ============================================================================
export const PLACES_TOOLS: ReadonlyArray<ToolDefinition> = [
  geocode_address as unknown as ToolDefinition,
  search_place as unknown as ToolDefinition,
  create_store as unknown as ToolDefinition,
  update_store as unknown as ToolDefinition,
  archive_store as unknown as ToolDefinition,
];
