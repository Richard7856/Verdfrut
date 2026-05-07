'use client';

// Pantalla del chat (driver). Coordina:
//  - Realtime: useChatRealtime suscribe a INSERTs de messages.
//  - Composer: encola via outbox.
//  - Optimistic state: los mensajes recién enviados aparecen al instante con
//    label "Enviando…" hasta que el INSERT real llega (mismo content + sender).
//  - Auto-summary del incident_cart: si el chofer entra al chat por primera vez
//    y hay incidencias, se envía como primer mensaje (cierra issue #18).
//  - Timer 20 min: cuenta regresiva desde chat_opened_at.
//  - Botón "Marcar resuelto": encola resolve_chat_by_driver.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@verdfrut/ui';
import type { ChatMessage, DeliveryReport } from '@verdfrut/types';
import { ChatThread, type OptimisticMessage } from '@/components/chat/chat-thread';
import { ChatComposerDriver } from '@/components/chat/chat-composer-driver';
import { useChatRealtime } from '@/lib/use-chat-realtime';
import { enqueue } from '@/lib/outbox';

interface Props {
  report: DeliveryReport;
  stopId: string;
  routeId: string;
  storeName: string;
  userId: string;
  initialMessages: ChatMessage[];
}

export function ChatPageClient({
  report,
  stopId,
  routeId,
  storeName,
  userId,
  initialMessages,
}: Props) {
  const router = useRouter();
  const { messages } = useChatRealtime(report.id, initialMessages);
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([]);
  const initialSummarySent = useRef(false);

  // Limpieza de optimistic cuando el server confirma — comparamos por text+imageUrl.
  // No es perfecto (dos mensajes idénticos chocan) pero práctico.
  useEffect(() => {
    setOptimistic((prev) =>
      prev.filter((opt) => {
        return !messages.some(
          (m) =>
            m.sender === 'driver' &&
            m.text === (opt.text ?? null) &&
            // Para fotos, no podemos comparar URLs (local vs storage). Filtramos
            // por timestamp aproximado: si el server tiene un mensaje del driver
            // creado >= 1s antes que el optimistic, asumimos match.
            (opt.imageUrl
              ? new Date(m.createdAt).getTime() >= new Date(opt.createdAt).getTime() - 1000
              : true),
        );
      }),
    );
  }, [messages]);

  // Auto-mensaje inicial: summary del incident_cart en flujo entrega.
  // Solo se envía si NO hay mensajes previos del chofer (evita duplicar al
  // recargar la página).
  useEffect(() => {
    if (initialSummarySent.current) return;
    const driverHasMessages = messages.some((m) => m.sender === 'driver');
    if (driverHasMessages) {
      initialSummarySent.current = true;
      return;
    }
    if (report.type !== 'entrega') return;
    if (!report.incidentDetails || report.incidentDetails.length === 0) return;

    initialSummarySent.current = true;
    const summary = formatIncidentSummary(report.incidentDetails);
    const localId = `summary-${Date.now()}`;
    setOptimistic((prev) => [
      ...prev,
      { localId, text: summary, createdAt: new Date().toISOString() },
    ]);
    void enqueue({
      type: 'send_chat_message',
      payload: { reportId: report.id, text: summary },
    });
  }, [messages, report]);

  const chatClosed = report.chatStatus === 'driver_resolved' ||
    report.chatStatus === 'manager_resolved' ||
    report.chatStatus === 'timed_out';

  function handleResolve() {
    if (!confirm('¿Marcar este caso como resuelto?')) return;
    void enqueue({
      type: 'resolve_chat_by_driver',
      payload: { reportId: report.id },
    });
    router.replace(`/route/stop/${stopId}`);
  }

  return (
    <main className="flex h-dvh flex-col bg-[var(--vf-bg)] safe-top">
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--vf-surface-1)] px-4 py-3">
        <Link
          href={`/route/stop/${stopId}`}
          aria-label="Volver al detalle de parada"
          className="text-2xl text-[var(--color-text-muted)]"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--color-text)]">
            Chat — {storeName}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {chatClosed ? 'Caso cerrado' : <ChatTimer report={report} />}
          </p>
        </div>
        {!chatClosed && (
          <Button type="button" variant="ghost" size="sm" onClick={handleResolve}>
            Resolver
          </Button>
        )}
      </header>

      <ChatThread
        messages={messages}
        viewerRole="driver"
        optimisticMessages={optimistic}
      />

      <ChatComposerDriver
        reportId={report.id}
        routeId={routeId}
        stopId={stopId}
        userId={userId}
        disabled={chatClosed}
        onPushOptimistic={(msg) => setOptimistic((prev) => [...prev, msg])}
      />
    </main>
  );
}

/** Render del summary inicial — formato bullets para el comercial. */
function formatIncidentSummary(items: DeliveryReport['incidentDetails']): string {
  const lines = items.map((it) => {
    const tipo = it.type === 'rechazo' ? 'Rechazo'
      : it.type === 'faltante' ? 'Faltante'
      : it.type === 'sobrante' ? 'Sobrante'
      : 'Devolución';
    const note = it.notes ? ` — ${it.notes}` : '';
    return `• ${it.quantity} ${it.unit} de ${it.productName} (${tipo})${note}`;
  });
  return `Incidencias en esta parada:\n${lines.join('\n')}`;
}

function ChatTimer({ report }: { report: DeliveryReport }) {
  // Timer regresivo de 20 min desde chat_opened_at.
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(i);
  }, []);

  if (!report.timeoutAt) {
    return <span className="text-[var(--color-text-muted)]">Esperando primer mensaje…</span>;
  }
  const ms = new Date(report.timeoutAt).getTime() - Date.now();
  if (ms <= 0) {
    return <span className="text-[var(--color-danger-fg)]">Tiempo agotado</span>;
  }
  const totalMin = Math.ceil(ms / 60_000);
  return <span>⏱ {totalMin} min restantes</span>;
}
