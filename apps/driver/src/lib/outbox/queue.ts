// API pública del outbox: enqueue, processOnce, retryFailed, etc.
// Ver ADR-019.

import {
  putItem,
  getItem,
  listAll,
  listByStatus,
  nextProcessable,
  purgeOldDone,
  resetInFlight,
} from './db';
// `purgeOldDone` se usa también con ttlMs=0 para GC agresivo en Quota error.
import { processItem } from './handlers';
import type { OutboxItem, OutboxPayload, OutboxStatus } from './types';

const MAX_ATTEMPTS_BEFORE_FAIL = 10;
const PROCESS_TIMEOUT_MS = 60_000; // Bug B / ADR-023 — corta cuelgues del server

function newId(): string {
  // crypto.randomUUID disponible en todos los browsers que soportan PWA modernas.
  // Fallback minimal por si algún WebView viejo no lo expone.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Listeners para que la UI reaccione (badge update). */
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* ignore — un listener roto no debe tirar el bus */ }
  }
}

/**
 * Encola una operación. Devuelve el id (UUID) por si quien llama quiere
 * trackearlo. La promesa resuelve cuando la operación queda persistida en
 * IndexedDB, NO cuando se aplica en el server.
 *
 * Manejo de QuotaExceededError (Bug D / ADR-023): si IDB rechaza por falta de
 * espacio, ejecuta GC agresivo (todos los `done`, no solo los >24h) y reintenta
 * una vez. Si vuelve a fallar, propaga el error para que el caller muestre UX.
 */
export async function enqueue(op: OutboxPayload): Promise<string> {
  const item: OutboxItem = {
    id: newId(),
    type: op.type,
    payload: op.payload,
    status: 'pending',
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    createdAt: Date.now(),
  };
  try {
    await putItem(item);
  } catch (err) {
    if (isQuotaError(err)) {
      // GC agresivo: borrar TODOS los `done` (no respetar TTL) para liberar.
      await purgeOldDone(Date.now(), 0);
      try {
        await putItem(item);
      } catch (err2) {
        if (isQuotaError(err2)) {
          throw new Error(
            'Espacio agotado: sincroniza tus pendientes antes de tomar más fotos o mensajes.',
          );
        }
        throw err2;
      }
    } else {
      throw err;
    }
  }
  notify();
  // Si estamos online, intentar procesar inmediatamente — UX más fluida cuando
  // hay red. El worker periódico es el respaldo para cuando vuelve la red.
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    // No await — el caller no debe esperar.
    void processOnce();
  }
  return item.id;
}

function isQuotaError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; code?: number };
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014
  );
}

/**
 * Procesa el siguiente item procesable (FIFO con backoff).
 * Devuelve true si procesó algo, false si no había nada listo.
 * Diseñado para ser llamado tanto desde el setInterval del worker como bajo
 * demanda al volver online o tras un enqueue.
 */
export async function processOnce(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  const now = Date.now();
  const item = await nextProcessable(now);
  if (!item) return false;

  // Marcar in_flight para que tickets concurrentes no lo tomen.
  await putItem({ ...item, status: 'in_flight', lastAttemptAt: now });
  notify();

  // Wrap con timeout para no atorar la cola si el server cuelga (Bug B).
  const result = await Promise.race([
    processItem(item),
    new Promise<{ kind: 'retry'; error: string }>((resolve) =>
      setTimeout(
        () => resolve({ kind: 'retry', error: `timeout (${PROCESS_TIMEOUT_MS}ms)` }),
        PROCESS_TIMEOUT_MS,
      ),
    ),
  ]);
  const fresh = (await getItem(item.id)) ?? item;

  if (result.kind === 'success' || result.kind === 'already_applied') {
    await putItem({ ...fresh, status: 'done', lastError: result.kind === 'already_applied' ? result.reason : null });
    notify();
    return true;
  }

  const newAttempts = fresh.attempts + 1;
  const newStatus: OutboxStatus =
    newAttempts >= MAX_ATTEMPTS_BEFORE_FAIL || result.kind === 'fatal' ? 'failed' : 'pending';

  await putItem({
    ...fresh,
    status: newStatus,
    attempts: newAttempts,
    lastError: result.kind === 'fatal' ? result.error : result.kind === 'retry' ? result.error : null,
    lastAttemptAt: Date.now(),
  });
  notify();
  return true;
}

/**
 * Reintenta items en estado `failed` (retry manual desde la UI).
 * Los pasa de vuelta a `pending` con attempts=0 para que el worker los retome.
 */
export async function retryFailed(): Promise<number> {
  const failed = await listByStatus('failed');
  for (const item of failed) {
    await putItem({ ...item, status: 'pending', attempts: 0, lastError: null, lastAttemptAt: null });
  }
  notify();
  return failed.length;
}

/** Snapshot para la UI: cuántos pendientes, cuántos failed, total no-done. */
export interface OutboxSnapshot {
  pending: number;
  inFlight: number;
  failed: number;
  done: number;
  total: number;
  /** Cuántos items "preocupan" al chofer — no incluye done. */
  pendingTotal: number;
}

export async function snapshot(): Promise<OutboxSnapshot> {
  const all = await listAll();
  const out: OutboxSnapshot = {
    pending: 0,
    inFlight: 0,
    failed: 0,
    done: 0,
    total: all.length,
    pendingTotal: 0,
  };
  for (const it of all) {
    if (it.status === 'pending') out.pending++;
    else if (it.status === 'in_flight') out.inFlight++;
    else if (it.status === 'failed') out.failed++;
    else if (it.status === 'done') out.done++;
  }
  out.pendingTotal = out.pending + out.inFlight + out.failed;
  return out;
}

/** Lista todos los items para UI de detalle. */
export async function listItems(): Promise<OutboxItem[]> {
  return listAll();
}

/** Limpieza periódica — items done > 24h se borran. */
export async function gc(): Promise<number> {
  const removed = await purgeOldDone(Date.now());
  if (removed > 0) notify();
  return removed;
}

/**
 * Recupera items in_flight de una sesión anterior (Bug A / ADR-023).
 * Llamado al mount del worker. Idempotente.
 */
export async function recoverInFlight(): Promise<number> {
  const n = await resetInFlight();
  if (n > 0) notify();
  return n;
}
