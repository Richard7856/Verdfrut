// Barrel del outbox — único punto de import desde el resto de la app.

export { enqueueSubmitDelivery, getSnapshot, subscribe, type OutboxSnapshot } from './queue';
export { start as startOutboxWorker, stop as stopOutboxWorker, tickNow, isStarted } from './worker';
export type {
  OutboxItem,
  OutboxOpType,
  OutboxStatus,
  SubmitDeliveryPayload,
} from './types';
