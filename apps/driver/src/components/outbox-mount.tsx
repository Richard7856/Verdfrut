'use client';

// Componente cliente que monta el worker del outbox.
// Lo incluye el layout de driver una vez para que corra durante toda la sesión.
// No renderiza UI — el badge es independiente porque puede ir en distintas
// pantallas según necesite el flujo.

import { useOutboxWorker } from '@/lib/outbox/use-outbox-worker';

export function OutboxMount() {
  useOutboxWorker();
  return null;
}
