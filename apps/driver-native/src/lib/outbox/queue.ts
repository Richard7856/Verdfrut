// API pública del outbox — agregar items, suscribirse a cambios.
//
// El worker (ver worker.ts) corre periódicamente y procesa items pendientes.

import * as FileSystem from 'expo-file-system';
import { insertItem, listAll, countByStatus } from './db';
import type { OutboxItem, OutboxOpType, OutboxStatus, SubmitDeliveryPayload } from './types';

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyChange(): void {
  for (const l of listeners) {
    try {
      l();
    } catch (err) {
      console.warn('[outbox] listener error:', err);
    }
  }
}

function makeId(): string {
  // UUID v4 simple (no necesitamos crypto fuerte — sólo unicidad local).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Encola un envío de entrega. Antes de encolar, COPIA las fotos a una
 * ubicación persistente (`documentDirectory/outbox/{id}/`) porque las URIs
 * que devuelve expo-camera viven en cacheDirectory y se pueden borrar
 * cuando el OS necesita espacio.
 */
export async function enqueueSubmitDelivery(
  payload: Omit<SubmitDeliveryPayload, 'exhibitLocalUri' | 'ticketLocalUri' | 'mermaPhotoLocalUri'> & {
    exhibitLocalUri: string;
    ticketLocalUri: string;
    mermaPhotoLocalUri: string | null;
  },
): Promise<OutboxItem> {
  const id = makeId();
  const createdAt = Date.now();

  // Copiar fotos a almacenamiento persistente del outbox.
  const exhibitPath = await persistPhoto(id, 'exhibit', payload.exhibitLocalUri);
  const ticketPath = await persistPhoto(id, 'ticket', payload.ticketLocalUri);
  const mermaPath = payload.mermaPhotoLocalUri
    ? await persistPhoto(id, 'merma', payload.mermaPhotoLocalUri)
    : null;

  const finalPayload: SubmitDeliveryPayload = {
    ...payload,
    exhibitLocalUri: exhibitPath,
    ticketLocalUri: ticketPath,
    mermaPhotoLocalUri: mermaPath,
  };

  const item: OutboxItem = {
    id,
    type: 'submit_delivery',
    status: 'pending',
    payload: JSON.stringify(finalPayload),
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    createdAt,
  };
  await insertItem(item);
  notifyChange();
  return item;
}

async function persistPhoto(opId: string, slot: string, srcUri: string): Promise<string> {
  const dirBase = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!dirBase) {
    throw new Error('[outbox.persistPhoto] FileSystem.documentDirectory no disponible');
  }
  const dir = `${dirBase}outbox/${opId}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const dest = `${dir}${slot}.jpg`;
  await FileSystem.copyAsync({ from: srcUri, to: dest });
  return dest;
}

export async function deletePhotosForOp(opId: string): Promise<void> {
  const dirBase = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!dirBase) return;
  const dir = `${dirBase}outbox/${opId}/`;
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (info.exists) {
      await FileSystem.deleteAsync(dir, { idempotent: true });
    }
  } catch (err) {
    console.warn('[outbox.deletePhotosForOp]', err);
  }
}

/** Snapshot del estado del outbox para UI. */
export interface OutboxSnapshot {
  counts: Record<OutboxStatus, number>;
  items: OutboxItem[];
}

export async function getSnapshot(): Promise<OutboxSnapshot> {
  const [counts, items] = await Promise.all([countByStatus(), listAll()]);
  return { counts, items };
}

export type { OutboxOpType };
