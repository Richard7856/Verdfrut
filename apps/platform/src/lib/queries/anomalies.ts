// Queries de anomalías para el admin/dispatcher — S18.5.
//
// Expone get_active_anomalies que devuelve 3 tipos de anomalías:
//   - silent_driver: chofer IN_PROGRESS sin broadcast >5 min
//   - route_delayed: ruta con ETA pasada >15 min sin completar
//   - chat_open_long: chat abierto sin resolver >20 min
//
// Polling sugerido: cada 60s desde el cliente. La función es STABLE (mismo
// snapshot devuelve mismo resultado) — Postgres puede cachear plan.

import 'server-only';
import { createServerClient } from '@tripdrive/supabase/server';

export type AnomalyKind = 'silent_driver' | 'route_delayed' | 'chat_open_long';
export type AnomalySeverity = 'high' | 'medium';

export interface Anomaly {
  kind: AnomalyKind;
  severity: AnomalySeverity;
  routeId: string;
  driverId: string | null;
  driverName: string | null;
  storeName: string | null;
  zoneId: string;
  detectedAt: string;
  details: Record<string, unknown>;
}

export async function listActiveAnomalies(zoneIdFilter?: string | null): Promise<Anomaly[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc('get_active_anomalies', {
    zone_id_filter: zoneIdFilter ?? null,
  });
  if (error) throw new Error(`[anomalies.list] ${error.message}`);

  return (data ?? []).map((r) => ({
    kind: r.kind,
    severity: r.severity,
    routeId: r.route_id,
    driverId: r.driver_id,
    driverName: r.driver_name,
    storeName: r.store_name,
    zoneId: r.zone_id,
    detectedAt: r.detected_at,
    details: r.details,
  }));
}
