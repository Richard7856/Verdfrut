// Cliente HTTP para services/optimizer (FastAPI + VROOM).
// Server-only — no exponer OPTIMIZER_API_KEY al cliente.

import 'server-only';
import { localTimeToUnix } from '@tripdrive/utils';
import { logger } from '@tripdrive/observability';
import { getMapboxMatrix } from './mapbox';
import type {
  Depot,
  OptimizerRequest,
  OptimizerResponse,
  OptimizerVehicle,
  OptimizerJob,
  Store,
  Vehicle,
} from '@tripdrive/types';

const OPTIMIZER_TIMEOUT_MS = 30_000;

interface OptimizeContext {
  /** Inicio del turno operativo en UTC unix seconds. */
  shiftStartUnix: number;
  /** Fin del turno operativo en UTC unix seconds. */
  shiftEndUnix: number;
  /**
   * Fecha del shift en formato YYYY-MM-DD (hora local del tenant).
   * Necesaria para construir las time windows de cada tienda con la TZ correcta.
   */
  shiftDate: string;
  /**
   * IANA timezone del tenant (ej. "America/Mexico_City"). Usada al convertir
   * las ventanas horarias HH:MM de las tiendas a unix seconds correctos.
   */
  timezone: string;
  /**
   * Mapa de depots disponibles, indexado por id. Si un vehículo tiene depotId,
   * se usan las coords del depot correspondiente; si no, las coords manuales del
   * propio vehículo (depotLat/depotLng).
   */
  depotsById?: Map<string, Depot>;
  /**
   * ADR-047: override del depot al nivel ruta. Indexado por vehicle.id, contiene
   * coords del depot que la ruta concreta debe usar. Si está presente para un
   * vehicle.id, manda sobre vehicle.depotId / vehicle.depotLat/Lng — útil cuando
   * la misma camioneta sale de distintos CEDIS según el tiro.
   */
  vehicleDepotOverridesById?: Map<string, { lat: number; lng: number }>;
}

/**
 * Llama al optimizer con la lista de vehículos y tiendas.
 * Devuelve la respuesta cruda — el caller la mapea a stops persistidos.
 */
export async function callOptimizer(
  vehicles: Vehicle[],
  stores: Store[],
  ctx: OptimizeContext,
): Promise<OptimizerResponse> {
  const url = process.env.OPTIMIZER_URL;
  const apiKey = process.env.OPTIMIZER_API_KEY;
  if (!url || !apiKey) {
    throw new Error('[optimizer] OPTIMIZER_URL u OPTIMIZER_API_KEY no están definidas');
  }

  const payload = buildOptimizerRequest(vehicles, stores, ctx);
  // Adjuntar matriz precomputada (VROOM no debe consultar OSRM público).
  // Si MAPBOX_DIRECTIONS_TOKEN está configurado → Mapbox Matrix API (calidad prod,
  // respeta calles reales y tráfico). Si no → fallback haversine + velocidad
  // asumida (ETAs aproximados, OK para validar flujo).
  payload.matrix = await buildOptimizerMatrix(vehicles, stores, ctx);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPTIMIZER_TIMEOUT_MS);

  try {
    const res = await fetch(`${url}/optimize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[optimizer] HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    return (await res.json()) as OptimizerResponse;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`[optimizer] Timeout después de ${OPTIMIZER_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Construye el payload del optimizer mapeando entidades de dominio a IDs numéricos.
 * VROOM usa enteros para id, así que mantenemos un mapping en memoria.
 */
function buildOptimizerRequest(
  vehicles: Vehicle[],
  stores: Store[],
  ctx: OptimizeContext,
): OptimizerRequest {
  const optVehicles: OptimizerVehicle[] = vehicles.map((v, idx) => {
    // Prioridad: override por vehicle.id (ADR-047) > vehicle.depotId > coords manuales.
    const override = ctx.vehicleDepotOverridesById?.get(v.id);
    const fromDepot = !override && v.depotId ? ctx.depotsById?.get(v.depotId) : null;
    const depotLng = override ? override.lng : fromDepot ? fromDepot.lng : v.depotLng ?? 0;
    const depotLat = override ? override.lat : fromDepot ? fromDepot.lat : v.depotLat ?? 0;
    return {
      id: idx + 1,
      capacity: v.capacity,
      start: [depotLng, depotLat],
      end: [depotLng, depotLat],
      time_window: [ctx.shiftStartUnix, ctx.shiftEndUnix],
    };
  });

  // C5 — la demanda viene de la tienda, NO un valor genérico.
  const optJobs: OptimizerJob[] = stores.map((s, idx) => ({
    id: idx + 1,
    location: [s.lng, s.lat],
    service: s.serviceTimeSeconds,
    time_windows: buildTimeWindows(s, ctx),
    amount: s.demand,
  }));

  return { vehicles: optVehicles, jobs: optJobs };
}

/**
 * Convierte la ventana horaria de la tienda (HH:MM local del tenant) a unix seconds.
 * Si la tienda no tiene ventana, usa todo el turno operativo.
 *
 * NOTA: Por ahora asume que la fecha es la del shift y la TZ del tenant es la del proceso.
 * Cuando montemos múltiples tenants en un mismo deploy, hay que pasar la TZ explícita.
 */
function buildTimeWindows(store: Store, ctx: OptimizeContext): Array<[number, number]> {
  if (!store.receivingWindowStart || !store.receivingWindowEnd) {
    return [[ctx.shiftStartUnix, ctx.shiftEndUnix]];
  }

  // Postgres `time` se serializa como "HH:MM:SS" — recortamos a "HH:MM" para
  // que `localTimeToUnix` lo parsee. Defensivo si el formato cambia.
  const startTime = store.receivingWindowStart.slice(0, 5);
  const endTime = store.receivingWindowEnd.slice(0, 5);

  // Convertir a unix con la TZ del tenant (no UTC). Sin esto, una tienda
  // CDMX con ventana 07:00 quedaría a las 01:00 (UTC-6) en el optimizer.
  const startUnix = localTimeToUnix(ctx.shiftDate, startTime, ctx.timezone);
  const endUnix = localTimeToUnix(ctx.shiftDate, endTime, ctx.timezone);

  // Clip al shift operativo. Si la ventana de la tienda es más amplia que el
  // shift, el chofer no está disponible fuera de turno.
  return [[Math.max(startUnix, ctx.shiftStartUnix), Math.min(endUnix, ctx.shiftEndUnix)]];
}

/**
 * Mapea un OptimizerStep (con id numérico) a la lista original de stores.
 * Devuelve la sequence + storeId + planned arrival/departure.
 */
export function mapOptimizerStepsToStops(
  optResponse: OptimizerResponse,
  vehicles: Vehicle[],
  stores: Store[],
): Array<{
  vehicleId: string;
  storeId: string;
  sequence: number;
  plannedArrivalAt: string;
  plannedDepartureAt: string;
}> {
  const result: Array<{
    vehicleId: string;
    storeId: string;
    sequence: number;
    plannedArrivalAt: string;
    plannedDepartureAt: string;
  }> = [];

  for (const route of optResponse.routes) {
    const vehicle = vehicles[route.vehicle_id - 1];
    if (!vehicle) continue;

    route.steps.forEach((step, idx) => {
      const store = stores[step.job_id - 1];
      if (!store) return;
      result.push({
        vehicleId: vehicle.id,
        storeId: store.id,
        sequence: idx + 1,
        plannedArrivalAt: new Date(step.arrival * 1000).toISOString(),
        plannedDepartureAt: new Date(step.departure * 1000).toISOString(),
      });
    });
  }

  return result;
}

/**
 * Devuelve los IDs de tiendas que el optimizador no pudo asignar.
 */
export function getUnassignedStoreIds(
  optResponse: OptimizerResponse,
  stores: Store[],
): string[] {
  return optResponse.unassigned
    .map((u) => stores[u.job_id - 1]?.id)
    .filter((id): id is string => Boolean(id));
}

// ----------------------------------------------------------------------------
// Matrix builder — haversine + velocidad asumida
// ----------------------------------------------------------------------------
//
// Por qué precalculamos la matrix en lugar de dejar que VROOM consulte OSRM:
// no tenemos OSRM levantado en el setup local, y consultar OSRM público no
// es viable (rate limits + ToS). En producción la implementación correcta
// es llamar Mapbox Directions Matrix API (issue #25).
//
// El haversine (gran círculo) calcula distancia en línea recta sobre la
// superficie terrestre. Para CDMX, la distancia real por calle es
// típicamente 1.3–1.5x la haversine. Aplicamos un factor de 1.4 como
// compromiso. Velocidad asumida: 30 km/h (zona urbana CDMX promedio).
// El optimizer encuentra una secuencia razonable; los ETAs son
// optimistas pero permiten validar el flujo end-to-end.

const URBAN_DETOUR_FACTOR = 1.4; // distancia real / haversine
const ASSUMED_KMH = 30;
const ASSUMED_MS = (ASSUMED_KMH * 1000) / 3600; // m/s

/**
 * Construye la matriz N×N de durations/distances en el orden esperado por
 * `buildOptimizerRequest`: vehicle[i].start, vehicle[i].end (cada vehículo
 * agrega 2 índices), luego cada job (1 índice).
 */
/**
 * Construye la matriz de duraciones/distancias para VROOM.
 *
 * Estrategia:
 *   1. Si MAPBOX_DIRECTIONS_TOKEN está set → Mapbox Matrix API (calidad prod).
 *   2. Si no o falla → fallback haversine (calidad demo).
 *
 * El orden de coords es: vehicle[i].start, vehicle[i].end (1 entrada por
 * dirección — los duplicamos en la matrix), luego stores en orden.
 * Total puntos = 2 × N_vehicles + N_stores.
 */
async function buildOptimizerMatrix(
  vehicles: Vehicle[],
  stores: Store[],
  ctx: OptimizeContext,
): Promise<{ durations: number[][]; distances: number[][] }> {
  const useMapbox = Boolean(process.env.MAPBOX_DIRECTIONS_TOKEN);

  if (!useMapbox) {
    // ADR-052: no enviamos esto a Sentry porque es un estado esperado (modo
    // demo sin Mapbox key). Solo log estructurado para que aparezca en runtime
    // logs de Vercel. El banner UI (BannerEtaDemo) advierte al dispatcher.
    logger.info('optimizer: MAPBOX_DIRECTIONS_TOKEN ausente — usando haversine', {
      vehicles: vehicles.length,
      stores: stores.length,
    });
    return buildHaversineMatrix(vehicles, stores, ctx);
  }

  // Listar coords únicas; vehículos comparten depot a menudo → dedup.
  const coords = listOptimizerCoords(vehicles, stores, ctx);

  // Mapbox limita 25 coords por request (free tier). Si supera, fallback.
  if (coords.length > 25) {
    await logger.warn(
      'optimizer: >25 coords excede Mapbox free tier — fallback haversine',
      { coordsCount: coords.length, vehicles: vehicles.length, stores: stores.length },
    );
    return buildHaversineMatrix(vehicles, stores, ctx);
  }

  try {
    return await getMapboxMatrix(coords);
  } catch (err) {
    // Esto SÍ va a Sentry: el token está set pero la llamada falló. Cualquier
    // ocurrencia debería alertar al operador para revisar el rate limit o el
    // token. El cliente igualmente recibe ETAs (haversine), pero degradados.
    await logger.error('optimizer: Mapbox Matrix falló — fallback haversine', {
      vehicles: vehicles.length,
      stores: stores.length,
      err,
    });
    return buildHaversineMatrix(vehicles, stores, ctx);
  }
}

/**
 * Devuelve las coords en el ORDEN exacto que `buildOptimizerRequest` indexa.
 * Sin dedup — VROOM espera una posición por cada start/end/job.
 */
function listOptimizerCoords(
  vehicles: Vehicle[],
  stores: Store[],
  ctx: OptimizeContext,
): Array<[number, number]> {
  const coords: Array<[number, number]> = [];
  for (const v of vehicles) {
    const override = ctx.vehicleDepotOverridesById?.get(v.id);
    const fromDepot = !override && v.depotId ? ctx.depotsById?.get(v.depotId) : null;
    const lng = override ? override.lng : fromDepot ? fromDepot.lng : v.depotLng ?? 0;
    const lat = override ? override.lat : fromDepot ? fromDepot.lat : v.depotLat ?? 0;
    coords.push([lng, lat]); // start
    coords.push([lng, lat]); // end
  }
  for (const s of stores) coords.push([s.lng, s.lat]);
  return coords;
}

function buildHaversineMatrix(
  vehicles: Vehicle[],
  stores: Store[],
  ctx: OptimizeContext,
): { durations: number[][]; distances: number[][] } {
  // Resolver coords del depot por vehículo (mismo orden que buildOptimizerRequest).
  const points: Array<[number, number]> = []; // [lng, lat]
  for (const v of vehicles) {
    const override = ctx.vehicleDepotOverridesById?.get(v.id);
    const fromDepot = !override && v.depotId ? ctx.depotsById?.get(v.depotId) : null;
    const lng = override ? override.lng : fromDepot ? fromDepot.lng : v.depotLng ?? 0;
    const lat = override ? override.lat : fromDepot ? fromDepot.lat : v.depotLat ?? 0;
    points.push([lng, lat]); // start
    points.push([lng, lat]); // end (mismo punto)
  }
  for (const s of stores) {
    points.push([s.lng, s.lat]);
  }

  const n = points.length;
  const durations: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const distances: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dHaversine = haversineMeters(points[i]!, points[j]!);
      const dReal = Math.round(dHaversine * URBAN_DETOUR_FACTOR);
      const dur = Math.round(dReal / ASSUMED_MS);
      distances[i]![j] = dReal;
      distances[j]![i] = dReal;
      durations[i]![j] = dur;
      durations[j]![i] = dur;
    }
  }

  return { durations, distances };
}

/** Fórmula haversine — distancia gran círculo entre dos coords [lng, lat] en metros. */
function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6_371_000; // radio Tierra en metros
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
