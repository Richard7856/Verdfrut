'use client';

// Hook reactivo que devuelve el snapshot actual del outbox.
// Se actualiza al llamarse subscribe() desde queue.ts en cada cambio.

import { useEffect, useState } from 'react';
import { snapshot, subscribe, type OutboxSnapshot } from './queue';

const EMPTY: OutboxSnapshot = {
  pending: 0,
  inFlight: 0,
  failed: 0,
  done: 0,
  total: 0,
  pendingTotal: 0,
};

export function useOutboxSnapshot(): OutboxSnapshot {
  const [state, setState] = useState<OutboxSnapshot>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const s = await snapshot();
      if (!cancelled) setState(s);
    }
    void refresh();
    const unsub = subscribe(() => { void refresh(); });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return state;
}
