// Modal/Dialog accesible. Cierra con ESC y click fuera.
// Para producción puede valer la pena migrar a @radix-ui/react-dialog,
// pero para Fase 1 esto es suficiente y sin dependencias externas.

'use client';

import { useEffect, type ReactNode } from 'react';
import { cn } from './cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Overlay 0.55 + backdrop-blur — antes 0.4 mostraba demasiado contenido
          detrás y daba ilusión de modal "transparente" combinado con el bug de
          tokens fantasma (--vf-surface-1) que efectivamente lo dejaba sin fondo. */}
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
      <div
        // Bug visual previo (2026-05-11): `bg-[var(--color-surface)]` resolvía
        // a transparente en dark mode. La variable está declarada en `@theme`
        // de Tailwind v4 referenciando `var(--vf-bg-elev)`; con el rebrand fase
        // 2 (ADR-056) la indirección dejó de propagar el cambio de tema.
        // Usamos directo el token `--vf-bg-elev` que SÍ cambia con [data-theme].
        style={{
          backgroundColor: 'var(--vf-bg-elev)',
          color: 'var(--vf-text)',
        }}
        className={cn(
          'relative w-full rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)]',
          SIZES[size],
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || description) && (
          <div
            className="px-6 py-4"
            style={{ borderBottom: '1px solid var(--vf-line)' }}
          >
            {title && (
              <h2 className="text-base font-semibold" style={{ color: 'var(--vf-text)' }}>
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 text-sm" style={{ color: 'var(--vf-text-mute)' }}>
                {description}
              </p>
            )}
          </div>
        )}
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div
            className="flex items-center justify-end gap-2 px-6 py-3 rounded-b-[var(--radius-lg)]"
            style={{
              borderTop: '1px solid var(--vf-line)',
              backgroundColor: 'var(--vf-bg-sub)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
