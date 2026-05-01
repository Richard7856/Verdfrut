// Badge para estados (route status, report status, etc.).
// Las variantes mapean a los colores semánticos de tokens.css.

import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral:
    'bg-[var(--color-surface-subtle)] text-[var(--color-text)] border-[var(--color-border)]',
  primary:
    'bg-[var(--color-primary-50)] text-[var(--color-primary-700)] border-[var(--color-primary-200)]',
  success:
    'bg-[var(--color-success-bg)] text-[var(--color-success-fg)] border-[var(--color-success-border)]',
  warning:
    'bg-[var(--color-warning-bg)] text-[var(--color-warning-fg)] border-[var(--color-warning-border)]',
  danger:
    'bg-[var(--color-danger-bg)] text-[var(--color-danger-fg)] border-[var(--color-danger-border)]',
  info: 'bg-[var(--color-info-bg)] text-[var(--color-info-fg)] border-[var(--color-info-border)]',
};

export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-0.5 text-xs font-medium',
        TONE_CLASSES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
