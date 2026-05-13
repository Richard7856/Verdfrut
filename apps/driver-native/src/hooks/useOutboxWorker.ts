// Arranca el worker del outbox cuando la app tiene sesión activa.
// Se monta una sola vez en el (driver) layout.
//
// Decisión: NO detenemos el worker al desmontar el layout (caso de navegar
// dentro de (driver)) — el worker es un singleton global. Sólo lo detenemos
// al `signOut` (helper en lib/auth.ts).

import { useEffect } from 'react';
import { isStarted, startOutboxWorker } from '@/lib/outbox';

export function useOutboxWorker(): void {
  useEffect(() => {
    if (isStarted()) return;
    void startOutboxWorker();
  }, []);
}
