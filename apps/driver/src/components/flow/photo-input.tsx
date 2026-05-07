'use client';

// PhotoInput — captura una foto desde la cámara y la encola al outbox para que
// suba a Supabase Storage cuando haya red (ADR-019).
//
// Cambio respecto al diseño previo (V1): ya NO hace upload bloqueante. La foto
// se comprime, se persiste el Blob en IndexedDB y `onQueued` se llama
// inmediatamente para que el step pueda habilitar "Continuar" sin esperar red.
//
// El handler del outbox `upload_photo` se encarga de:
//   1. subir el Blob a Storage,
//   2. encolar set_evidence con la URL final,
//   3. (si patchColumn está set) encolar patch_report a la columna dedicada.

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Button, Spinner } from '@verdfrut/ui';
import { compressImage, type EvidenceBucket } from '@/lib/storage';
import { enqueue } from '@/lib/outbox';
import type { UploadPhotoPayload } from '@/lib/outbox';

interface Props {
  bucket: EvidenceBucket;
  routeId: string;
  stopId: string;
  reportId: string;
  /** Identificador de slot — se persiste como key en evidence JSON. */
  slot: string;
  userId: string;
  /** URL ya subida — si existe, muestra preview en vez de input. */
  existingUrl?: string | null;
  /**
   * Llamado cuando la foto se encoló (no necesariamente subida aún).
   * El step usa esto para habilitar "Continuar" porque la cola garantiza upload eventual.
   */
  onQueued?: (localUrl: string) => void | Promise<void>;
  /** Si la foto va a una columna dedicada del report, lo manejamos aquí. */
  patchColumn?: UploadPhotoPayload['patchColumn'];
  /** Texto del botón cuando no hay foto. */
  label?: string;
}

export function PhotoInput({
  bucket,
  routeId,
  stopId,
  reportId,
  slot,
  userId,
  existingUrl,
  onQueued,
  patchColumn,
  label = 'Tomar foto',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingUrl ?? null);
  // Track del object URL para limpiarlo al desmontar y evitar leaks.
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function handleFile(file: File) {
    setError(null);
    setPending(true);
    try {
      const compressed = await compressImage(file);
      const localUrl = URL.createObjectURL(compressed);
      // Limpiar preview anterior si la había.
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = localUrl;
      setPreviewUrl(localUrl);

      // Si es REEMPLAZO de foto de ticket (existingUrl ya estaba), invalidar
      // la extracción OCR vieja antes de subir la nueva. Bug E + #45 / ADR-023.
      // El siguiente entry al review step volverá a llamar Anthropic.
      const isReplacement = Boolean(existingUrl);
      if (isReplacement) {
        if (slot === 'ticket_recibido') {
          await enqueue({
            type: 'patch_report',
            payload: {
              reportId,
              patch: { ticketData: null, ticketExtractionConfirmed: false },
            },
          });
        } else if (slot === 'ticket_merma') {
          await enqueue({
            type: 'patch_report',
            payload: {
              reportId,
              patch: {
                returnTicketData: null,
                returnTicketExtractionConfirmed: false,
              },
            },
          });
        }
      }

      await enqueue({
        type: 'upload_photo',
        payload: {
          bucket,
          routeId,
          stopId,
          slot,
          userId,
          blob: compressed,
          reportId,
          patchColumn,
        },
      });
      await onQueued?.(localUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al procesar foto');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />

      {previewUrl ? (
        <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--vf-surface-2)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt={`Evidencia ${slot}`}
            className="aspect-[4/3] w-full object-cover"
          />
          {pending && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
              <Spinner /> <span className="ml-2 text-sm">Procesando…</span>
            </div>
          )}
          <div className="flex items-center justify-between p-2">
            <span className="text-xs text-[var(--color-text-muted)]">
              {existingUrl === previewUrl ? 'Foto cargada' : 'Foto en cola'}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={pending}
            >
              Reemplazar
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--color-border)] bg-[var(--vf-surface-2)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--vf-surface-3)] disabled:opacity-50"
        >
          {pending ? (
            <>
              <Spinner />
              <span className="text-sm">Procesando…</span>
            </>
          ) : (
            <>
              <span className="text-3xl">📷</span>
              <span className="text-sm font-medium text-[var(--color-text)]">{label}</span>
            </>
          )}
        </button>
      )}

      {error && <p className="text-xs text-[var(--color-danger-fg)]">{error}</p>}
    </div>
  );
}
// Suprimir warning de Image no usado para no romper build estricto.
void Image;
