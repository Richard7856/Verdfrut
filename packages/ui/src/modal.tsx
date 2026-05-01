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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className={cn(
          'relative w-full rounded-[var(--radius-lg)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)]',
          SIZES[size],
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || description) && (
          <div className="border-b border-[var(--color-border)] px-6 py-4">
            {title && (
              <h2 className="text-base font-semibold text-[var(--color-text)]">{title}</h2>
            )}
            {description && (
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p>
            )}
          </div>
        )}
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-6 py-3 rounded-b-[var(--radius-lg)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
