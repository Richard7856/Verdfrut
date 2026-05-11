'use client';

// Composer del lado driver. Envía mensajes via outbox.
//   - Texto: encola send_chat_message directo.
//   - Foto: comprime, encola upload_photo con asChatMessage=true. El handler
//     después encadena send_chat_message con la URL final.
//
// Las dos vías muestran un mensaje "optimista" en el thread mientras la cola
// procesa, vía el callback onPushOptimistic.

import { useRef, useState } from 'react';
import { Button } from '@tripdrive/ui';
import { compressImage } from '@/lib/storage';
import { enqueue } from '@/lib/outbox';
import type { OptimisticMessage } from './chat-thread';

interface Props {
  reportId: string;
  routeId: string;
  stopId: string;
  userId: string;
  /** Llamado tras cada send para que el padre muestre el mensaje optimista. */
  onPushOptimistic: (msg: OptimisticMessage) => void;
  disabled?: boolean;
}

const MAX_TEXT_LEN = 2_000; // ADR-023 — defensa en profundidad

function newLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ChatComposerDriver({
  reportId,
  routeId,
  stopId,
  userId,
  onPushOptimistic,
  disabled = false,
}: Props) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSendText() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    const localId = newLocalId();
    onPushOptimistic({ localId, text: trimmed, createdAt: new Date().toISOString() });
    setText('');
    await enqueue({
      type: 'send_chat_message',
      payload: { reportId, text: trimmed },
    });
  }

  async function handleFile(file: File) {
    if (disabled) return;
    setPending(true);
    try {
      const blob = await compressImage(file);
      const localUrl = URL.createObjectURL(blob);
      const localId = newLocalId();
      onPushOptimistic({ localId, imageUrl: localUrl, createdAt: new Date().toISOString() });

      // El upload va por la cola — slot único por timestamp dentro del path.
      // asChatMessage=true → el handler emite send_chat_message con image_url tras éxito.
      await enqueue({
        type: 'upload_photo',
        payload: {
          bucket: 'evidence',
          routeId,
          stopId,
          userId,
          slot: `chat_${Date.now()}`,
          blob,
          reportId,
          asChatMessage: true,
        },
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-[var(--color-border)] bg-[var(--vf-surface-1)] px-3 py-2 safe-bottom">
      <input
        ref={fileInputRef}
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
      <button
        type="button"
        aria-label="Adjuntar foto"
        onClick={() => fileInputRef.current?.click()}
        disabled={pending || disabled}
        className="rounded-full bg-[var(--vf-surface-2)] px-3 py-2 text-lg disabled:opacity-50"
      >
        📷
      </button>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX_TEXT_LEN}
        placeholder={disabled ? 'Chat cerrado' : 'Escribe un mensaje…'}
        rows={1}
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleSendText();
          }
        }}
        className="min-h-[40px] flex-1 resize-none rounded-2xl border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:border-[var(--vf-green-500)] focus:outline-none disabled:opacity-50"
      />
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={handleSendText}
        disabled={!text.trim() || disabled}
      >
        Enviar
      </Button>
    </div>
  );
}
