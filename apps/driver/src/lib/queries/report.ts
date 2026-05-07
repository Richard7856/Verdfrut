// Queries y helpers de DeliveryReport.
// El report es 1-a-1 con stop. Se crea cuando el chofer marca arrival.

import 'server-only';
import { createServerClient } from '@verdfrut/supabase/server';
import type {
  ChatStatus,
  DeliveryReport,
  IncidentDetail,
  ReportStatus,
  ReportType,
  ResolutionType,
  TicketData,
} from '@verdfrut/types';

/**
 * Mapper de la fila DB a domain object. Usado por queries y server actions.
 * Centralizado aquí para no duplicar parseo de JSON.
 */
export function mapDeliveryReport(row: Record<string, unknown>): DeliveryReport {
  const get = <T>(k: string): T => row[k] as T;
  return {
    id: get<string>('id'),
    stopId: get<string>('stop_id'),
    routeId: get<string>('route_id'),
    driverId: get<string>('driver_id'),
    zoneId: get<string>('zone_id'),
    storeId: get<string>('store_id'),
    storeCode: get<string>('store_code'),
    storeName: get<string>('store_name'),
    type: get<ReportType>('type'),
    status: get<ReportStatus>('status'),
    currentStep: get<string>('current_step'),
    evidence: (get<Record<string, string>>('evidence') ?? {}) as Record<string, string>,
    ticketData: get<TicketData | null>('ticket_data'),
    ticketImageUrl: get<string | null>('ticket_image_url'),
    ticketExtractionConfirmed: get<boolean>('ticket_extraction_confirmed'),
    returnTicketData: get<TicketData | null>('return_ticket_data'),
    returnTicketExtractionConfirmed: get<boolean>('return_ticket_extraction_confirmed'),
    incidentDetails: (get<IncidentDetail[]>('incident_details') ?? []) as IncidentDetail[],
    resolutionType: get<ResolutionType | null>('resolution_type'),
    partialFailureItems: get<IncidentDetail[] | null>('partial_failure_items'),
    noTicketReason: get<string | null>('no_ticket_reason'),
    noTicketReasonPhotoUrl: get<string | null>('no_ticket_reason_photo_url'),
    otherIncidentDescription: get<string | null>('other_incident_description'),
    otherIncidentPhotoUrl: get<string | null>('other_incident_photo_url'),
    hasMerma: get<boolean>('has_merma'),
    metadata: (get<Record<string, unknown>>('metadata') ?? {}) as Record<string, unknown>,
    submittedAt: get<string | null>('submitted_at'),
    timeoutAt: get<string | null>('timeout_at'),
    resolvedAt: get<string | null>('resolved_at'),
    chatOpenedAt: get<string | null>('chat_opened_at'),
    chatStatus: get<ChatStatus | null>('chat_status'),
    createdAt: get<string>('created_at'),
  };
}

/**
 * Devuelve un report por id (con RLS — solo el chofer dueño lo ve).
 */
export async function getReport(id: string): Promise<DeliveryReport | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('delivery_reports')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`[report.get] ${error.message}`);
  return data ? mapDeliveryReport(data as Record<string, unknown>) : null;
}
