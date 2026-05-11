'use client';

// Composer del comercial. Llama directamente a server actions (sin outbox).
//   - Texto: sendManagerMessage.
//   - Foto: uploadManagerChatPhotoAction → URL → sendManagerMessage.
// La red del comercial es típicamente estable (oficina/laptop), no necesita cola.

import { useRef, useState, useTransition } from 'react';
import { Button } from '@tripdrive/ui';
import {
  sendManagerMessage,
  uploadManagerChatPhotoAction,
} from '@/app/(app)/incidents/[reportId]/actions';
import type { OptimisticMessage } from './chat-thread';

interface Props {
  reportId: string;
  onPushOptimistic: (msg: OptimisticMessage) => void;
  onError: (msg: string) => void;
  disabled?: boolean;
}

const MAX_TEXT_LEN = 2_000; // ADR-023

function newLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ChatComposerManager({
  reportId,
  onPushOptimistic,
  onError,
  disabled = false,
}: Props) {
  const [text, setText] = useState('');
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSendText() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    const localId = newLocalId();
    onPushOptimistic({ localId, text: trimmed, createdAt: new Date().toISOString() });
    setText('');
    startTransition(async () => {
      const res = await sendManagerMessage(reportId, { text: trimmed });
      if (!res.ok) onError(res.error);
    });
  }

  function handleFile(file: File) {
    if (disabled) return;
    const localUrl = URL.createObjectURL(file);
    const localId = newLocalId();
    onPushOptimistic({ localId, imageUrl: localUrl, createdAt: new Date().toISOString() });

    const fd = new FormData();
    fd.append('file', file);

    startTransition(async () => {
      const upload = await uploadManagerChatPhotoAction(reportId, fd);
      if (!upload.ok || !upload.url) {
        onError(upload.ok ? 'Sin URL final' : upload.error);
        return;
      }
      const send = await sendManagerMessage(reportId, { imageUrl: upload.url });
      if (!send.ok) onError(send.error);
    });
  }

  return (
    <div className="flex items-end gap-2 border-t border-[var(--color-border)] bg-[var(--vf-surface-1)] px-3 py-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
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
        placeholder={disabled ? 'Caso cerrado' : 'Escribe un mensaje al chofer…'}
        rows={1}
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendText();
          }
        }}
        className="min-h-[40px] flex-1 resize-none rounded-2xl border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:border-[var(--vf-green-500)] focus:outline-none disabled:opacity-50"
      />
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={handleSendText}
        disabled={!text.trim() || disabled || pending}
      >
        Enviar
      </Button>
    </div>
  );
}
