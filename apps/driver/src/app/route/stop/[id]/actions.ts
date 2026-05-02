'use server';

// Server Actions del flujo de la parada.
// Toda mutación de delivery_reports y stops del chofer pasa por aquí.
// Aplican RLS — el chofer solo puede tocar sus propios datos.

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@verdfrut/supabase/server';
import type { TableUpdate } from '@verdfrut/supabase';
import { getStopContext } from '@/lib/queries/stop';
import { mapDeliveryReport } from '@/lib/queries/report';
import { getInitialStep } from '@verdfrut/flow-engine';
import type {
  DeliveryReport,
  IncidentDetail,
  ReportType,
  ResolutionType,
} from '@verdfrut/types';

export interface ActionOk<T = void> {
  ok: true;
  data: T;
}
export interface ActionErr {
  ok: false;
  error: string;
}
export type Result<T = void> = ActionOk<T> | ActionErr;

/**
 * Marca la llegada a la parada y abre un draft delivery_report con el flujo elegido.
 * Idempotente: si ya existe un report no-draft, lo devuelve. Si existe un draft, lo recicla.
 */
export async function arriveAtStop(
  stopId: string,
  type: ReportType = 'entrega',
): Promise<Result<DeliveryReport>> {
  const supabase = await createServerClient();
  const ctx = await getStopContext(stopId);
  if (!ctx) return { ok: false, error: 'Parada no encontrada o sin acceso' };

  // Si ya hay un report en curso, devolverlo. No queremos doble insert.
  if (ctx.report) {
    return { ok: true, data: ctx.report };
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
 * usando @verdfrut/flow-engine; el server confía y persiste.
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
