import 'server-only';

// Estadísticas de frecuencia por tienda (Workbench WB-2 / ADR-114).
//
// El admin necesita saber por cada tienda:
//   - Cuántas veces se visitó en los últimos N días.
//   - Promedio de kg/cajas por visita (load[0]).
//   - Fecha de la última visita real (actual_arrival_at o, fallback, planned).
//   - Frecuencia teórica visits/semana en el ventana.
//
// Diseño:
//   - Una sola query agregando stops + routes. Filtra is_sandbox=false para
//     que las stats reflejen SIEMPRE operación real, sin importar el modo
//     Workbench actual del admin. La planeación no genera historia.
//   - Status: contamos 'completed' (ejecutadas con éxito). Skipped/pending
//     NO suman frecuencia (la tienda no recibió mercancía).
//   - Si la tienda no tiene stops en la ventana, devuelve un registro con
//     visits=0 y lastVisitAt=null para que el caller diferencie "sin datos"
//     de "no consultada".

import { createServerClient } from '@tripdrive/supabase/server';

export interface StoreFrequency {
  storeId: string;
  /** Conteo de stops 'completed' en la ventana. */
  visits: number;
  /** Suma de kg/cajas (load[0]) en stops completed. */
  totalKg: number;
  /** Promedio kg/visita (totalKg / visits) o null si visits=0. */
  kgPerVisit: number | null;
  /** ISO de la última visita exitosa, o null si sin visitas. */
  lastVisitAt: string | null;
  /** Visitas / semana proyectadas (visits * 7 / windowDays). */
  visitsPerWeek: number;
}

/**
 * Calcula stats agregadas en BATCH para N stores. Una sola query.
 *
 * @param storeIds — lista a procesar. Vacía → Map vacío.
 * @param windowDays — ventana de tiempo en días (típico 30). Min 1.
 */
export async function getStoreFrequencyStats(
  storeIds: string[],
  windowDays: number = 30,
): Promise<Map<string, StoreFrequency>> {
  const result = new Map<string, StoreFrequency>();
  if (storeIds.length === 0) return result;

  // Pre-inicializar con conteos cero para que la UI siempre tenga registro.
  for (const id of storeIds) {
    result.set(id, {
      storeId: id,
      visits: 0,
      totalKg: 0,
      kgPerVisit: null,
      lastVisitAt: null,
      visitsPerWeek: 0,
    });
  }

  const supabase = await createServerClient();
  const sinceDate = new Date();
  sinceDate.setUTCDate(sinceDate.getUTCDate() - Math.max(1, windowDays));
  const sinceIso = sinceDate.toISOString();

  // Pedimos stops del rango con su route padre para filtrar sandbox=false.
  // La JOIN implicita a routes via foreign key permite filter en is_sandbox
  // sin un INNER JOIN explícito (supabase-js lo resuelve via embed).
  //
  // No filtramos por status='completed' a nivel SQL porque queremos también
  // detectar la última PLANNED si no hubo completed (caso edge: tienda
  // todavía sin ejecución en la ventana). En memoria separamos completed
  // (para conteo de freq) de planeadas (solo para lastVisitAt fallback).
  const { data, error } = await supabase
    .from('stops')
    .select('store_id, status, load, actual_arrival_at, planned_arrival_at, route_id, routes!inner(is_sandbox, date)')
    .in('store_id', storeIds)
    .eq('routes.is_sandbox', false)
    .gte('routes.date', sinceIso.slice(0, 10));

  if (error) {
    // Falla silenciosa para no romper la página entera. La UI ve ceros.
    return result;
  }

  type Row = {
    store_id: string;
    status: string;
    load: number[] | null;
    actual_arrival_at: string | null;
    planned_arrival_at: string | null;
  };

  for (const row of (data ?? []) as unknown as Row[]) {
    const rec = result.get(row.store_id);
    if (!rec) continue;
    const completedTs = row.status === 'completed' ? (row.actual_arrival_at ?? row.planned_arrival_at) : null;
    if (row.status === 'completed') {
      rec.visits += 1;
      const kg = Number(row.load?.[0] ?? 0) || 0;
      rec.totalKg += kg;
    }
    // lastVisitAt: prioriza completed > planeada futura. Si ya tenemos un
    // completed, no lo pisamos con una planeada.
    const candidateTs = completedTs ?? row.actual_arrival_at ?? row.planned_arrival_at;
    if (candidateTs) {
      if (!rec.lastVisitAt || candidateTs > rec.lastVisitAt) {
        // Solo pisamos lastVisitAt con completed o con planned si aún no hay completed.
        if (row.status === 'completed' || rec.visits === 0) {
          rec.lastVisitAt = candidateTs;
        }
      }
    }
  }

  // Cálculo derivado: kg/visita y freq semanal.
  for (const rec of result.values()) {
    rec.kgPerVisit = rec.visits > 0 ? Math.round((rec.totalKg / rec.visits) * 10) / 10 : null;
    rec.visitsPerWeek =
      Math.round(((rec.visits * 7) / Math.max(1, windowDays)) * 10) / 10;
  }

  return result;
}

/**
 * Helper de formato — "hace N días" en español.
 * Útil para UI de "última visita".
 */
export function formatRelativeDate(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    // Futuro (planeación).
    if (diffDays === -1) return 'mañana';
    return `en ${Math.abs(diffDays)} d`;
  }
  if (diffDays === 0) return 'hoy';
  if (diffDays === 1) return 'ayer';
  if (diffDays < 30) return `hace ${diffDays} d`;
  const weeks = Math.floor(diffDays / 7);
  if (weeks < 8) return `hace ${weeks} sem`;
  const months = Math.floor(diffDays / 30);
  return `hace ${months} m`;
}
