'use client';

// Componente del chat thread — duplicado deliberado del de driver (ADR-021).
// Mantener paridad manual hasta que un tercer consumidor justifique extraer
// a un paquete `@tripdrive/chat-ui`.

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import type { ChatMessage } from '@tripdrive/types';

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
  // H5 / issue #143: lightbox global cuando se hace click en cualquier imagen
  // del thread. Un solo state al top-level del componente — más simple que un
  // portal y cierre limpio con ESC + click fuera.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, optimisticMessages.length]);

  // ESC para cerrar lightbox.
  useEffect(() => {
    if (!lightboxUrl) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxUrl(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [lightboxUrl]);

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
          onImageClick={setLightboxUrl}
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
          onImageClick={setLightboxUrl}
        />
      ))}
      <div ref={endRef} />
      {lightboxUrl && (
        <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}
    </div>
  );
}

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 rounded-full bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20"
        aria-label="Cerrar"
      >
        Cerrar ✕
      </button>
      {/* Usamos <img> aquí porque queremos object-contain a tamaño full y
          <Image fill> en un contenedor flex sin tamaño definido se rompe. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Adjunto ampliado"
        className="max-h-[90vh] max-w-[90vw] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
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
  onImageClick,
}: {
  viewerRole: 'driver' | 'zone_manager';
  sender: ChatMessage['sender'];
  text: string | null | undefined;
  imageUrl: string | null | undefined;
  createdAt: string;
  pending?: boolean;
  onImageClick?: (url: string) => void;
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
          // H4.5/H5 (#118, #143): <Image> de Next.js para CDN+WebP. Click
          // expande a lightbox (issue #143) — el componente padre maneja el state.
          <button
            type="button"
            onClick={() => onImageClick?.(imageUrl)}
            className="relative mb-1 block h-64 w-full overflow-hidden rounded-md hover:opacity-90"
            aria-label="Ampliar imagen"
          >
            <Image
              src={imageUrl}
              alt="Adjunto"
              fill
              sizes="(max-width: 640px) 100vw, 400px"
              className="object-cover"
            />
          </button>
        )}
        {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
        <p className={`mt-1 text-[10px] ${isMine ? 'text-white/70' : 'text-[var(--color-text-muted)]'}`}>
          {pending ? 'Enviando…' : new Date(createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}
