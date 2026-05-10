// Handlers que ejecutan cada tipo de operación del outbox.
// Cada handler devuelve un ProcessResult que el worker usa para decidir si
// reintentar, marcar done, o falla.
//
// Importante: estos handlers corren en el cliente y llaman a las server actions
// como funciones async normales (Next.js las transporta como POST internamente).

import {
  advanceStep,
  setReportEvidence,
  patchReport,
  submitReport,
  submitNonEntregaAction,
  convertToEntregaAction,
} from '@/app/route/stop/[id]/actions';
import {
  sendDriverMessage,
  resolveChatByDriverAction,
} from '@/app/route/stop/[id]/chat/actions';
import { uploadBlobToStorage } from '../storage';
import type {
  AdvanceStepPayload,
  ConvertToEntregaPayload,
  OutboxItem,
  PatchReportPayload,
  ProcessResult,
  ResolveChatByDriverPayload,
  SendChatMessagePayload,
  SetEvidencePayload,
  SubmitNonEntregaPayload,
  SubmitReportPayload,
  UploadPhotoPayload,
} from './types';
import { enqueue } from './queue';

/**
 * Patrones de mensajes de error que indican "ya aplicado" — el server rechaza
 * porque el estado ya cambió en una petición anterior. NO son fallas reales.
 */
const ALREADY_APPLIED_PATTERNS = [
  /ya enviado/i,
  /already.*submitted/i,
  /not in draft/i,
  /already exists/i, // Storage upload con path duplicado
];

/** Patrones que indican fallo de red o transitorio — reintentar. */
const RETRY_PATTERNS = [
  /failed to fetch/i,
  /network/i,
  /timeout/i,
  /econnrefused/i,
  /service unavailable/i,
];

function classifyError(msg: string): ProcessResult {
  if (ALREADY_APPLIED_PATTERNS.some((p) => p.test(msg))) {
    return { kind: 'already_applied', reason: msg };
  }
  if (RETRY_PATTERNS.some((p) => p.test(msg))) {
    return { kind: 'retry', error: msg };
  }
  // Por default consideramos transitorio — preferimos reintentar a perder trabajo.
  // Solo errores explícitamente fatales (validación) usarían 'fatal', pero por
  // simplicidad de V1 caemos a retry. Tras N reintentos el worker lo marca failed.
  return { kind: 'retry', error: msg };
}

async function runAndClassify(fn: () => Promise<{ ok: boolean; error?: string }>): Promise<ProcessResult> {
  try {
    const res = await fn();
    if (res.ok) return { kind: 'success' };
    return classifyError(res.error ?? 'unknown');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return classifyError(msg);
  }
}

export async function processItem(item: OutboxItem): Promise<ProcessResult> {
  switch (item.type) {
    case 'advance_step': {
      const p = item.payload as AdvanceStepPayload;
      return runAndClassify(() => advanceStep(p.reportId, p.nextStep));
    }
    case 'set_evidence': {
      const p = item.payload as SetEvidencePayload;
      return runAndClassify(() => setReportEvidence(p.reportId, p.key, p.url));
    }
    case 'patch_report': {
      const p = item.payload as PatchReportPayload;
      return runAndClassify(() => patchReport(p.reportId, p.patch));
    }
    case 'submit_report': {
      const p = item.payload as SubmitReportPayload;
      return runAndClassify(() => submitReport(p.reportId, p.resolution));
    }
    case 'submit_non_entrega': {
      const p = item.payload as SubmitNonEntregaPayload;
      return runAndClassify(() => submitNonEntregaAction(p.reportId, p.resolution));
    }
    case 'convert_to_entrega': {
      const p = item.payload as ConvertToEntregaPayload;
      return runAndClassify(() => convertToEntregaAction(p.reportId));
    }
    case 'upload_photo': {
      const p = item.payload as UploadPhotoPayload;
      try {
        const result = await uploadBlobToStorage({
          bucket: p.bucket,
          routeId: p.routeId,
          stopId: p.stopId,
          slot: p.slot,
          blob: p.blob,
          userId: p.userId,
        });
        if (p.asChatMessage) {
          // Sprint 11: la foto va al chat como image_url.
          // No tocamos evidence/patch_report aquí — el slot 'chat_*' es solo para
          // mantener el path único en Storage; el server NO lee `evidence.chat_*`.
          await enqueue({
            type: 'send_chat_message',
            payload: { reportId: p.reportId, imageUrl: result.url },
          });
        } else {
          // Encadenar set_evidence con la URL final.
          await enqueue({
            type: 'set_evidence',
            payload: { reportId: p.reportId, key: p.slot, url: result.url },
          });
          // Si esta foto va a una columna dedicada, también encolar el patch.
          if (p.patchColumn) {
            await enqueue({
              type: 'patch_report',
              payload: { reportId: p.reportId, patch: { [p.patchColumn]: result.url } },
            });
          }
        }
        return { kind: 'success' };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return classifyError(msg);
      }
    }
    case 'send_chat_message': {
      const p = item.payload as SendChatMessagePayload;
      // P0-2: el wrap previo con `.then(r => r.ok ? {ok:true} : r)` era redundante
      // (runAndClassify ya lee solo ok/error) y confundía el tipo. Llamamos
      // directamente — sendDriverMessage devuelve Result que es compatible.
      return runAndClassify(() =>
        sendDriverMessage(p.reportId, { text: p.text ?? null, imageUrl: p.imageUrl ?? null }),
      );
    }
    case 'resolve_chat_by_driver': {
      const p = item.payload as ResolveChatByDriverPayload;
      return runAndClassify(() => resolveChatByDriverAction(p.reportId));
    }
  }
}
