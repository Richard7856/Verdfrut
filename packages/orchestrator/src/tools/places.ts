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
// Registry export
// ============================================================================
export const PLACES_TOOLS: ReadonlyArray<ToolDefinition> = [
  geocode_address as unknown as ToolDefinition,
  search_place as unknown as ToolDefinition,
  create_store as unknown as ToolDefinition,
];
