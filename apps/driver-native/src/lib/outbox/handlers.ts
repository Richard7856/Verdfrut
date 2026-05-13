// Handlers de operaciones del outbox. Cada handler implementa el commit
// real a Supabase. Diseñados como idempotentes — si un retry llega después
// de una primera ejecución parcialmente exitosa, debe converger igual.

import { supabase } from '@/lib/supabase';
import { uploadEvidence } from '@/lib/storage';
import type { SubmitDeliveryPayload } from './types';

export interface HandlerResult {
  ok: boolean;
  /** Sólo presente si !ok. Categoría rough para decidir retry. */
  category?: 'network' | 'auth' | 'data' | 'unknown';
  error?: string;
}

export async function handleSubmitDelivery(
  payload: SubmitDeliveryPayload,
  opCreatedAtMs: number,
): Promise<HandlerResult> {
  // 1. Subir foto del exhibidor al bucket público `evidence`.
  let exhibitUrl: string;
  try {
    const res = await uploadEvidence({
      bucket: 'evidence',
      routeId: payload.routeId,
      stopId: payload.stopId,
      slot: 'arrival_exhibit',
      localUri: payload.exhibitLocalUri,
      userId: payload.userId,
      timestampMs: opCreatedAtMs,
    });
    exhibitUrl = res.url;
  } catch (err) {
    return {
      ok: false,
      category: classifyError(err),
      error: `exhibit upload: ${msg(err)}`,
    };
  }

  // 2. Subir ticket al bucket privado `ticket-images`.
  let ticketUrl: string;
  try {
    const res = await uploadEvidence({
      bucket: 'ticket-images',
      routeId: payload.routeId,
      stopId: payload.stopId,
      slot: 'ticket',
      localUri: payload.ticketLocalUri,
      userId: payload.userId,
      timestampMs: opCreatedAtMs,
    });
    ticketUrl = res.url;
  } catch (err) {
    return {
      ok: false,
      category: classifyError(err),
      error: `ticket upload: ${msg(err)}`,
    };
  }

  // 3. Subir merma si aplica.
  let mermaUrl: string | null = null;
  if (payload.hasMerma && payload.mermaPhotoLocalUri) {
    try {
      const res = await uploadEvidence({
        bucket: 'ticket-images',
        routeId: payload.routeId,
        stopId: payload.stopId,
        slot: 'merma',
        localUri: payload.mermaPhotoLocalUri,
        userId: payload.userId,
        timestampMs: opCreatedAtMs,
      });
      mermaUrl = res.url;
    } catch (err) {
      return {
        ok: false,
        category: classifyError(err),
        error: `merma upload: ${msg(err)}`,
      };
    }
  }

  // 4. Insertar delivery_report. UNIQUE(stop_id) garantiza idempotencia:
  // si ya existe, lo tomamos como already-applied y seguimos al stop update.
  const evidence: Record<string, string> = { arrival_exhibit: exhibitUrl };
  if (mermaUrl) evidence['merma_ticket'] = mermaUrl;

  const nowIso = new Date().toISOString();
  const { error: insErr } = await supabase.from('delivery_reports').insert({
    stop_id: payload.stopId,
    route_id: payload.routeId,
    driver_id: payload.driverId,
    zone_id: payload.zoneId,
    store_id: payload.storeId,
    store_code: payload.storeCode,
    store_name: payload.storeName,
    type: 'entrega',
    status: 'submitted',
    current_step: 'finish',
    evidence,
    ticket_image_url: ticketUrl,
    ticket_data: payload.ticketData,
    ticket_extraction_confirmed: payload.ticketExtractionConfirmed,
    has_merma: payload.hasMerma,
    other_incident_description: payload.otherIncidentDescription,
    resolution_type: 'completa',
    submitted_at: nowIso,
  });

  if (insErr && !/duplicate key|unique constraint/i.test(insErr.message)) {
    return {
      ok: false,
      category: classifyError(insErr),
      error: `delivery_reports insert: ${insErr.message}`,
    };
  }

  // 5. Marcar el stop como completed. Idempotente — SET dos veces es OK.
  const { error: stopErr } = await supabase
    .from('stops')
    .update({ status: 'completed', actual_departure_at: nowIso })
    .eq('id', payload.stopId);
  if (stopErr) {
    return {
      ok: false,
      category: classifyError(stopErr),
      error: `stops update: ${stopErr.message}`,
    };
  }

  // 6. Auto-promover ruta a COMPLETED si todas las stops están done.
  // Best-effort — si falla este UPDATE no rompemos el flujo (el supervisor
  // puede cerrar manualmente).
  try {
    const { data: pendingStops } = await supabase
      .from('stops')
      .select('id')
      .eq('route_id', payload.routeId)
      .in('status', ['pending', 'arrived']);
    if (!pendingStops || pendingStops.length === 0) {
      await supabase
        .from('routes')
        .update({ status: 'COMPLETED', actual_end_at: nowIso })
        .eq('id', payload.routeId);
    }
  } catch (err) {
    console.warn('[outbox.handleSubmitDelivery] route auto-complete falló:', err);
  }

  return { ok: true };
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function classifyError(err: unknown): HandlerResult['category'] {
  const m = msg(err).toLowerCase();
  if (/network|fetch|timeout|abort/.test(m)) return 'network';
  if (/jwt|token|auth|forbidden/.test(m)) return 'auth';
  if (/duplicate|constraint|invalid/.test(m)) return 'data';
  return 'unknown';
}
