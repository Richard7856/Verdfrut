import 'server-only';

// Datos agregados para los heatmaps del Workbench (WB-5 / ADR-117).
//
// Tres lentes sobre el mismo conjunto de stores reales activas:
//   • frequency: peso = visitsPerWeek (densidad operativa).
//   • volume: peso = kgPerWeek (intensidad de carga).
//   • utilization: agrupa por zona; cada store hereda el utilizationPct de
//     su zona (de la heurística WB-4). El admin ve dónde la flotilla está
//     al límite vs sub-utilizada.
//
// Construye un GeoJSON FeatureCollection que el cliente mapboxgl consume
// directo en una heatmap layer + circle markers para los puntos individuales.

import { createServerClient } from '@tripdrive/supabase/server';
import { getStoreFrequencyStats } from './store-frequencies';
import { recommendFleet } from './fleet-recommendations';

export interface HeatmapStore {
  id: string;
  code: string;
  name: string;
  lat: number;
  lng: number;
  zoneId: string;
  zoneCode: string;
  visitsPerWeek: number;
  kgPerWeek: number;
  zoneUtilizationPct: number;
}

export interface HeatmapData {
  stores: HeatmapStore[];
  /** Max valores por modo — para normalizar weights en el cliente. */
  max: {
    visitsPerWeek: number;
    kgPerWeek: number;
    zoneUtilizationPct: number;
  };
  /** Por zona: utilización, count, kg totales — para el sidebar hotspots. */
  zoneStats: Array<{
    zoneId: string;
    zoneCode: string;
    zoneName: string;
    utilizationPct: number;
    totalKgPerWeek: number;
    totalVisitsPerWeek: number;
    storeCount: number;
  }>;
}

export async function getHeatmapData(): Promise<HeatmapData> {
  const supabase = await createServerClient();

  const { data: zonesRaw } = await supabase
    .from('zones')
    .select('id, code, name')
    .eq('is_active', true);
  type ZoneRow = { id: string; code: string; name: string };
  const zones = (zonesRaw ?? []) as ZoneRow[];
  const zonesById = new Map(zones.map((z) => [z.id, z]));

  // Tiendas reales activas con coordenadas.
  const { data: storesRaw } = await supabase
    .from('stores')
    .select('id, code, name, lat, lng, zone_id')
    .eq('is_active', true)
    .eq('is_sandbox', false);
  type StoreRow = {
    id: string;
    code: string;
    name: string;
    lat: number;
    lng: number;
    zone_id: string;
  };
  const storeRows = (storesRaw ?? []) as StoreRow[];

  if (storeRows.length === 0) {
    return {
      stores: [],
      max: { visitsPerWeek: 0, kgPerWeek: 0, zoneUtilizationPct: 0 },
      zoneStats: [],
    };
  }

  // Stats batch — paralelizamos freq + flota.
  const [freqs, fleet] = await Promise.all([
    getStoreFrequencyStats(storeRows.map((s) => s.id), 30),
    recommendFleet({}),
  ]);

  const utilizationByZone = new Map(
    fleet.zones.map((z) => [z.zoneId, z.utilizationPct]),
  );

  const heatmapStores: HeatmapStore[] = storeRows.map((s) => {
    const f = freqs.get(s.id);
    const kgPerWeek = f && f.kgPerVisit !== null ? f.kgPerVisit * f.visitsPerWeek : 0;
    const zone = zonesById.get(s.zone_id);
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      zoneId: s.zone_id,
      zoneCode: zone?.code ?? '—',
      visitsPerWeek: f?.visitsPerWeek ?? 0,
      kgPerWeek: Math.round(kgPerWeek * 10) / 10,
      zoneUtilizationPct: utilizationByZone.get(s.zone_id) ?? 0,
    };
  });

  let maxVisits = 0;
  let maxKg = 0;
  let maxUtil = 0;
  for (const s of heatmapStores) {
    if (s.visitsPerWeek > maxVisits) maxVisits = s.visitsPerWeek;
    if (s.kgPerWeek > maxKg) maxKg = s.kgPerWeek;
    if (s.zoneUtilizationPct > maxUtil) maxUtil = s.zoneUtilizationPct;
  }

  const zoneStats = fleet.zones.map((z) => ({
    zoneId: z.zoneId,
    zoneCode: z.zoneCode,
    zoneName: z.zoneName,
    utilizationPct: z.utilizationPct,
    totalKgPerWeek: z.totalKgPerWeek,
    totalVisitsPerWeek: z.totalVisitsPerWeek,
    storeCount: z.totalStores,
  }));

  return {
    stores: heatmapStores,
    max: {
      visitsPerWeek: maxVisits,
      kgPerWeek: maxKg,
      zoneUtilizationPct: maxUtil,
    },
    zoneStats,
  };
}
