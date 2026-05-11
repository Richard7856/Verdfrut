'use client';

// Hook idéntico al de driver — duplicado deliberado por ADR-021.
// Suscribe a postgres_changes en `messages` filtrado por report_id.

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
