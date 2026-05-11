'use client';

// Componente compartido del thread del chat — usado por driver y platform.
// (Por ahora vive en driver y se duplicará tal cual en platform — ADR-021
// decisión consciente para no inflar @tripdrive/ui).
//
// Responsabilidades:
//  - Renderizar burbujas de mensajes con estilo según sender.
//  - Auto-scroll al último mensaje cuando llega uno nuevo.
//  - Mostrar foto inline cuando hay image_url.
//  - Indicar mensajes "pendientes" (encolados pero no aplicados aún) en el viewer driver.

import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@tripdrive/types';

interface Props {
  messages: ChatMessage[];
  /** Quién mira el chat — para alinear sus propias burbujas a la derecha. */
  viewerRole: 'driver' | 'zone_manager';
  /** Mensajes optimistas locales (encolados, aún no en DB). Se renderizan con tono "enviando…". */
  optimisticMessages?: OptimisticMessage[];
}

export interface OptimisticMessage {
  /** UUID local para identificar y deduplicar cuando el server confirme. */
  localId: string;
  text?: string | null;
  imageUrl?: string | null;
  createdAt: string;
}

export function ChatThread({ messages, viewerRole, optimisticMessages = [] }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, optimisticMessages.length]);

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
      {messages.length === 0 && optimisticMessages.length === 0 && (
        <p className="my-auto text-center text-sm text-[var(--color-text-muted)]">
          Sin mensajes aún.
        </p>
      )}
      {messages.map((m) => (
        <Bubble key={m.id} viewerRole={viewerRole} sender={m.sender} text={m.text} imageUrl={m.imageUrl} createdAt={m.createdAt} />
      ))}
      {optimisticMessages.map((m) => (
        <Bubble
          key={m.localId}
          viewerRole={viewerRole}
          sender={viewerRole}
          text={m.text}
          imageUrl={m.imageUrl}
          createdAt={m.createdAt}
          pending
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}

function Bubble({
  viewerRole,
  sender,
  text,
  imageUrl,
  createdAt,
  pending = false,
}: {
  viewerRole: 'driver' | 'zone_manager';
  sender: ChatMessage['sender'];
  text: string | null | undefined;
  imageUrl: string | null | undefined;
  createdAt: string;
  pending?: boolean;
}) {
  const isMine = sender === viewerRole;
  const isSystem = sender === 'system';

  if (isSystem) {
    return (
      <div className="my-1 flex justify-center">
        <span className="rounded-full bg-[var(--vf-surface-2)] px-3 py-1 text-xs text-[var(--color-text-muted)]">
          {text}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
          isMine
            ? 'bg-[var(--vf-green-500)] text-white'
            : 'bg-[var(--vf-surface-2)] text-[var(--color-text)]'
        } ${pending ? 'opacity-70' : ''}`}
      >
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="Adjunto"
            className="mb-1 max-h-64 w-full rounded-md object-cover"
          />
        )}
        {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
        <p className={`mt-1 text-[10px] ${isMine ? 'text-white/70' : 'text-[var(--color-text-muted)]'}`}>
          {pending ? 'Enviando…' : new Date(createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}
