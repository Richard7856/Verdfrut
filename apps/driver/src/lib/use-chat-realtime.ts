'use client';

// Hook que mantiene una lista local de mensajes sincronizada con Postgres changes
// vía Supabase Realtime. ADR-021.
//
// Uso típico:
//   const { messages } = useChatRealtime(reportId, initialMessages);
//
// Filtra por report_id en el server (Supabase Realtime aplica el filtro al canal).
// RLS también aplica — un usuario sin acceso al report no recibirá eventos.
//
// Cuando vuelve el foco a la pestaña, hace un refetch de seguridad por si
// perdimos eventos durante un freeze del WebSocket (caso típico iOS Safari).

import { useEffect, useState, useCallback } from 'react';
import { createBrowserClient } from '@tripdrive/supabase/browser';
import type { ChatMessage, MessageSender } from '@tripdrive/types';

function rowToMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: row.id as string,
    reportId: row.report_id as string,
    sender: row.sender as MessageSender,
    senderUserId: (row.sender_user_id as string | null) ?? null,
    text: (row.text as string | null) ?? null,
    imageUrl: (row.image_url as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export function useChatRealtime(reportId: string, initial: ChatMessage[]) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);

  // Refetch usado al focus o reconexión del WebSocket.
  const refetch = useCallback(async () => {
    const supabase = createBrowserClient();
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true });
    if (data) {
      setMessages(data.map((row) => rowToMessage(row as Record<string, unknown>)));
    }
  }, [reportId]);

  useEffect(() => {
    const supabase = createBrowserClient();
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
          const newMsg = rowToMessage(payload.new as Record<string, unknown>);
          setMessages((prev) => {
            // Dedup por id — si ya está, no agregamos.
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        },
      )
      .subscribe();

    function onFocus() {
      void refetch();
    }
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      supabase.removeChannel(channel);
    };
  }, [reportId, refetch]);

  return { messages, refetch };
}
