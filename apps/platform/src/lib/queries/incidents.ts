// Queries del lado platform — bandeja del comercial.
// El zone_manager ve los reports cuyo zone_id matchea su zona (RLS aplica).
// Admin/dispatcher ven todos.

import 'server-only';
import { createServerClient } from '@tripdrive/supabase/server';
import type {
  ChatMessage,
  ChatStatus,
  DeliveryReport,
  IncidentDetail,
  MessageSender,
  ReportStatus,
  ReportType,
  ResolutionType,
  TicketData,
} from '@tripdrive/types';

function mapDeliveryReport(row: Record<string, unknown>): DeliveryReport {
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

function mapMessage(row: Record<string, unknown>): ChatMessage {
  const get = <T>(k: string): T => row[k] as T;
  return {
    id: get<string>('id'),
    reportId: get<string>('report_id'),
    sender: get<MessageSender>('sender'),
    senderUserId: get<string | null>('sender_user_id'),
    text: get<string | null>('text'),
    imageUrl: get<string | null>('image_url'),
    createdAt: get<string>('created_at'),
  };
}

/**
 * Lista los reports con chat abierto o que requieren atención del comercial.
 * RLS filtra por zona automáticamente.
 *
 * Criterios:
 *   - chat_status = 'open' (en progreso)
 *   - O resolved_at NULL Y chat_opened_at NOT NULL (todavía sin cerrar formalmente)
 */
export async function listOpenIncidents(): Promise<DeliveryReport[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('delivery_reports')
    .select('*')
    .not('chat_opened_at', 'is', null)
    .order('chat_opened_at', { ascending: false });
  if (error) throw new Error(`[incidents.list] ${error.message}`);
  return (data ?? []).map((row) => mapDeliveryReport(row as Record<string, unknown>));
}

export async function getIncident(reportId: string): Promise<DeliveryReport | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('delivery_reports')
    .select('*')
    .eq('id', reportId)
    .maybeSingle();
  if (error) throw new Error(`[incidents.get] ${error.message}`);
  return data ? mapDeliveryReport(data as Record<string, unknown>) : null;
}

export async function listIncidentMessages(reportId: string): Promise<ChatMessage[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`[incidents.messages] ${error.message}`);
  return (data ?? []).map((row) => mapMessage(row as Record<string, unknown>));
}
