'use client';

// PhotoInput — captura una foto desde la cámara del teléfono y la sube a Supabase.
// Cuando termina, llama onUploaded(url, path) y guarda preview local.
//
// Diseño: en móvil abre cámara directa (input capture=environment). En desktop
// abre selector de archivo (sirve para QA con drag & drop).

import { useRef, useState } from 'react';
import Image from 'next/image';
import { Button, Spinner } from '@verdfrut/ui';
import { uploadEvidencePhoto, type EvidenceBucket } from '@/lib/storage';

interface Props {
  bucket: EvidenceBucket;
  routeId: string;
  stopId: string;
  /** Identificador de slot — se persiste como key en evidence JSON. */
  slot: string;
  userId: string;
  /** URL ya subida — si existe, muestra preview en vez de input. */
  existingUrl?: string | null;
  onUploaded: (url: string) => void | Promise<void>;
  /** Texto del botón cuando no hay foto. */
  label?: string;
}

export function PhotoInput({
  bucket,
  routeId,
  stopId,
  slot,
  userId,
  existingUrl,
  onUploaded,
  label = 'Tomar foto',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingUrl ?? null);

  async function handleFile(file: File) {
    setError(null);
    setPending(true);
    // Preview local instantáneo mientras sube.
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);

    try {
      const result = await uploadEvidencePhoto({
        bucket,
        routeId,
        stopId,
        key: slot,
        file,
        userId,
      });
      // Reemplazar preview local por la URL final.
      URL.revokeObjectURL(localUrl);
      setPreviewUrl(result.url);
      await onUploaded(result.url);
    } catch (err) {
      URL.revokeObjectURL(localUrl);
      setPreviewUrl(existingUrl ?? null);
      setError(err instanceof Error ? err.message : 'Error al subir');
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
          // Reset para permitir reintento con la misma foto.
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
              <Spinner /> <span className="ml-2 text-sm">Subiendo…</span>
            </div>
          )}
          <div className="flex items-center justify-between p-2">
            <span className="text-xs text-[var(--color-text-muted)]">Foto cargada</span>
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
              <span className="text-sm">Subiendo…</span>
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
