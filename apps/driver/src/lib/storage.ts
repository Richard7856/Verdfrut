'use client';

// Helpers de cliente para subir evidencia a Supabase Storage.
//
// Bucket strategy:
//   - 'evidence' (público): fotos del mueble, fachada, báscula, fotos auxiliares.
//     Cualquier authenticated puede insert. Path: {routeId}/{stopId}/{key}-{ts}.jpg
//   - 'ticket-images' (privado): SOLO recibos y tickets de merma — datos potencialmente
//     sensibles (precios, info fiscal). Path: {userId}/{routeId}/{stopId}/{key}-{ts}.jpg
//     RLS exige que el primer folder sea auth.uid() (ver migración 008).
//
// Los archivos se comprimen a ~1MB con canvas antes de subir, lo que reduce
// el tráfico de datos del chofer y el tiempo de upload (típico móvil 4G/3G).

import { createBrowserClient } from '@verdfrut/supabase/browser';

const MAX_DIMENSION = 1600; // px del lado largo
const JPEG_QUALITY = 0.78;

export type EvidenceBucket = 'evidence' | 'ticket-images';

/**
 * Comprime un File de imagen vía canvas. Mantiene aspect ratio.
 * Si la imagen ya está bajo MAX_DIMENSION, igual re-encodea a JPEG con menos calidad
 * (los iPhone vienen con HEIC/JPEG bajos en compresión).
 */
async function compressImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { width, height } = scaleDown(img.width, img.height, MAX_DIMENSION);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context disponible para comprimir');
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob devolvió null'))),
        'image/jpeg',
        JPEG_QUALITY,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(typeof e === 'string' ? new Error(e) : new Error('Image load failed'));
    img.src = src;
  });
}

function scaleDown(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  if (w >= h) return { width: max, height: Math.round((h / w) * max) };
  return { width: Math.round((w / h) * max), height: max };
}

interface UploadEvidenceParams {
  bucket: EvidenceBucket;
  routeId: string;
  stopId: string;
  /** Identificador del slot (ej. arrival_exhibit, ticket_recibido). */
  key: string;
  file: File;
  /** auth.uid() — requerido para bucket 'ticket-images' por RLS. */
  userId: string;
}

export interface UploadResult {
  /** URL pública (bucket evidence) o signed url temporal (bucket ticket-images). */
  url: string;
  /** Path completo en storage, útil para debugging y deletes futuros. */
  path: string;
}

/**
 * Sube una imagen al bucket correspondiente y devuelve la URL utilizable.
 * - evidence: getPublicUrl (no expira).
 * - ticket-images: createSignedUrl con TTL largo (1 año) — el chofer la guarda en el report.
 */
export async function uploadEvidencePhoto(params: UploadEvidenceParams): Promise<UploadResult> {
  const { bucket, routeId, stopId, key, file, userId } = params;
  const supabase = createBrowserClient();

  const compressed = await compressImage(file);
  const ts = Date.now();
  const ext = 'jpg';
  const baseName = `${key}-${ts}.${ext}`;

  // Path varía según bucket. ticket-images REQUIERE userId como primer folder.
  const path =
    bucket === 'ticket-images'
      ? `${userId}/${routeId}/${stopId}/${baseName}`
      : `${routeId}/${stopId}/${baseName}`;

  const { error: upErr } = await supabase.storage.from(bucket).upload(path, compressed, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (upErr) {
    throw new Error(`[storage.upload] ${bucket}/${path}: ${upErr.message}`);
  }

  if (bucket === 'evidence') {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return { url: data.publicUrl, path };
  }

  // Bucket privado: signed URL de 1 año (suficiente para audit del reporte).
  const { data, error: signErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signErr || !data) {
    throw new Error(`[storage.sign] ${bucket}/${path}: ${signErr?.message ?? 'sin URL'}`);
  }
  return { url: data.signedUrl, path };
}
