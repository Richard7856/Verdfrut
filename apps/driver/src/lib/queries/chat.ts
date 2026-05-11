// Queries del chat — server side, con RLS.
// Ver ADR-021. Las INSERTs viven en server actions y/o el handler del outbox.

import 'server-only';
import { createServerClient } from '@tripdrive/supabase/server';
import type { ChatMessage, MessageSender } from '@tripdrive/types';

export function mapMessage(row: Record<string, unknown>): ChatMessage {
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
 * Lista los mensajes de un report en orden cronológico.
 * RLS filtra: el chofer solo ve sus reports, el zone_manager los de su zona.
 */
export async function listChatMessages(reportId: string): Promise<ChatMessage[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`[chat.list] ${error.message}`);
  return (data ?? []).map((row) => mapMessage(row as Record<string, unknown>));
}
