// Acción "Marcar llegada" del chofer.
//
// IMPORTANTE — modelo de seguridad:
//   La validación geo (haversine vs radio de la tienda) corre client-side.
//   En el web driver vive en una server action; en native re-crearíamos esa
//   infra solo cuando justifique el riesgo. Mientras tanto:
//     - RLS protege que el chofer SÓLO pueda updatear sus propios stops.
//     - El campo `arrival_distance_meters` queda en metadata para audit.
//     - Si en el futuro detectamos fraude (chofer movilizando lat/lng del
//       device), movemos la validación a una Edge Function de Supabase
//       (issue para abrir post-pilot).
//
// El radio default es 300m (tipo `entrega`), igual que en el web (ADR-019).
// N3 sólo expone `entrega` — los otros tipos (`tienda_cerrada`, `bascula`)
// son flujos N4 y suben con la pantalla de reporte completa.

import * as Location from 'expo-location';
import type { StopContext } from '@/lib/queries/stop';
import { supabase } from '@/lib/supabase';
import { haversineMeters } from '@/lib/geo';

const ARRIVAL_RADIUS_METERS_ENTREGA = 300;

export interface ArrivalRejection {
  reason: 'too_far' | 'no_coords' | 'permission_denied';
  distanceMeters?: number;
  thresholdMeters?: number;
  message: string;
}

export type ArriveResult =
  | { ok: true }
  | { ok: false; rejection: ArrivalRejection }
  | { ok: false; error: string };

/**
 * Marca la parada como `arrived`. Si la ruta estaba PUBLISHED, la pasa a
 * IN_PROGRESS también (consistente con web `arriveAtStop`).
 *
 * Pide la posición actual con `Location.getCurrentPositionAsync` —
 * highAccuracy. Si el chofer no concedió permiso o no se obtiene fix en 15s,
 * devuelve rejection (no error, para que UI muestre mensaje específico).
 *
 * Idempotente: si el stop ya está `arrived` o `completed`, devuelve ok=true.
 */
export async function markArrived(ctx: StopContext): Promise<ArriveResult> {
  // Idempotencia: ya llegó / completó.
  if (ctx.stop.status === 'arrived' || ctx.stop.status === 'completed') {
    return { ok: true };
  }

  // 1. Permisos foreground.
  const perm = await Location.getForegroundPermissionsAsync();
  let granted = perm.granted;
  if (!granted) {
    const ask = await Location.requestForegroundPermissionsAsync();
    granted = ask.granted;
  }
  if (!granted) {
    return {
      ok: false,
      rejection: {
        reason: 'permission_denied',
        message:
          'Necesitamos tu ubicación para confirmar la llegada. Habilita el permiso en Configuración.',
      },
    };
  }

  // 2. Lectura GPS con timeout suave (la opción nativa no expone timeout,
  // así que lo hacemos via Promise.race).
  let pos: Location.LocationObject;
  try {
    pos = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      }),
      new Promise<Location.LocationObject>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 15_000),
      ),
    ]);
  } catch (err) {
    return {
      ok: false,
      rejection: {
        reason: 'no_coords',
        message:
          err instanceof Error && err.message === 'timeout'
            ? 'No se pudo leer tu GPS en 15s. Sal a un lugar abierto y reintenta.'
            : 'No se pudo obtener tu ubicación. Verifica que el GPS esté encendido.',
      },
    };
  }

  // 3. Validación de distancia.
  const distance = haversineMeters(
    pos.coords.latitude,
    pos.coords.longitude,
    ctx.store.lat,
    ctx.store.lng,
  );
  if (distance > ARRIVAL_RADIUS_METERS_ENTREGA) {
    return {
      ok: false,
      rejection: {
        reason: 'too_far',
        distanceMeters: Math.round(distance),
        thresholdMeters: ARRIVAL_RADIUS_METERS_ENTREGA,
        message: `Estás a ${(distance / 1000).toFixed(2)} km de la tienda. Acércate (máx. ${ARRIVAL_RADIUS_METERS_ENTREGA} m).`,
      },
    };
  }

  // 4. Update del stop con metadata de audit (ADR-084 / AV-#7).
  //    `pos.mocked` solo existe en Android — en iOS o si el platform no
  //    reporta, queda null. Eso es deseable: indica "no medido" no "false".
  const nowIso = new Date().toISOString();
  const wasMocked =
    typeof (pos as unknown as { mocked?: boolean }).mocked === 'boolean'
      ? (pos as unknown as { mocked: boolean }).mocked
      : null;
  const { error: stopErr } = await supabase
    .from('stops')
    .update({
      status: 'arrived',
      actual_arrival_at: nowIso,
      arrival_was_mocked: wasMocked,
      arrival_distance_meters: Math.round(distance),
      arrival_accuracy_meters: pos.coords.accuracy ?? null,
    })
    .eq('id', ctx.stop.id);
  if (stopErr) return { ok: false, error: `Stop: ${stopErr.message}` };

  // Si detectamos mock location, logueamos warning para que el supervisor
  // lo investigue. El stop SÍ se marca arrived — la decisión de bloquear o
  // no checkins mockeados queda para Edge Function server-side (issue #179).
  if (wasMocked === true) {
    console.warn('[markArrived] pos.mocked=true detectado — flag persistido en stops.arrival_was_mocked');
  }

  // 5. Si la ruta estaba PUBLISHED, promover a IN_PROGRESS.
  // Best-effort — si falla, igual marcamos arrival como exitosa (el web hace lo
  // mismo: no falla la operación si solo el promote de status no pudo).
  if (ctx.route.status === 'PUBLISHED') {
    const { error: routeErr } = await supabase
      .from('routes')
      .update({ status: 'IN_PROGRESS', actual_start_at: nowIso })
      .eq('id', ctx.route.id);
    if (routeErr) {
      console.warn('[arrive] route promote a IN_PROGRESS falló:', routeErr.message);
    }
  }

  return { ok: true };
}
