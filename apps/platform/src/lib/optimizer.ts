// Cliente HTTP para services/optimizer (FastAPI + VROOM).
// Server-only — no exponer OPTIMIZER_API_KEY al cliente.

import 'server-only';
import type {
  OptimizerRequest,
  OptimizerResponse,
  OptimizerVehicle,
  OptimizerJob,
  Store,
  Vehicle,
} from '@verdfrut/types';

const OPTIMIZER_TIMEOUT_MS = 30_000;

interface OptimizeContext {
  /** Inicio del turno operativo en UTC unix seconds. */
  shiftStartUnix: number;
  /** Fin del turno operativo en UTC unix seconds. */
  shiftEndUnix: number;
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
  const optVehicles: OptimizerVehicle[] = vehicles.map((v, idx) => ({
    id: idx + 1,
    capacity: v.capacity,
    start: [v.depotLng ?? 0, v.depotLat ?? 0],
    end: [v.depotLng ?? 0, v.depotLat ?? 0],
    time_window: [ctx.shiftStartUnix, ctx.shiftEndUnix],
  }));

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

  // Tomar la fecha base del shift y reemplazar las horas.
  const shiftDate = new Date(ctx.shiftStartUnix * 1000);
  const datePrefix = shiftDate.toISOString().slice(0, 10); // YYYY-MM-DD

  const startUnix = Math.floor(new Date(`${datePrefix}T${store.receivingWindowStart}:00Z`).getTime() / 1000);
  const endUnix = Math.floor(new Date(`${datePrefix}T${store.receivingWindowEnd}:00Z`).getTime() / 1000);

  // Clip al shift operativo.
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
