// Label semántico con soporte para required y hint.

import type { LabelHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

interface FieldProps {
  label?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, required, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="text-[var(--color-danger-fg)]"> *</span>}
        </Label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-[var(--color-danger-fg)]">{error}</p>
      ) : hint ? (
        <p className="text-xs text-[var(--color-text-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

export function Label({
  className,
  children,
  ...rest
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('text-sm font-medium text-[var(--color-text)]', className)}
      {...rest}
    >
      {children}
    </label>
  );
}
