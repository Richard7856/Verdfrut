// Tipos del outbox offline.
// Ver ADR-019 (DECISIONS.md) para el rationale completo.
//
// Cada operación es una mutación que el driver puede haber disparado mientras
// la red estaba caída. El worker reintenta hasta que el server confirma.

import type {
  IncidentDetail,
  ResolutionType,
  TicketData,
} from '@tripdrive/types';
import type { EvidenceBucket } from '../storage';

export type OutboxStatus = 'pending' | 'in_flight' | 'failed' | 'done';

/** Discriminator para mapear a un handler en handlers.ts. */
export type OutboxOpType =
  | 'advance_step'
  | 'set_evidence'
  | 'patch_report'
  | 'submit_report'
  | 'submit_non_entrega'
  | 'convert_to_entrega'
  | 'upload_photo'
  | 'send_chat_message'
  | 'resolve_chat_by_driver';

/** Payloads tipados por operación. */
export interface AdvanceStepPayload {
  reportId: string;
  nextStep: string;
}

export interface SetEvidencePayload {
  reportId: string;
  key: string;
  url: string;
}

export interface PatchReportPayload {
  reportId: string;
  patch: {
    hasMerma?: boolean;
    noTicketReason?: string | null;
    noTicketReasonPhotoUrl?: string | null;
    otherIncidentDescription?: string | null;
    otherIncidentPhotoUrl?: string | null;
    incidentDetails?: IncidentDetail[];
    ticketImageUrl?: string | null;
    // Sprint 12: extracción OCR + confirmación
    ticketData?: TicketData | null;
    ticketExtractionConfirmed?: boolean;
    returnTicketData?: TicketData | null;
    returnTicketExtractionConfirmed?: boolean;
  };
}

export interface SubmitReportPayload {
  reportId: string;
  resolution: ResolutionType;
}

export interface SubmitNonEntregaPayload {
  reportId: string;
  resolution: ResolutionType;
}

export interface ConvertToEntregaPayload {
  reportId: string;
}

/**
 * Upload de foto: el blob comprimido vive en IndexedDB hasta que sube a Storage.
 * Tras éxito, el worker auto-encadena un set_evidence con la URL final.
 *
 * Si la foto también tiene una columna dedicada en delivery_reports
 * (ej. ticket_image_url, other_incident_photo_url), se especifica en
 * `patchColumn` para que tras el upload también se encole un patch_report.
 */
export interface UploadPhotoPayload {
  bucket: EvidenceBucket;
  routeId: string;
  stopId: string;
  /** Slot/key en evidence JSON (ej: 'arrival_exhibit'). */
  slot: string;
  userId: string;
  blob: Blob;
  /** reportId del delivery_report al que se asocia esta evidencia.
   *  Cuando el upload termina, se encola set_evidence con esta key. */
  reportId: string;
  /** Si está set, tras éxito se encola patch_report con { [patchColumn]: url }. */
  patchColumn?: 'ticketImageUrl' | 'otherIncidentPhotoUrl' | 'noTicketReasonPhotoUrl';
  /**
   * Si está set, en lugar de set_evidence/patch_report el handler encadena
   * un send_chat_message con la URL como image_url.
   * Útil para fotos adjuntas al chat — tienen un canal distinto.
   */
  asChatMessage?: boolean;
}

export interface SendChatMessagePayload {
  reportId: string;
  text?: string | null;
  imageUrl?: string | null;
}

export interface ResolveChatByDriverPayload {
  reportId: string;
}

export type OutboxPayload =
  | { type: 'advance_step'; payload: AdvanceStepPayload }
  | { type: 'set_evidence'; payload: SetEvidencePayload }
  | { type: 'patch_report'; payload: PatchReportPayload }
  | { type: 'submit_report'; payload: SubmitReportPayload }
  | { type: 'submit_non_entrega'; payload: SubmitNonEntregaPayload }
  | { type: 'convert_to_entrega'; payload: ConvertToEntregaPayload }
  | { type: 'upload_photo'; payload: UploadPhotoPayload }
  | { type: 'send_chat_message'; payload: SendChatMessagePayload }
  | { type: 'resolve_chat_by_driver'; payload: ResolveChatByDriverPayload };

export interface OutboxItem {
  /** UUIDv4 generado por el cliente — sirve como idempotency key. */
  id: string;
  type: OutboxOpType;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: number | null;
  createdAt: number;
}

/** Resultado de procesar un item — usado por el worker para decidir el siguiente paso. */
export type ProcessResult =
  | { kind: 'success' }
  /** El server respondió con un error que indica que el item ya fue aplicado
   *  (ej: "ya enviado" en submit). Marcamos done sin reintentar. */
  | { kind: 'already_applied'; reason: string }
  /** Error transitorio (red caída, timeout). Reintentar con backoff. */
  | { kind: 'retry'; error: string }
  /** Error permanente (validación, datos inválidos). No reintentar. */
  | { kind: 'fatal'; error: string };
