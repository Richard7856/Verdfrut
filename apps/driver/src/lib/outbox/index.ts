// Public API del outbox.
// El resto del código del driver app debe importar SOLO desde aquí, no de los
// módulos internos — eso facilita extraerlo a un paquete cuando platform/control
// lo necesiten (ver ADR-019 → "Oportunidades de mejora").

export { enqueue, processOnce, retryFailed, snapshot, listItems, gc, subscribe } from './queue';
export type { OutboxSnapshot } from './queue';
export type {
  OutboxItem,
  OutboxStatus,
  OutboxOpType,
  OutboxPayload,
  AdvanceStepPayload,
  SetEvidencePayload,
  PatchReportPayload,
  SubmitReportPayload,
  SubmitNonEntregaPayload,
  ConvertToEntregaPayload,
  UploadPhotoPayload,
  SendChatMessagePayload,
  ResolveChatByDriverPayload,
} from './types';
