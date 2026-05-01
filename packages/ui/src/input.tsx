// Input + Textarea con estados error / disabled.

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

const BASE_FIELD_CLASSES = cn(
  'w-full rounded-[var(--radius-md)] border bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]',
  'placeholder:text-[var(--color-text-subtle)]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface)]',
  'disabled:cursor-not-allowed disabled:bg-[var(--color-surface-subtle)] disabled:opacity-60',
);

const FIELD_STATE_CLASSES = {
  default:
    'border-[var(--color-border-strong)] focus-visible:border-[var(--color-primary-500)] focus-visible:ring-[var(--color-primary-500)]',
  error:
    'border-[var(--color-danger-border)] focus-visible:border-[var(--color-danger-fg)] focus-visible:ring-[var(--color-danger-border)]',
};

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, hasError, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        BASE_FIELD_CLASSES,
        hasError ? FIELD_STATE_CLASSES.error : FIELD_STATE_CLASSES.default,
        'h-10',
        className,
      )}
      {...rest}
    />
  );
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, hasError, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        BASE_FIELD_CLASSES,
        hasError ? FIELD_STATE_CLASSES.error : FIELD_STATE_CLASSES.default,
        'resize-y',
        className,
      )}
      {...rest}
    />
  );
});

interface SelectProps extends InputHTMLAttributes<HTMLSelectElement> {
  hasError?: boolean;
  children: React.ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, hasError, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        BASE_FIELD_CLASSES,
        hasError ? FIELD_STATE_CLASSES.error : FIELD_STATE_CLASSES.default,
        'h-10 cursor-pointer pr-8',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});
