// Queries para el chat — historial de mensajes y resolver el report_id
// del stop actual.
//
// RLS protege: el chofer sólo ve mensajes de sus propios reports (vía la
// policy de delivery_reports que entra en cascada).

import type { ChatMessage, MessageSender } from '@tripdrive/types';
import { supabase } from '@/lib/supabase';

interface MessageRow {
  id: string;
  report_id: string;
  sender: MessageSender;
  sender_user_id: string | null;
  text: string | null;
  image_url: string | null;
  created_at: string;
}

export function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    reportId: row.report_id,
    sender: row.sender,
    senderUserId: row.sender_user_id,
    text: row.text,
    imageUrl: row.image_url,
    createdAt: row.created_at,
  };
}

export async function listMessages(reportId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, report_id, sender, sender_user_id, text, image_url, created_at')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`[messages.list] ${error.message}`);
  return (data ?? []).map((row) => toChatMessage(row as MessageRow));
}

/**
 * Resuelve el `delivery_report.id` asociado a un stop. NULL si el stop aún
 * no tiene reporte (chofer no ha llegado / no ha hecho submit).
 * Sin report no hay chat — la UI lo informa al user.
 */
export async function getReportIdForStop(stopId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('delivery_reports')
    .select('id')
    .eq('stop_id', stopId)
    .maybeSingle();
  if (error) throw new Error(`[messages.reportForStop] ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}
