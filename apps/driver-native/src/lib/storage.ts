// Upload de evidencia a Supabase Storage.
//
// Replica el split de buckets del web driver:
//   - `evidence` (público): fotos del mueble, fachada, báscula. Path
//     `{routeId}/{stopId}/{slot}-{ts}.jpg`. getPublicUrl no expira.
//   - `ticket-images` (privado): recibos + tickets de merma. RLS exige
//     primer folder == auth.uid(). Path `{userId}/{routeId}/{stopId}/{slot}-{ts}.jpg`.
//     createSignedUrl con TTL 1 año.
//
// Diferencias vs web:
//   - El input es un URI local de un archivo JPEG ya comprimido por
//     expo-image-manipulator (no un Blob/File). Lo subimos como FormData/blob
//     vía fetch hacia el endpoint REST de Storage.
//   - Compresión NO está aquí — la pantalla la hace antes de encolar para
//     que el outbox guarde la versión liviana.

import { supabase } from '@/lib/supabase';

export type EvidenceBucket = 'evidence' | 'ticket-images';

const MAX_BLOB_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface UploadResult {
  /** URL pública o signed según bucket. */
  url: string;
  path: string;
}

interface UploadArgs {
  bucket: EvidenceBucket;
  routeId: string;
  stopId: string;
  /** Slot — ej. `arrival_exhibit`, `ticket`, `merma`. */
  slot: string;
  /** URI local del archivo (ej. file://... devuelto por expo-camera). */
  localUri: string;
  /** auth.uid() — requerido para ticket-images por RLS. */
  userId: string;
  /**
   * Timestamp determinístico (ms) que define el path. Usa el `createdAt` del
   * outbox para que retries idempotentes lleguen al mismo path; si ya existe
   * el archivo, intepretamos como already-uploaded.
   */
  timestampMs: number;
}

/**
 * Sube el archivo local al bucket. Idempotente: si el path ya existe en
 * Storage (caso de retry tras éxito silencioso) NO lanza, deriva la URL.
 */
export async function uploadEvidence(args: UploadArgs): Promise<UploadResult> {
  const { bucket, routeId, stopId, slot, localUri, userId, timestampMs } = args;

  const path =
    bucket === 'ticket-images'
      ? `${userId}/${routeId}/${stopId}/${slot}-${timestampMs}.jpg`
      : `${routeId}/${stopId}/${slot}-${timestampMs}.jpg`;

  // Convertir URI local a Blob via fetch. En RN, fetch(uri) sobre un file://
  // devuelve un Response cuyo .blob() tiene los bytes.
  let blob: Blob;
  try {
    const res = await fetch(localUri);
    blob = await res.blob();
  } catch (err) {
    throw new Error(
      `[storage.upload] no se pudo leer archivo local ${localUri}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (blob.type && !ALLOWED_MIME.has(blob.type)) {
    throw new Error(`[storage.upload] tipo no permitido: ${blob.type}`);
  }
  if (blob.size > MAX_BLOB_BYTES) {
    throw new Error(
      `[storage.upload] imagen demasiado grande (${(blob.size / 1024 / 1024).toFixed(1)}MB)`,
    );
  }

  const { error: upErr } = await supabase.storage.from(bucket).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  });

  // "Duplicate" = path ya existe = retry de upload exitoso previo. No es error.
  if (upErr && !/already exists|Duplicate/i.test(upErr.message)) {
    throw new Error(`[storage.upload] ${bucket}/${path}: ${upErr.message}`);
  }

  if (bucket === 'evidence') {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return { url: data.publicUrl, path };
  }

  // ticket-images privado: signed URL larga.
  const { data: signed, error: signErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signErr || !signed) {
    throw new Error(`[storage.sign] ${bucket}/${path}: ${signErr?.message ?? 'sin URL'}`);
  }
  return { url: signed.signedUrl, path };
}
