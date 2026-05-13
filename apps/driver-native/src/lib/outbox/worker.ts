// Worker del outbox — corre periódicamente y procesa items pendientes.
//
// Diseño:
//   - Singleton. Start/stop expuestos para que el hook de UI los controle.
//   - Poll cada POLL_INTERVAL_MS. Adicional: kick manual via `tickNow()`
//     (después de enqueue, o al volver online según NetInfo).
//   - Reset de items huérfanos `in_flight` al primer arranque (crash recovery).
//   - Backoff exponencial por item: 5s · 30s · 5min · 30min, cap 1h.
//   - Tras MAX_ATTEMPTS=10 marca `failed` permanente (espera intervención).
//
// El worker NO conoce las pantallas — sólo procesa la queue. La UI se
// suscribe via `queue.subscribe()` para refrescar contadores.

import NetInfo from '@react-native-community/netinfo';
import {
  deleteItem,
  listByStatus,
  resetOrphanedInFlight,
  updateItem,
} from './db';
import { handleSubmitDelivery } from './handlers';
import { deletePhotosForOp, notifyChange } from './queue';
import type { OutboxItem, SubmitDeliveryPayload } from './types';
import { parsePayload } from './types';

const POLL_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 10;

let timer: ReturnType<typeof setInterval> | null = null;
let netUnsubscribe: (() => void) | null = null;
let inProgress = false;
let started = false;
let lastNetIsOnline: boolean | null = null;

function backoffMs(attempts: number): number {
  // 5s · 30s · 5min · 30min, cap 1h.
  const ladder = [5_000, 30_000, 300_000, 1_800_000, 3_600_000];
  const idx = Math.min(attempts - 1, ladder.length - 1);
  return idx >= 0 ? ladder[idx] : 0;
}

function isReadyToRetry(item: OutboxItem): boolean {
  if (item.status === 'pending') return true;
  if (item.status !== 'failed') return false;
  if (item.attempts >= MAX_ATTEMPTS) return false; // dead-lettered
  const wait = backoffMs(item.attempts);
  const elapsed = Date.now() - (item.lastAttemptAt ?? item.createdAt);
  return elapsed >= wait;
}

async function processItem(item: OutboxItem): Promise<void> {
  await updateItem(item.id, {
    status: 'in_flight',
    attempts: item.attempts + 1,
    lastAttemptAt: Date.now(),
  });
  notifyChange();

  let result;
  try {
    if (item.type === 'submit_delivery') {
      const payload = parsePayload<SubmitDeliveryPayload>(item);
      result = await handleSubmitDelivery(payload, item.createdAt);
    } else {
      result = { ok: false, category: 'unknown' as const, error: `tipo desconocido: ${item.type}` };
    }
  } catch (err) {
    result = {
      ok: false,
      category: 'unknown' as const,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (result.ok) {
    await deletePhotosForOp(item.id);
    await deleteItem(item.id);
  } else {
    await updateItem(item.id, {
      status: 'failed',
      lastError: result.error ?? 'unknown',
    });
  }
  notifyChange();
}

async function tick(): Promise<void> {
  if (inProgress) return;
  inProgress = true;
  try {
    // Solo procesar si hay red.
    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      lastNetIsOnline = false;
      return;
    }
    lastNetIsOnline = true;

    const pending = await listByStatus('pending');
    const failed = await listByStatus('failed');
    const all = [...pending, ...failed].sort((a, b) => a.createdAt - b.createdAt);

    for (const item of all) {
      if (!isReadyToRetry(item)) continue;
      await processItem(item);
    }
  } catch (err) {
    console.warn('[outbox.worker.tick]', err);
  } finally {
    inProgress = false;
  }
}

export async function start(): Promise<void> {
  if (started) return;
  started = true;
  await resetOrphanedInFlight();
  notifyChange();

  // Poll loop.
  timer = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);

  // Trigger inmediato si volvemos online.
  netUnsubscribe = NetInfo.addEventListener((state) => {
    const nowOnline = Boolean(state.isConnected);
    if (nowOnline && lastNetIsOnline === false) {
      lastNetIsOnline = true;
      void tick();
    } else {
      lastNetIsOnline = nowOnline;
    }
  });

  // Primer tick inmediato — si hay items pendientes desde la sesión anterior,
  // empezar a procesarlos sin esperar 30s.
  void tick();
}

export function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (netUnsubscribe) netUnsubscribe();
  netUnsubscribe = null;
  started = false;
}

/** Útil para "Reintentar ahora" tras un enqueue. */
export async function tickNow(): Promise<void> {
  await tick();
}

export function isStarted(): boolean {
  return started;
}
