'use client';

// Componente del chat thread — duplicado deliberado del de driver (ADR-021).
// Mantener paridad manual hasta que un tercer consumidor justifique extraer
// a un paquete `@verdfrut/chat-ui`.

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import type { ChatMessage } from '@verdfrut/types';

interface Props {
  messages: ChatMessage[];
  viewerRole: 'driver' | 'zone_manager';
  optimisticMessages?: OptimisticMessage[];
}

export interface OptimisticMessage {
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
        <Bubble
          key={m.id}
          viewerRole={viewerRole}
          sender={m.sender}
          text={m.text}
          imageUrl={m.imageUrl}
          createdAt={m.createdAt}
        />
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
          // ADR-054 / H4.5 / issue #118: <Image> de Next.js resize automático
          // + caché CDN + WebP/AVIF. unoptimized=false (default) requiere que
          // el host esté en next.config.images.remotePatterns — ya configurado
          // para *.supabase.co.
          <div className="relative mb-1 h-64 w-full overflow-hidden rounded-md">
            <Image
              src={imageUrl}
              alt="Adjunto"
              fill
              sizes="(max-width: 640px) 100vw, 400px"
              className="object-cover"
            />
          </div>
        )}
        {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
        <p className={`mt-1 text-[10px] ${isMine ? 'text-white/70' : 'text-[var(--color-text-muted)]'}`}>
          {pending ? 'Enviando…' : new Date(createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}
