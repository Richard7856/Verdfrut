// Hook que mantiene un snapshot del outbox refrescado por cambios.

import { useEffect, useState } from 'react';
import { getSnapshot, subscribe, type OutboxSnapshot } from '@/lib/outbox';

const EMPTY: OutboxSnapshot = {
  counts: { pending: 0, in_flight: 0, failed: 0, done: 0 },
  items: [],
};

export function useOutboxSnapshot(): OutboxSnapshot {
  const [snapshot, setSnapshot] = useState<OutboxSnapshot>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const next = await getSnapshot();
        if (!cancelled) setSnapshot(next);
      } catch (err) {
        console.warn('[useOutboxSnapshot] refresh fail:', err);
      }
    }
    void refresh();
    const unsub = subscribe(() => void refresh());
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return snapshot;
}
