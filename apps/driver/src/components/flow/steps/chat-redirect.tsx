'use client';

// Step `chat_redirect` — abre el chat real con el zone_manager.
// ADR-021. La pantalla de chat vive en `/route/stop/[id]/chat` y maneja
// realtime, summary inicial del incident_cart, timer de 20 min y resolución.
//
// Este step es un "shell" con dos opciones:
//   1. "Abrir chat" → push de /route/stop/[id]/chat
//   2. "Continuar" → avanza al siguiente step (`tienda_abierta_check` en
//      cerrada/báscula, o `product_arranged` en flujo entrega)
//
// El chofer puede entrar y salir del chat libremente — el flow del stop sigue
// detrás. Cuando regresa al detail, el step sigue siendo chat_redirect hasta
// que él toque "Continuar" / "Resolver desde el chat".

import Link from 'next/link';
import { Button, Card } from '@verdfrut/ui';
import { StepShell } from '../step-shell';
import type { StepProps } from '../stop-detail-client';

export function ChatRedirectStep(props: StepProps) {
  const { report, pending, error, advanceTo, nextOf } = props;
  const chatHref = `/route/stop/${report.stopId}/chat`;

  // Si el chat ya fue resuelto o se acabó el tiempo, mostramos una nota distinta
  // pero igualmente dejamos continuar.
  const chatClosed =
    report.chatStatus === 'driver_resolved' ||
    report.chatStatus === 'manager_resolved' ||
    report.chatStatus === 'timed_out';

  return (
    <StepShell
      title="Avisa al comercial"
      description="Abre el chat para coordinar con tu encargado. Tienes 20 min para llegar a un acuerdo; si no responde puedes continuar."
      onContinue={() => advanceTo(nextOf({}))}
      pending={pending}
      error={error}
      continueLabel="Continuar"
    >
      <Link href={chatHref} className="block">
        <Button type="button" variant="primary" size="lg" className="w-full">
          💬 {report.chatOpenedAt ? 'Abrir chat' : 'Abrir chat con el comercial'}
        </Button>
      </Link>
      {chatClosed && (
        <Card className="border-[var(--color-border)] bg-[var(--vf-surface-2)]">
          <p className="text-sm text-[var(--color-text)]">
            El caso fue {report.chatStatus === 'timed_out' ? 'cerrado por tiempo agotado' : 'marcado como resuelto'}.
          </p>
        </Card>
      )}
    </StepShell>
  );
}
