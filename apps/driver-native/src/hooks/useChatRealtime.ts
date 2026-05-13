// Hook que mantiene la lista de mensajes sincronizada con Postgres changes
// vía Supabase Realtime. Mismo patrón que el web `use-chat-realtime.ts`.
//
// - Subscribe a postgres_changes con filter `report_id=eq.X`.
// - Refetch al volver foreground (AppState 'active') por si el WS quedó dormido.
// - Dedup por id en caso de doble-deliver (rare race con echo).

import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { ChatMessage } from '@tripdrive/types';
import { supabase } from '@/lib/supabase';
import { listMessages, toChatMessage } from '@/lib/queries/messages';

interface UseChatRealtimeState {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useChatRealtime(reportId: string | null): UseChatRealtimeState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!reportId) return;
    try {
      const list = await listMessages(reportId);
      setMessages(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar chat');
    } finally {
      setIsLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    if (!reportId) {
      setIsLoading(false);
      return;
    }
    void refetch();
  }, [reportId, refetch]);

  useEffect(() => {
    if (!reportId) return;
    const channel = supabase
      .channel(`chat:${reportId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `report_id=eq.${reportId}`,
        },
        (payload) => {
          const newMsg = toChatMessage(payload.new as never);
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [reportId]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refetch();
    });
    return () => sub.remove();
  }, [refetch]);

  return { messages, isLoading, error, refetch };
}
