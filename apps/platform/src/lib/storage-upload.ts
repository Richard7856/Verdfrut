// Helper minimal de upload server-side para platform.
// NO es 'use server' — se usa desde otras server actions, no exporta una RPC.
// Usa el cliente con cookies del usuario (RLS aplica a Storage policies).
//
// Si necesitamos uploads desde el cliente (browser), se usaría el cliente
// browser directamente — este helper es para casos donde el blob viaja como
// ArrayBuffer en una server action (ej. composer del comercial sube foto).

import 'server-only';
import { createServerClient } from '@tripdrive/supabase/server';

// Allow-list — mismo conjunto que driver (ADR-023 / #43).
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BLOB_BYTES = 10 * 1024 * 1024;

interface UploadParams {
  bucket: 'evidence' | 'ticket-images';
  path: string;
  blob: Blob;
}

export async function uploadBlobToStorage(params: UploadParams): Promise<string> {
  if (params.blob.type && !ALLOWED_MIME.has(params.blob.type)) {
    throw new Error(`[storage.validate] Tipo no permitido: ${params.blob.type}`);
  }
  if (params.blob.size > MAX_BLOB_BYTES) {
    throw new Error(
      `[storage.validate] Imagen demasiado grande (${params.blob.size} > ${MAX_BLOB_BYTES})`,
    );
  }
  const supabase = await createServerClient();
  const { error } = await supabase.storage.from(params.bucket).upload(params.path, params.blob, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw new Error(`[storage.upload] ${params.path}: ${error.message}`);

  if (params.bucket === 'evidence') {
    const { data } = supabase.storage.from(params.bucket).getPublicUrl(params.path);
    return data.publicUrl;
  }
  const { data, error: signErr } = await supabase.storage
    .from(params.bucket)
    .createSignedUrl(params.path, 60 * 60 * 24 * 365);
  if (signErr || !data) throw new Error(`[storage.sign] ${params.path}: ${signErr?.message ?? 'sin URL'}`);
  return data.signedUrl;
}
