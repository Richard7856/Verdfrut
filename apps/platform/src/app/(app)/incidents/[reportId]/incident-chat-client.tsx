'use client';

// Cliente del chat del lado comercial.
// Coordina:
//  - useChatRealtime para suscripción a INSERTs.
//  - ChatComposerManager para enviar.
//  - resolveByManagerAction para cerrar el caso.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@verdfrut/ui';
import type { ChatMessage, ChatStatus } from '@verdfrut/types';
import { ChatThread, type OptimisticMessage } from '@/components/chat/chat-thread';
import { ChatComposerManager } from '@/components/chat/chat-composer-manager';
import { useChatRealtime } from '@/lib/use-chat-realtime';
import { resolveByManagerAction } from './actions';

interface Props {
  reportId: string;
  chatStatus: ChatStatus;
  initialMessages: ChatMessage[];
  viewerUserId: string;
}

export function IncidentChatClient({
  reportId,
  chatStatus,
  initialMessages,
}: Props) {
  const router = useRouter();
  const { messages } = useChatRealtime(reportId, initialMessages);
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const closed = chatStatus === 'driver_resolved' || chatStatus === 'manager_resolved' || chatStatus === 'timed_out';

  // Limpieza de optimistic cuando el server confirma — match por text aproximado.
  // (Idéntico al patrón del driver — si dos mensajes idénticos, dedup se afina cuando aparece.)
  const filteredOptimistic = optimistic.filter((opt) => {
    return !messages.some(
      (m) =>
        m.sender === 'zone_manager' &&
        m.text === (opt.text ?? null) &&
        (opt.imageUrl
          ? new Date(m.createdAt).getTime() >= new Date(opt.createdAt).getTime() - 2000
          : true),
    );
  });

  function handleResolve() {
    if (!confirm('¿Cerrar este caso?')) return;
    startTransition(async () => {
      const res = await resolveByManagerAction(reportId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      {error && (
        <div className="border-b border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-4 py-2 text-sm text-[var(--color-danger-fg)]">
          {error}
        </div>
      )}
      <ChatThread messages={messages} viewerRole="zone_manager" optimisticMessages={filteredOptimistic} />
      {!closed && (
        <div className="flex justify-end border-t border-[var(--color-border)] bg-[var(--vf-surface-2)] px-3 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={handleResolve} disabled={pending}>
            Cerrar caso
          </Button>
        </div>
      )}
      <ChatComposerManager
        reportId={reportId}
        disabled={closed}
        onPushOptimistic={(msg) => setOptimistic((prev) => [...prev, msg])}
        onError={setError}
      />
    </>
  );
}
