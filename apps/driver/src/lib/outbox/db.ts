// IndexedDB wrapper para el outbox.
// Ver ADR-019. Una sola DB ('verdfrut-driver-outbox'), un object store ('items')
// con índice secundario por status para listar pendientes rápido.

import { openDB, type IDBPDatabase } from 'idb';
import type { OutboxItem, OutboxStatus } from './types';

const DB_NAME = 'verdfrut-driver-outbox';
const DB_VERSION = 1;
const STORE = 'items';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  // Lazy singleton — IndexedDB tarda decenas de ms en abrir; solo lo hacemos
  // al primer uso real. SSR-safe porque solo corre en handlers cliente.
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('outbox DB requires window'));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          // Índices para queries eficientes:
          //  - status: listar pendientes / failed
          //  - createdAt: ordenar FIFO
          store.createIndex('by_status', 'status');
          store.createIndex('by_createdAt', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}

export async function putItem(item: OutboxItem): Promise<void> {
  const db = await getDb();
  await db.put(STORE, item);
}

export async function getItem(id: string): Promise<OutboxItem | undefined> {
  const db = await getDb();
  return db.get(STORE, id);
}

export async function deleteItem(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

export async function listAll(): Promise<OutboxItem[]> {
  const db = await getDb();
  // Orden FIFO por createdAt — getAll del índice sale ordenado.
  return db.getAllFromIndex(STORE, 'by_createdAt');
}

export async function listByStatus(status: OutboxStatus): Promise<OutboxItem[]> {
  const db = await getDb();
  return db.getAllFromIndex(STORE, 'by_status', status);
}

/**
 * Operaciones terminales (cierran el report). NO deben procesarse hasta que
 * todos los items previos para el mismo reportId hayan terminado en done. Bug C.
 */
const TERMINAL_OPS = new Set(['submit_report', 'submit_non_entrega']);

function readPayloadReportId(item: OutboxItem): string | null {
  const p = item.payload as { reportId?: string } | null;
  return p?.reportId ?? null;
}

/**
 * Toma el siguiente item procesable (pending o failed marcado para retry manual).
 * Excluye los `in_flight` (otro tick del worker los está procesando) y `done`.
 * Respeta backoff: si lastAttemptAt + backoff(attempts) > ahora, lo salta.
 *
 * Barrera de reportId (Bug C / ADR-023): si el item es terminal (submit_*),
 * verificamos que NO haya items previos en pending/in_flight/failed para el
 * mismo reportId. Si los hay, saltamos el terminal — espera su turno.
 */
export async function nextProcessable(now: number): Promise<OutboxItem | null> {
  const all = await listAll();
  for (const item of all) {
    if (item.status === 'done') continue;
    if (item.status === 'in_flight') continue;
    if (item.status === 'failed') continue; // solo retry manual
    if (item.lastAttemptAt != null) {
      const wait = Math.min(1000 * 2 ** item.attempts, 30_000);
      if (now - item.lastAttemptAt < wait) continue;
    }

    // Barrera para terminales: no procesar submit hasta que las dependencias
    // (uploads, set_evidence, advance_step previos) estén done.
    if (TERMINAL_OPS.has(item.type)) {
      const reportId = readPayloadReportId(item);
      if (reportId) {
        const blocking = all.find(
          (other) =>
            other.id !== item.id &&
            (other.status === 'pending' ||
              other.status === 'in_flight' ||
              other.status === 'failed') &&
            !TERMINAL_OPS.has(other.type) &&
            readPayloadReportId(other) === reportId &&
            other.createdAt <= item.createdAt,
        );
        if (blocking) continue;
      }
    }

    return item;
  }
  return null;
}

/**
 * Borra items `done` con TTL > 24h. Mantenemos los recientes para diagnóstico
 * y para que la UI pueda mostrar "se subió X". Limpieza periódica desde el worker.
 */
export async function purgeOldDone(now: number, ttlMs = 24 * 60 * 60 * 1000): Promise<number> {
  const items = await listByStatus('done');
  let n = 0;
  for (const item of items) {
    if (now - item.createdAt > ttlMs) {
      await deleteItem(item.id);
      n++;
    }
  }
  return n;
}

/**
 * Recupera items que quedaron `in_flight` en una sesión previa (chofer
 * recargó / cerró pestaña mid-process). Los pasa a `pending` SIN incrementar
 * `attempts` (no fue su culpa). ADR-023 / Bug A.
 *
 * Idempotente. Devuelve cuántos rescató.
 */
export async function resetInFlight(): Promise<number> {
  const items = await listByStatus('in_flight');
  for (const item of items) {
    await putItem({ ...item, status: 'pending', lastAttemptAt: null });
  }
  return items.length;
}

/** Listo para tests / debugging. */
export async function clearAll(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE);
}
