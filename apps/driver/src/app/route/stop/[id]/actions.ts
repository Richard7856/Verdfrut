'use server';

// Server Actions del flujo de la parada.
// Toda mutación de delivery_reports y stops del chofer pasa por aquí.
// Aplican RLS — el chofer solo puede tocar sus propios datos.

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@tripdrive/supabase/server';
import { haversineMeters } from '@tripdrive/utils';
import type { TableUpdate } from '@tripdrive/supabase';
import { getStopContext } from '@/lib/queries/stop';
import { mapDeliveryReport } from '@/lib/queries/report';
import { getInitialStep } from '@tripdrive/flow-engine';
import type {
  DeliveryReport,
  IncidentDetail,
  ReportType,
  ResolutionType,
  TicketData,
} from '@tripdrive/types';

/**
 * Umbrales de cercanía a la tienda según tipo de visita.
 * - 'entrega': 300m — el chofer DEBE estar literalmente afuera de la tienda.
 * - 'tienda_cerrada' / 'bascula': 1000m — más permisivo porque el chofer puede
 *   estar reportando desde el estacionamiento del centro comercial o similar,
 *   pero NO desde su casa. 1km bloquea fraude evidente sin ser tan estricto que
 *   bloquee operación legítima.
 *
 * Configurable por env si en el futuro hay que tunear por ciudad/cliente.
 */
const ARRIVAL_RADIUS_METERS: Record<ReportType, number> = {
  entrega: 1000,
  tienda_cerrada: 1000,
  bascula: 300,
};

export interface ActionOk<T = void> {
  ok: true;
  data: T;
}
export interface ActionErr {
  ok: false;
  error: string;
}
export type Result<T = void> = ActionOk<T> | ActionErr;

interface ArrivalCoords {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface ArrivalRejection {
  reason: 'too_far' | 'no_coords';
  distanceMeters?: number;
  thresholdMeters?: number;
  message: string;
}

/**
 * Marca la llegada a la parada y abre un draft delivery_report con el tipo elegido.
 * Idempotente: si ya existe un report en curso lo devuelve. Si existe un draft, lo recicla.
 *
 * VALIDACIÓN GEO (anti-fraude):
 * El chofer DEBE estar dentro del radio de la tienda según `ARRIVAL_RADIUS_METERS`.
 * Si está más lejos, se rechaza con `reason='too_far'` + distancia exacta para
 * que la UI pueda mostrar "estás a 2.3km — acércate". Si la lectura GPS no se
 * pudo obtener, `reason='no_coords'`.
 *
 * El cliente debe pasar `coords`. Si no lo hace (browser sin geo, permiso denegado),
 * se rechaza con `no_coords` — el chofer no puede arrivar sin GPS.
 *
 * NOTA HISTÓRICA: en pre-deploy hubo un bypass DEMO_MODE_BYPASS_GEO para grabar
 * el demo sin moverse físicamente. Removido al cierre de Sprint 18 (S18.9) para
 * no dejar superficie de fraude latente. Si se necesita demo en oficina otra
 * vez, reintroducir TEMPORALMENTE en una rama dedicada y revertir antes de mergear.
 */
export async function arriveAtStop(
  stopId: string,
  type: ReportType = 'entrega',
  coords?: ArrivalCoords | null,
): Promise<Result<DeliveryReport> | { ok: false; rejection: ArrivalRejection }> {
  const supabase = await createServerClient();
  const ctx = await getStopContext(stopId);
  if (!ctx) return { ok: false, error: 'Parada no encontrada o sin acceso' };

  // Si ya hay un report en curso, devolverlo. No queremos doble insert.
  if (ctx.report) {
    return { ok: true, data: ctx.report };
  }

  // Validación geo — debe estar dentro del radio de la tienda.
  if (!coords) {
    return {
      ok: false,
      rejection: {
        reason: 'no_coords',
        message: 'No se pudo obtener tu ubicación GPS. Habilita el permiso e intenta de nuevo.',
      },
    };
  }
  const distance = haversineMeters(coords.lat, coords.lng, ctx.store.lat, ctx.store.lng);
  const threshold = ARRIVAL_RADIUS_METERS[type];
  if (distance > threshold) {
    // ADR-125: el chofer no ve km. Convertimos la distancia a metros
    // en el mensaje de error para mantener consistencia con el resto de la
    // app. La distancia exacta sigue en `distanceMeters` para logs/audit.
    return {
      ok: false,
      rejection: {
        reason: 'too_far',
        distanceMeters: Math.round(distance),
        thresholdMeters: threshold,
        message: `Estás a ${Math.round(distance)} m de la tienda. Acércate (máx. ${threshold} m).`,
      },
    };
  }

  // Marcar stop como arrived (RLS valida que el chofer pueda).
  const nowIso = new Date().toISOString();
  const { error: stopErr } = await supabase
    .from('stops')
    .update({ status: 'arrived', actual_arrival_at: nowIso })
    .eq('id', stopId);
  if (stopErr) return { ok: false, error: `Stop: ${stopErr.message}` };

  // Si la ruta está PUBLISHED, marcarla como IN_PROGRESS al primer arrival.
  if (ctx.route.status === 'PUBLISHED') {
    await supabase
      .from('routes')
      .update({ status: 'IN_PROGRESS', actual_start_at: nowIso })
      .eq('id', ctx.route.id);
  }

  // Crear el draft delivery_report.
  const initialStep = getInitialStep(type);
  const { data, error: insertErr } = await supabase
    .from('delivery_reports')
    .insert({
      stop_id: stopId,
      route_id: ctx.route.id,
      driver_id: ctx.driverId,
      zone_id: ctx.route.zoneId,
      store_id: ctx.store.id,
      store_code: ctx.store.code,
      store_name: ctx.store.name,
      type,
      status: 'draft',
      current_step: initialStep,
      // Guardar las coords del arrival en metadata para audit + posible análisis
      // de "lejanía típica" del chofer en cada tipo de visita.
      metadata: {
        arrival_coords: { lat: coords.lat, lng: coords.lng, accuracy: coords.accuracy ?? null },
        arrival_distance_meters: Math.round(distance),
      },
    })
    .select('*')
    .single();

  if (insertErr) return { ok: false, error: `Report: ${insertErr.message}` };

  revalidatePath(`/route/stop/${stopId}`);
  revalidatePath('/route');
  return { ok: true, data: mapDeliveryReport(data as Record<string, unknown>) };
}

/**
 * Avanza el flujo a un nuevo step. La lógica de "cuál es el next" la calculó el cliente
 * usando @tripdrive/flow-engine; el server confía y persiste.
 */
export async function advanceStep(reportId: string, nextStep: string): Promise<Result> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('delivery_reports')
    .update({ current_step: nextStep })
    .eq('id', reportId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

/**
 * Guarda una URL de evidencia bajo una key específica.
 * El upload del archivo a Storage lo hace el cliente con el bucket evidence/ticket-images.
 * Aquí solo persistimos la URL pública/firmada en el JSON evidence.
 *
 * Hace UPDATE con merge — si la key ya existía, sobreescribe.
 */
export async function setReportEvidence(
  reportId: string,
  key: string,
  url: string,
): Promise<Result> {
  const supabase = await createServerClient();
  // Leer el JSON actual, hacer merge (Postgres jsonb || sería más limpio,
  // pero el cliente js no lo expone de forma tipada).
  const { data, error: readErr } = await supabase
    .from('delivery_reports')
    .select('evidence')
    .eq('id', reportId)
    .single();
  if (readErr) return { ok: false, error: readErr.message };

  const evidence = (data?.evidence ?? {}) as Record<string, string>;
  evidence[key] = url;

  const { error } = await supabase
    .from('delivery_reports')
    .update({ evidence })
    .eq('id', reportId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

/**
 * Persiste flags y campos sueltos del flujo (has_merma, no_ticket_reason, etc.)
 * en el report. Solo permite columnas conocidas.
 */
export async function patchReport(
  reportId: string,
  patch: {
    hasMerma?: boolean;
    noTicketReason?: string | null;
    noTicketReasonPhotoUrl?: string | null;
    otherIncidentDescription?: string | null;
    otherIncidentPhotoUrl?: string | null;
    incidentDetails?: IncidentDetail[];
    ticketImageUrl?: string | null;
    // Sprint 12: persistencia de extracción OCR + edición manual.
    ticketData?: TicketData | null;
    ticketExtractionConfirmed?: boolean;
    returnTicketData?: TicketData | null;
    returnTicketExtractionConfirmed?: boolean;
  },
): Promise<Result> {
  const supabase = await createServerClient();
  const update: TableUpdate<'delivery_reports'> = {};
  if (patch.hasMerma !== undefined) update.has_merma = patch.hasMerma;
  if (patch.noTicketReason !== undefined) update.no_ticket_reason = patch.noTicketReason;
  if (patch.noTicketReasonPhotoUrl !== undefined)
    update.no_ticket_reason_photo_url = patch.noTicketReasonPhotoUrl;
  if (patch.otherIncidentDescription !== undefined)
    update.other_incident_description = patch.otherIncidentDescription;
  if (patch.otherIncidentPhotoUrl !== undefined)
    update.other_incident_photo_url = patch.otherIncidentPhotoUrl;
  if (patch.incidentDetails !== undefined)
    update.incident_details = patch.incidentDetails as unknown as TableUpdate<'delivery_reports'>['incident_details'];
  if (patch.ticketImageUrl !== undefined) update.ticket_image_url = patch.ticketImageUrl;
  if (patch.ticketData !== undefined)
    update.ticket_data = patch.ticketData as unknown as TableUpdate<'delivery_reports'>['ticket_data'];
  if (patch.ticketExtractionConfirmed !== undefined)
    update.ticket_extraction_confirmed = patch.ticketExtractionConfirmed;
  if (patch.returnTicketData !== undefined)
    update.return_ticket_data = patch.returnTicketData as unknown as TableUpdate<'delivery_reports'>['return_ticket_data'];
  if (patch.returnTicketExtractionConfirmed !== undefined)
    update.return_ticket_extraction_confirmed = patch.returnTicketExtractionConfirmed;

  if (Object.keys(update).length === 0) return { ok: true, data: undefined };

  const { error } = await supabase.from('delivery_reports').update(update).eq('id', reportId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

/**
 * Cierra el reporte: status=submitted, resolution=completa por default,
 * stop=completed, timestamp en submitted_at, y avanza a status del stop.
 *
 * El encargado de zona puede cambiar resolution_type después si hay disputa.
 */
export async function submitReport(
  reportId: string,
  resolutionType: ResolutionType = 'completa',
): Promise<Result<{ stopId: string }>> {
  const supabase = await createServerClient();

  const { data: existing, error: readErr } = await supabase
    .from('delivery_reports')
    .select('stop_id, route_id, status')
    .eq('id', reportId)
    .single();
  if (readErr) return { ok: false, error: readErr.message };

  const nowIso = new Date().toISOString();

  const { error: reportErr } = await supabase
    .from('delivery_reports')
    .update({
      status: 'submitted',
      current_step: 'finish',
      resolution_type: resolutionType,
      submitted_at: nowIso,
    })
    .eq('id', reportId);
  if (reportErr) return { ok: false, error: `Report: ${reportErr.message}` };

  const stopStatus = resolutionType === 'sin_entrega' ? 'skipped' : 'completed';
  const { error: stopErr } = await supabase
    .from('stops')
    .update({ status: stopStatus, actual_departure_at: nowIso })
    .eq('id', existing!.stop_id);
  if (stopErr) return { ok: false, error: `Stop: ${stopErr.message}` };

  // Si todas las stops de la ruta ya están completed/skipped, marcar la ruta COMPLETED.
  const { data: pendingStops } = await supabase
    .from('stops')
    .select('id')
    .eq('route_id', existing!.route_id)
    .in('status', ['pending', 'arrived']);
  if (!pendingStops || pendingStops.length === 0) {
    await supabase
      .from('routes')
      .update({ status: 'COMPLETED', actual_end_at: nowIso })
      .eq('id', existing!.route_id);
  }

  revalidatePath(`/route/stop/${existing!.stop_id}`);
  revalidatePath('/route');
  return { ok: true, data: { stopId: existing!.stop_id } };
}

/**
 * Convierte un report de tipo `tienda_cerrada` o `bascula` a `entrega`.
 * Se llama cuando el chofer (o el comercial) determina que la tienda sí se abrió
 * o la báscula sí funciona, y por tanto debe seguir el flujo de entrega normal.
 *
 * Reusa la foto de fachada/bascula como `arrival_exhibit` (mismo bucket, misma key).
 * El chofer NO tiene que tomar una foto duplicada del mueble al llegar.
 */
export async function convertToEntregaAction(reportId: string): Promise<Result> {
  const supabase = await createServerClient();
  const { data: existing, error: readErr } = await supabase
    .from('delivery_reports')
    .select('id, type, evidence, status')
    .eq('id', reportId)
    .single();
  if (readErr) return { ok: false, error: readErr.message };
  if (existing.status !== 'draft') {
    return { ok: false, error: 'No se puede convertir un reporte ya enviado' };
  }
  if (existing.type === 'entrega') {
    // Idempotente — ya es entrega, no hacer nada.
    return { ok: true, data: undefined };
  }

  // Reusar la foto previa (facade o scale) como arrival_exhibit.
  const evidence = (existing.evidence ?? {}) as Record<string, string>;
  const sourceKey = existing.type === 'tienda_cerrada' ? 'facade' : 'scale';
  if (evidence[sourceKey] && !evidence['arrival_exhibit']) {
    evidence['arrival_exhibit'] = evidence[sourceKey];
  }

  const { error } = await supabase
    .from('delivery_reports')
    .update({
      type: 'entrega',
      current_step: 'arrival_exhibit',
      evidence,
    })
    .eq('id', reportId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, data: undefined };
}

/**
 * Cierra un reporte de tipo `tienda_cerrada` o `bascula` como sin entrega.
 * Diferente a `submitReport` porque NO requiere tickets ni evidencia adicional.
 * La parada queda como `skipped` y la ruta puede continuar.
 */
export async function submitNonEntregaAction(
  reportId: string,
  resolutionType: ResolutionType = 'sin_entrega',
): Promise<Result<{ stopId: string }>> {
  const supabase = await createServerClient();
  const { data: existing, error: readErr } = await supabase
    .from('delivery_reports')
    .select('stop_id, route_id, type, status')
    .eq('id', reportId)
    .single();
  if (readErr) return { ok: false, error: readErr.message };
  if (existing.status !== 'draft') {
    return { ok: false, error: 'Reporte ya enviado' };
  }
  if (existing.type === 'entrega') {
    return { ok: false, error: 'Usa submitReport para reportes de tipo entrega' };
  }

  const nowIso = new Date().toISOString();
  const { error: reportErr } = await supabase
    .from('delivery_reports')
    .update({
      status: 'submitted',
      current_step: 'finish',
      resolution_type: resolutionType,
      submitted_at: nowIso,
    })
    .eq('id', reportId);
  if (reportErr) return { ok: false, error: `Report: ${reportErr.message}` };

  const { error: stopErr } = await supabase
    .from('stops')
    .update({ status: 'skipped', actual_departure_at: nowIso })
    .eq('id', existing.stop_id);
  if (stopErr) return { ok: false, error: `Stop: ${stopErr.message}` };

  // Auto-promover ruta a COMPLETED si todas las stops están done.
  const { data: pendingStops } = await supabase
    .from('stops')
    .select('id')
    .eq('route_id', existing.route_id)
    .in('status', ['pending', 'arrived']);
  if (!pendingStops || pendingStops.length === 0) {
    await supabase
      .from('routes')
      .update({ status: 'COMPLETED', actual_end_at: nowIso })
      .eq('id', existing.route_id);
  }

  revalidatePath(`/route/stop/${existing.stop_id}`);
  revalidatePath('/route');
  return { ok: true, data: { stopId: existing.stop_id } };
}
