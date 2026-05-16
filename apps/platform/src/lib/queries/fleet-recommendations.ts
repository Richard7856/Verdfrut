import 'server-only';

// Recomendación de flotilla (Workbench WB-4 / ADR-116).
//
// Pregunta que responde: ¿cuántas camionetas necesita mínimo el cliente para
// sostener su volumen actual? Compara contra la flotilla real y produce el
// delta (sobra / falta capacidad).
//
// Heurística (no algoritmo exacto):
//   1. Total kg/sem por zona = sum(store.kgPerVisit × store.visitsPerWeek)
//      usando las stats de WB-2 sobre los últimos 30 días.
//   2. Total visitas/sem por zona = sum(store.visitsPerWeek).
//   3. Por cada zona: necesidad de vehículos = max(by_capacity, by_stops).
//   4. by_capacity = ceil(kg_sem / (vehicle.capacity[0] × workingDaysPerWeek))
//   5. by_stops    = ceil(visitas_sem / (maxStopsPerDay × workingDaysPerWeek))
//   6. Tipo de vehículo: agrupamos camionetas reales por capacity[0] (peso),
//      tomamos la mediana como "vehículo representativo" para esa zona.
//
// Limitaciones (documentadas para el admin):
//   - No considera ventanas horarias estrictas, jornada legal, ni costo $.
//     Es estimación de capacidad bruta para detectar "voy a saturar" vs
//     "tengo holgura".
//   - Asume 1 viaje/día por vehículo (no multi-trip).
//   - El admin puede ajustar workingDays/maxStops para ver sensibilidad.

import { createServerClient } from '@tripdrive/supabase/server';
import { getStoreFrequencyStats } from './store-frequencies';

const FREQUENCY_WINDOW_DAYS = 30;
const DEFAULT_MAX_STOPS_PER_DAY = 14;
const DEFAULT_WORKING_DAYS = 5;
const DEFAULT_VEHICLE_CAPACITY_KG = 1000; // fallback si zona sin vehículos

export interface FleetRecommendationInputs {
  workingDaysPerWeek: number;
  maxStopsPerDay: number;
}

export interface ZoneFleetRecommendation {
  zoneId: string;
  zoneName: string;
  zoneCode: string;
  totalStores: number;
  totalKgPerWeek: number;
  totalVisitsPerWeek: number;
  /** Capacidad kg de un vehículo "representativo" de la zona (mediana). */
  representativeCapacityKg: number;
  /** Conteo real de vehículos activos asignados a la zona. */
  currentVehicleCount: number;
  /** Mínimo necesario por kg/sem (techo). */
  vehiclesNeededByKg: number;
  /** Mínimo necesario por paradas/sem. */
  vehiclesNeededByStops: number;
  /** El máx de los dos — la restricción dominante. */
  vehiclesNeeded: number;
  /** vehiclesNeeded - currentVehicleCount. + = falta, - = sobra. */
  delta: number;
  /** % de capacidad usada vs disponible (0-100+). */
  utilizationPct: number;
  /** Cuál constraint domina ('kg' o 'stops'). */
  bottleneck: 'kg' | 'stops' | 'balanced';
}

export interface FleetRecommendation {
  inputs: FleetRecommendationInputs;
  totals: {
    totalStores: number;
    totalKgPerWeek: number;
    totalVisitsPerWeek: number;
    currentVehicleCount: number;
    vehiclesNeeded: number;
    delta: number;
  };
  zones: ZoneFleetRecommendation[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export async function recommendFleet(
  inputs?: Partial<FleetRecommendationInputs>,
): Promise<FleetRecommendation> {
  const workingDaysPerWeek = clamp(
    inputs?.workingDaysPerWeek ?? DEFAULT_WORKING_DAYS,
    1,
    7,
  );
  const maxStopsPerDay = clamp(
    inputs?.maxStopsPerDay ?? DEFAULT_MAX_STOPS_PER_DAY,
    1,
    100,
  );
  const supabase = await createServerClient();

  // 1. Zonas activas + sus tiendas activas reales.
  const { data: zonesRaw } = await supabase
    .from('zones')
    .select('id, code, name')
    .eq('is_active', true);
  const zones = (zonesRaw ?? []) as Array<{ id: string; code: string; name: string }>;

  const { data: storesRaw } = await supabase
    .from('stores')
    .select('id, zone_id')
    .eq('is_active', true)
    .eq('is_sandbox', false);
  const stores = (storesRaw ?? []) as Array<{ id: string; zone_id: string }>;

  // 2. Vehículos activos reales por zona.
  const { data: vehiclesRaw } = await supabase
    .from('vehicles')
    .select('id, zone_id, capacity, is_active')
    .eq('is_active', true)
    .eq('is_sandbox', false);
  type VehicleRow = { id: string; zone_id: string; capacity: number[] };
  const vehicles = (vehiclesRaw ?? []) as VehicleRow[];

  // 3. Frecuencias agregadas — todas las tiendas en una sola query batch.
  const freqs = await getStoreFrequencyStats(
    stores.map((s) => s.id),
    FREQUENCY_WINDOW_DAYS,
  );

  // 4. Agrupar por zona.
  const storesByZone = new Map<string, string[]>();
  for (const s of stores) {
    const arr = storesByZone.get(s.zone_id) ?? [];
    arr.push(s.id);
    storesByZone.set(s.zone_id, arr);
  }
  const vehiclesByZone = new Map<string, VehicleRow[]>();
  for (const v of vehicles) {
    const arr = vehiclesByZone.get(v.zone_id) ?? [];
    arr.push(v);
    vehiclesByZone.set(v.zone_id, arr);
  }

  // 5. Por cada zona, computar recomendación.
  const zoneRecommendations: ZoneFleetRecommendation[] = [];
  for (const zone of zones) {
    const storeIds = storesByZone.get(zone.id) ?? [];
    if (storeIds.length === 0) continue; // omitimos zonas sin operación

    let kgPerWeek = 0;
    let visitsPerWeek = 0;
    for (const sid of storeIds) {
      const f = freqs.get(sid);
      if (!f) continue;
      visitsPerWeek += f.visitsPerWeek;
      if (f.kgPerVisit !== null) {
        kgPerWeek += f.kgPerVisit * f.visitsPerWeek;
      }
    }

    const zoneVehicles = vehiclesByZone.get(zone.id) ?? [];
    const capacities = zoneVehicles.map((v) => Number(v.capacity?.[0] ?? 0)).filter((c) => c > 0);
    const representativeCapacityKg = capacities.length > 0
      ? Math.round(median(capacities))
      : DEFAULT_VEHICLE_CAPACITY_KG;

    const weeklyCapacityPerVehicle = representativeCapacityKg * workingDaysPerWeek;
    const weeklyStopsPerVehicle = maxStopsPerDay * workingDaysPerWeek;

    const vehiclesNeededByKg = weeklyCapacityPerVehicle > 0
      ? Math.ceil(kgPerWeek / weeklyCapacityPerVehicle)
      : 0;
    const vehiclesNeededByStops = weeklyStopsPerVehicle > 0
      ? Math.ceil(visitsPerWeek / weeklyStopsPerVehicle)
      : 0;
    const vehiclesNeeded = Math.max(vehiclesNeededByKg, vehiclesNeededByStops, 1);

    const currentVehicleCount = zoneVehicles.length;
    const delta = vehiclesNeeded - currentVehicleCount;
    const utilizationPct = currentVehicleCount > 0
      ? Math.round((vehiclesNeeded / currentVehicleCount) * 100)
      : 0;

    let bottleneck: 'kg' | 'stops' | 'balanced';
    if (vehiclesNeededByKg > vehiclesNeededByStops) bottleneck = 'kg';
    else if (vehiclesNeededByStops > vehiclesNeededByKg) bottleneck = 'stops';
    else bottleneck = 'balanced';

    zoneRecommendations.push({
      zoneId: zone.id,
      zoneName: zone.name,
      zoneCode: zone.code,
      totalStores: storeIds.length,
      totalKgPerWeek: Math.round(kgPerWeek * 10) / 10,
      totalVisitsPerWeek: Math.round(visitsPerWeek * 10) / 10,
      representativeCapacityKg,
      currentVehicleCount,
      vehiclesNeededByKg,
      vehiclesNeededByStops,
      vehiclesNeeded,
      delta,
      utilizationPct,
      bottleneck,
    });
  }

  zoneRecommendations.sort((a, b) => b.totalKgPerWeek - a.totalKgPerWeek);

  // Totales globales.
  const totalStores = zoneRecommendations.reduce((s, z) => s + z.totalStores, 0);
  const totalKgPerWeek =
    Math.round(zoneRecommendations.reduce((s, z) => s + z.totalKgPerWeek, 0) * 10) / 10;
  const totalVisitsPerWeek =
    Math.round(zoneRecommendations.reduce((s, z) => s + z.totalVisitsPerWeek, 0) * 10) / 10;
  const currentVehicleCount = zoneRecommendations.reduce(
    (s, z) => s + z.currentVehicleCount,
    0,
  );
  const vehiclesNeeded = zoneRecommendations.reduce((s, z) => s + z.vehiclesNeeded, 0);

  return {
    inputs: { workingDaysPerWeek, maxStopsPerDay },
    totals: {
      totalStores,
      totalKgPerWeek,
      totalVisitsPerWeek,
      currentVehicleCount,
      vehiclesNeeded,
      delta: vehiclesNeeded - currentVehicleCount,
    },
    zones: zoneRecommendations,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
