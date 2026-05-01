// Toast/notification system minimalista. Singleton pattern para no requerir provider.
// Para apps con muchos toasts simultáneos, considerar sonner o react-hot-toast.

'use client';

import { useEffect, useState } from 'react';
import { cn } from './cn';
import type { BadgeTone } from './badge';

interface Toast {
  id: string;
  tone: BadgeTone;
  title: string;
  description?: string;
}

type Listener = (toasts: Toast[]) => void;

class ToastStore {
  private toasts: Toast[] = [];
  private listeners: Listener[] = [];

  push(tone: BadgeTone, title: string, description?: string) {
    const id = Math.random().toString(36).slice(2);
    this.toasts = [...this.toasts, { id, tone, title, description }];
    this.notify();
    setTimeout(() => this.dismiss(id), 5000);
  }

  dismiss(id: string) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.notify();
  }

  subscribe(fn: Listener) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l(this.toasts));
  }
}

const store = new ToastStore();

export const toast = {
  success: (title: string, description?: string) => store.push('success', title, description),
  error: (title: string, description?: string) => store.push('danger', title, description),
  info: (title: string, description?: string) => store.push('info', title, description),
  warning: (title: string, description?: string) => store.push('warning', title, description),
};

const TONE_BG: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--color-surface)] border-[var(--color-border)]',
  primary: 'bg-[var(--color-primary-50)] border-[var(--color-primary-200)]',
  success: 'bg-[var(--color-success-bg)] border-[var(--color-success-border)]',
  warning: 'bg-[var(--color-warning-bg)] border-[var(--color-warning-border)]',
  danger: 'bg-[var(--color-danger-bg)] border-[var(--color-danger-border)]',
  info: 'bg-[var(--color-info-bg)] border-[var(--color-info-border)]',
};

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => store.subscribe(setToasts), []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto min-w-[280px] max-w-md rounded-[var(--radius-md)] border px-4 py-3 shadow-[var(--shadow-md)]',
            TONE_BG[t.tone],
          )}
        >
          <p className="text-sm font-medium text-[var(--color-text)]">{t.title}</p>
          {t.description && (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}
