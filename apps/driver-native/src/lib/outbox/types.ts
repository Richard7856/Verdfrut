// Tipos del outbox offline.
//
// N4 sólo expone una operación: `submit_delivery`. Engloba todo el cierre de
// la parada (subir fotos + crear delivery_report + completar stop + propagar
// route status). Es atómico desde la UX — el chofer dice "Enviar" una vez.
//
// En el futuro otras operaciones (mark_arrived offline, send_chat_message)
// pueden compartir esta misma tabla agregándose como nuevos `type`.

import type { TicketData } from '@tripdrive/types';

export type OutboxStatus = 'pending' | 'in_flight' | 'failed' | 'done';

export type OutboxOpType = 'submit_delivery';

export interface SubmitDeliveryPayload {
  stopId: string;
  routeId: string;
  driverId: string;
  zoneId: string;
  storeId: string;
  /** Denormalizado en delivery_reports para queries de listado. */
  storeCode: string;
  storeName: string;
  /** auth.uid() — requerido para uploads al bucket ticket-images. */
  userId: string;
  /** URIs locales (file://...) de las fotos. Persisten hasta que se sube y se mark done. */
  exhibitLocalUri: string;
  ticketLocalUri: string;
  hasMerma: boolean;
  mermaPhotoLocalUri: string | null;
  mermaDescription: string | null;
  otherIncidentDescription: string | null;
  /** Si OCR corrió online antes del submit, viene aquí. NULL si quedó manual. */
  ticketData: TicketData | null;
  ticketExtractionConfirmed: boolean;
}

export interface OutboxItem {
  id: string;
  type: OutboxOpType;
  status: OutboxStatus;
  /** Stringified JSON del payload tipado por `type`. */
  payload: string;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: number | null;
  createdAt: number;
}

export function parsePayload<T>(item: OutboxItem): T {
  return JSON.parse(item.payload) as T;
}
